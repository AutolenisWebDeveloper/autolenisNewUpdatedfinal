import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { getOrCreateOutsideDealerId } from "@/lib/services/offer/outside-dealer";
import { sendOutsideDealerAuctionOfferAdminNotification } from "@/lib/services/email/vehicle-offers.email";

interface Props { params: Promise<{ token: string }> }

const schema = z.object({
  vehiclePriceCents: z.number().int().min(0),
  taxCents:          z.number().int().min(0),
  feesCents:         z.number().int().min(0),
  otdPriceCents:     z.number().int().min(100),
  notes:             z.string().max(2000).optional(),
});

function err(code: string, message: string, status = 400) {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

export async function POST(request: NextRequest, { params }: Props) {
  const { token } = await params;

  let body: unknown;
  try { body = await request.json(); } catch {
    return err("VALIDATION_ERROR", "Invalid JSON", 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return err("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }
  const { vehiclePriceCents, taxCents, feesCents, otdPriceCents, notes } = parsed.data;

  const invite = await prisma.outsideAuctionInvite.findUnique({
    where: { token },
    include: { auction: { select: { id: true, status: true, endsAt: true } } },
  });
  if (!invite) return err("NOT_FOUND", "Invitation not found", 404);

  if (invite.respondedAt) {
    return err("ALREADY_SUBMITTED", "An offer has already been submitted for this invitation.", 400);
  }
  if (invite.auction.status !== "ACTIVE") {
    return err("AUCTION_INACTIVE", "This auction is no longer active.", 400);
  }
  if (invite.auction.endsAt && invite.auction.endsAt < new Date()) {
    return err("AUCTION_EXPIRED", "This auction has expired.", 400);
  }

  // Resolve the system "Outside Dealer" placeholder so the offer satisfies the
  // non-nullable Offer.dealerId while the real identity is kept on the offer.
  const outsideDealerId = await getOrCreateOutsideDealerId();

  // Create the real Offer record (so it flows through the best-price engine and
  // buyer comparison panel) and link the invite to it — atomically.
  let alreadySubmitted = false;
  const offer = await prisma.$transaction(async (tx) => {
    // Re-check inside the transaction so two concurrent submissions (e.g. a
    // double-clicked link) cannot both pass the pre-transaction guard and
    // create duplicate offers. The first commit wins; the second aborts.
    const fresh = await tx.outsideAuctionInvite.findUnique({
      where: { id: invite.id },
      select: { respondedAt: true },
    });
    if (fresh?.respondedAt) {
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
        respondedAt:        new Date(),
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
  }).catch((e) => console.error("[outside-dealer-offer] admin notification failed:", e));

  return NextResponse.json({ success: true, data: { received: true, offerId: offer.id } });
}
