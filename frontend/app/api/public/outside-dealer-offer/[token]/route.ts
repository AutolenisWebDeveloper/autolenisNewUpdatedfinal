import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { getOrCreateOutsideDealerId } from "@/lib/services/offer/outside-dealer";
import { sendOutsideDealerAuctionOfferAdminNotification } from "@/lib/services/email/vehicle-offers.email";
import { inviteRejection, type InviteRejectReason } from "@/lib/services/auction/outside-invite.service";
import { maybeExtendForAntiSnipe } from "@/lib/services/auction/anti-snipe.service";
import { limitGeneral, clientIpKey } from "@/lib/security/rate-limit";

interface Props { params: Promise<{ token: string }> }

// Upper bound per money component ($1,000,000) so an absurd value can't pollute the
// buyer's best-price ranking. The OTD total is recomputed server-side (never trusted
// from the client) as vehicle + tax + fees.
const MAX_CENTS = 100_000_000;
const MIN_OTD_CENTS = 100;

const schema = z.object({
  vehiclePriceCents: z.number().int().min(0).max(MAX_CENTS),
  taxCents:          z.number().int().min(0).max(MAX_CENTS),
  feesCents:         z.number().int().min(0).max(MAX_CENTS),
  // Accepted for backward-compat but IGNORED — the server recomputes the total.
  otdPriceCents:     z.number().int().min(0).max(MAX_CENTS).optional(),
  notes:             z.string().max(2000).optional(),
});

function err(code: string, message: string, status = 400) {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

export async function POST(request: NextRequest, { params }: Props) {
  const { token } = await params;

  // Per-IP throttle on this unauthenticated public surface (bounds invalid-token
  // probing / DB-load abuse; fails OPEN with an alert if the limiter store is down).
  const rl = await limitGeneral(`outside-offer:ip:${clientIpKey(request.headers)}`, { tokens: 20, window: "1 h" });
  if (!rl.ok) return err("RATE_LIMITED", rl.message, rl.status);

  let body: unknown;
  try { body = await request.json(); } catch {
    return err("VALIDATION_ERROR", "Invalid JSON", 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return err("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }
  const { vehiclePriceCents, taxCents, feesCents, notes } = parsed.data;
  // Recompute the OTD total server-side — NEVER trust the client's. This prevents an
  // inconsistent split (huge components hidden behind a tiny OTD, or a fabricated
  // low total) from entering the buyer's best-price ranking.
  const otdPriceCents = vehiclePriceCents + taxCents + feesCents;
  if (otdPriceCents < MIN_OTD_CENTS) {
    return err("VALIDATION_ERROR", "Offer total must be at least $1.00.", 400);
  }

  const invite = await prisma.outsideAuctionInvite.findUnique({
    where: { token },
    include: { auction: { select: { id: true, status: true, endsAt: true } } },
  });
  if (!invite) return err("NOT_FOUND", "Invitation not found", 404);

  // Single-use + auction-active + auction-not-ended + token-not-expired, all in one
  // pure guard. Token expiry is enforced independently of auction status so a stale
  // link can't be replayed even if the auction is briefly reopened.
  const rejection = inviteRejection(invite, new Date());
  if (rejection) {
    const messages: Record<InviteRejectReason, string> = {
      ALREADY_SUBMITTED: "An offer has already been submitted for this invitation.",
      AUCTION_INACTIVE: "This auction is no longer active.",
      AUCTION_EXPIRED: "This auction has expired.",
      TOKEN_EXPIRED: "This invitation link has expired.",
    };
    return err(rejection, messages[rejection], 400);
  }

  // Resolve the system "Outside Dealer" placeholder so the offer satisfies the
  // non-nullable Offer.dealerId while the real identity is kept on the offer.
  const outsideDealerId = await getOrCreateOutsideDealerId();

  // Create the real Offer record (so it flows through the best-price engine and
  // buyer comparison panel) and link the invite to it — atomically.
  let alreadySubmitted = false;
  const offer = await prisma.$transaction(async (tx) => {
    // Atomic single-use CLAIM: flip respondedAt from null in one guarded updateMany.
    // Under Read Committed this takes the row lock and re-checks the predicate, so of
    // two concurrent submissions (or a double-clicked link firing two POSTs) exactly
    // one gets count===1 — the other sees count===0 and aborts BEFORE any Offer is
    // created. A non-locking findUnique read here would let both create an Offer.
    const claim = await tx.outsideAuctionInvite.updateMany({
      where: { id: invite.id, respondedAt: null },
      data: { respondedAt: new Date() },
    });
    if (claim.count === 0) {
      alreadySubmitted = true;
      return null;
    }

    const created = await tx.offer.create({
      data: {
        auctionId:           invite.auction.id,
        dealerId:            outsideDealerId,
        status:              "SUBMITTED",
        otdPriceCents:       otdPriceCents,
        vehiclePriceCents:   vehiclePriceCents,
        taxCents:            taxCents,
        feesCents:           feesCents,
        submittedAt:         new Date(),
        externalDealerName:  invite.dealershipName,
        externalDealerEmail: invite.email,
        externalDealerPhone: invite.phone,
        notes:               notes ?? null,
      },
    });

    await tx.outsideAuctionInvite.update({
      where: { id: invite.id },
      data: {
        // respondedAt already set by the atomic claim above.
        offerOtdCents:      otdPriceCents,
        offerVehicleCents:  vehiclePriceCents,
        offerTaxCents:      taxCents,
        offerFeesCents:     feesCents,
        offerNotes:         notes ?? null,
        offerId:            created.id,
      },
    });

    return created;
  });

  if (alreadySubmitted || !offer) {
    return err("ALREADY_SUBMITTED", "An offer has already been submitted for this invitation.", 400);
  }

  // Y6 — an outside-dealer offer is a real competing bid, so a last-minute one must
  // extend the auction too (parity with submitOffer/reviseOffer). Best-effort: an
  // extension failure never fails the accepted submission.
  await maybeExtendForAntiSnipe(invite.auction.id).catch((e) =>
    logger.warn("[outside-dealer-offer] anti-snipe extend failed:", e),
  );

  // Notify the buyer (count only — no amount/identity), matching the
  // registered-dealer offer flow. Non-blocking.
  const submittedCount = await prisma.offer
    .count({ where: { auctionId: invite.auction.id, status: "SUBMITTED" } })
    .catch(() => 0);
  if (submittedCount > 0) {
    const auctionWithBuyer = await prisma.auction
      .findUnique({ where: { id: invite.auction.id }, select: { buyerId: true } })
      .catch(() => null);
    if (auctionWithBuyer) {
      await prisma.notification
        .create({
          data: {
            buyerId: auctionWithBuyer.buyerId,
            title: "New offer received",
            body: `You now have ${submittedCount} offer${submittedCount !== 1 ? "s" : ""} in your auction.`,
            type: "OFFER_RECEIVED",
          },
        })
        .catch(() => {});
    }
  }

  // Notify admin that an outside dealer submitted — non-blocking.
  await sendOutsideDealerAuctionOfferAdminNotification({
    auctionId:      invite.auction.id,
    offerId:        offer.id,
    dealershipName: invite.dealershipName,
    contactName:    invite.contactName,
    contactEmail:   invite.email,
    contactPhone:   invite.phone,
    otdPriceCents:  otdPriceCents,
    source:         "email_link",
  }).catch((e) => logger.error("[outside-dealer-offer] admin notification failed:", e));

  return NextResponse.json({ success: true, data: { received: true, offerId: offer.id } });
}
