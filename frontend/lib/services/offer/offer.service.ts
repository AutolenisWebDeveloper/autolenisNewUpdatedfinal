// lib/services/offer/offer.service.ts
// System 4 — Offer submission, validation, revision
// Max 1 revision per offer (MAX_OFFER_REVISIONS from constants)

import { logger } from "@/lib/logger";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { OfferStatus, Prisma } from "@prisma/client";
import { MAX_OFFER_REVISIONS } from "@/lib/constants";
import { writeDealerAudit } from "@/lib/services/audit/dealer-audit.service";
import { maybeExtendForAntiSnipe } from "@/lib/services/auction/anti-snipe.service";
import { syncGhlTag } from "@/lib/services/ghl/tag-sync";
import { sendFirstOfferReceivedEmail } from "@/lib/services/email/buyer-notifications.service";
// OTD component arithmetic lives in a dependency-free module so the concierge
// conversion path validates prices with the exact same assertion. Re-exported
// here to keep offer.service's public surface unchanged for existing importers.
import { assertOtdComponentsMatch } from "./otd";
import { classifyFeeItems } from "./junk-fee.service";
export { assertOtdComponentsMatch };

const APR_SUSPICIOUS_THRESHOLD = 29.0;

function assertFinancingConsistent(input: {
  includesFinancing?: boolean;
  aprRate?: number;
  termMonths?: number;
}) {
  if (!input.includesFinancing) return;
  if (input.aprRate == null || input.termMonths == null) {
    throw new Error("Financing offers require both aprRate and termMonths");
  }
  if (input.aprRate < 0 || input.aprRate > 50) {
    throw new Error("APR must be between 0% and 50%");
  }
  if (input.termMonths < 6 || input.termMonths > 96) {
    throw new Error("Term must be between 6 and 96 months");
  }
}

async function assertWithinBuyerBudget(auctionId: string, otdPriceCents: number) {
  const auction = await prisma.auction.findUnique({
    where: { id: auctionId },
    select: { buyerId: true },
  });
  if (!auction) return;
  const prequal = await prisma.preQualification.findUnique({
    where: { buyerId: auction.buyerId },
    select: { maxOtdAmountCents: true, decision: true, expiresAt: true },
  });
  if (!prequal) return;
  if (otdPriceCents > prequal.maxOtdAmountCents) {
    throw new Error(
      `OTD price exceeds buyer's approved budget of $${(prequal.maxOtdAmountCents / 100).toLocaleString()}`,
    );
  }
}

export interface OfferInput {
  auctionId: string;
  dealerId: string;
  otdPriceCents: number;
  vehiclePriceCents: number;
  taxCents: number;
  feesCents: number;
  /**
   * Itemised fees. Accepts `{name, amount}` (dollars, legacy), `{label, amount}` (the admin
   * route's shape) or `{name, amountCents}` (canonical). `submitOffer` normalises to integer
   * cents and stamps server-side `isJunk` before persisting — see `junk-fee-items.ts`.
   */
  junkFeeItems?: unknown;
  includesFinancing?: boolean;
  aprRate?: number;
  termMonths?: number;
}

export async function submitOffer(input: OfferInput) {
  const now = new Date();

  // Server-side OTD arithmetic — components must sum to total OTD.
  assertOtdComponentsMatch(input);
  // Financing offer internal consistency.
  assertFinancingConsistent(input);
  // OTD must not exceed buyer's approved budget.
  await assertWithinBuyerBudget(input.auctionId, input.otdPriceCents);

  // APR flag computed once for both the insert and any post-create updates.
  const aprFlag = input.aprRate && input.aprRate > APR_SUSPICIOUS_THRESHOLD ? "SUSPICIOUS_APR" : null;

  // §8b's junk-fee evaluation, which had no caller until this phase. Server-side and before the
  // transaction, so the admin's `JunkFeePattern` rows bind rather than the dealer UI's hardcoded
  // keyword list — which was discarded before persistence anyway. Classification changes no
  // arithmetic: `assertOtdComponentsMatch` above already reconciled every itemised fee, junk or
  // not, so a reclassification moves an item between ranking dimensions and never between totals.
  const classifiedFeeItems = await classifyFeeItems(input.junkFeeItems);

  // Wrap invitation lookup, auction validation, duplicate check, and offer
  // create into one Serializable transaction so two concurrent submissions
  // from the same dealer cannot both observe "no existing SUBMITTED offer"
  // and each insert a row.
  const offer = await prisma.$transaction(async (tx) => {
    const invitation = await tx.auctionInvitation.findFirst({
      where: { auctionId: input.auctionId, dealerId: input.dealerId },
    });
    if (!invitation) throw new Error("Dealer not invited to this auction");

    const auction = await tx.auction.findUnique({ where: { id: input.auctionId } });
    if (!auction || auction.status !== "ACTIVE") throw new Error("Auction is not active");
    if (auction.endsAt && auction.endsAt < now) throw new Error("Auction has expired");

    const existingOffer = await tx.offer.findFirst({
      where: {
        auctionId: input.auctionId,
        dealerId: input.dealerId,
        status: OfferStatus.SUBMITTED,
      },
    });
    if (existingOffer) {
      throw new Error("You have already submitted an offer for this auction. Use the revise endpoint to update it.");
    }

    const created = await tx.offer.create({
      data: {
        auctionId: input.auctionId,
        dealerId: input.dealerId,
        otdPriceCents: input.otdPriceCents,
        vehiclePriceCents: input.vehiclePriceCents,
        taxCents: input.taxCents,
        feesCents: input.feesCents,
        junkFeeItems: classifiedFeeItems as unknown as Prisma.InputJsonValue,
        includesFinancing: input.includesFinancing ?? false,
        aprRate: input.aprRate,
        termMonths: input.termMonths,
        aprFlag,
        status: OfferStatus.SUBMITTED,
        version: 1,
        submittedAt: new Date(),
      },
    });

    await tx.auctionInvitation.update({
      where: { id: invitation.id },
      // BOTH, and `offerSubmittedAt` is the one that was missing. Found by review on #422.
      // Four Phase 5 gates read `offerSubmittedAt` and NOTHING on this path wrote it, so every
      // one of them was dead: `skipIfInvitationNoLongerSendable` (the §27 send-time recheck that
      // stops a reminder reaching a dealer who already bid), `alreadyBid` on the tokenised
      // invitation page, the resume-link gate, and the decline route. A dealer who submitted an
      // offer therefore still got the 24h and 72h reminders, and the token page offered to take
      // an offer it would then reject as a duplicate.
      //
      // `respondedAt` is not a substitute: a decline is also a response, so the gates cannot
      // read it without treating a declining dealer as one who bid. Same family as
      // `reflectInvitationDeliveryEvent` having had no caller — a field built and never written.
      data: { respondedAt: new Date(), offerSubmittedAt: new Date() },
    });

    return created;
  }, { isolationLevel: "Serializable" });

  // Re-fetch auction for the post-create notification (outside the txn).
  const auction = await prisma.auction.findUnique({ where: { id: input.auctionId } });
  if (!auction) return offer;

  // Notify buyer of new offer (count update only — no amount/identity)
  const offerCount = await prisma.offer.count({ where: { auctionId: input.auctionId, status: "SUBMITTED" } });
  await prisma.notification.create({
    data: {
      buyerId: auction.buyerId,
      title: "New offer received",
      body: `You now have ${offerCount} offer${offerCount !== 1 ? "s" : ""} in your auction.`,
      type: "OFFER_RECEIVED",
    },
  }).catch((err) => logger.error("[offer.service] buyer new-offer notification failed:", err));

  // First-offer buyer email — fires once, when the offer count goes 0 → 1 for
  // this auction. Non-blocking via after() so a notification failure never
  // affects the dealer's submission. PRIVACY: the email never reveals which
  // dealer submitted, the amount, or any dealer contact info — it only drives
  // the buyer back into the platform.
  if (offerCount === 1) {
    after(async () => {
      try {
        const [buyer, deposit, vehicle] = await Promise.all([
          prisma.buyer.findUnique({
            where: { id: auction.buyerId },
            select: { firstName: true, user: { select: { email: true } } },
          }),
          prisma.deposit.findUnique({
            where: { id: auction.depositId },
            select: { status: true },
          }),
          prisma.auctionVehicle.findFirst({
            where: { auctionId: auction.id },
            select: { make: true, model: true },
          }),
        ]);

        const buyerEmail = buyer?.user?.email;
        if (!buyerEmail) return;

        const appUrl = (
          process.env.NEXT_PUBLIC_APP_URL ?? "https://www.autolenis.com"
        ).trim();

        await sendFirstOfferReceivedEmail({
          buyerEmail,
          buyerFirstName: buyer?.firstName ?? "there",
          vehicleMake: vehicle?.make ?? "",
          vehicleModel: vehicle?.model ?? "",
          hasDeposit: deposit?.status === "PAID",
          depositUrl: `${appUrl}/buyer/deposit`,
          offersUrl: `${appUrl}/buyer/offers`,
        });
      } catch (err) {
        logger.error("[first-offer-notification] failed:", err);
      }
    });
  }

  // Sync to GHL — fire-and-forget. Buyer email isn't loaded above, so resolve
  // it with a lightweight lookup before tagging.
  const buyerForGhl = await prisma.buyer
    .findUnique({
      where: { id: auction.buyerId },
      include: { user: { select: { email: true } } },
    })
    .catch(() => null);
  syncGhlTag(buyerForGhl?.user?.email, "offer-received");

  await writeDealerAudit({
    action: "DEALER_OFFER_SUBMITTED",
    dealerId: input.dealerId,
    entityType: "Offer",
    entityId: offer.id,
    metadata: {
      auctionId: input.auctionId,
      otdPriceCents: input.otdPriceCents,
      includesFinancing: input.includesFinancing ?? false,
    },
  });

  // CRM event spine — emit offer_received for the linked buyer after the offer
  // has been committed. Additive tail call: a failure never affects the
  // dealer's submission. PRIVACY: no dealer identity/amount on the contact.
  try {
    if (buyerForGhl) {
      const { emitDomainEvent } = await import("@/lib/events/emit");
      await emitDomainEvent("offer_received", {
        domainEntityId: offer.id,
        contact: {
          email: buyerForGhl.user?.email ?? null,
          phone: buyerForGhl.phone,
          firstName: buyerForGhl.firstName,
          lastName: buyerForGhl.lastName,
          source: "buyer_signup",
        },
        data: {
          offer_id: offer.id,
          auction_id: input.auctionId,
          buyer_id: auction.buyerId,
          offer_count: offerCount,
        },
      });
    }
  } catch (err) {
    logger.error("[offer.service] offer_received emit failed:", err);
  }

  // Y6 — a bid in the final window pushes the deadline out (best-effort; an
  // extension failure must never fail the submission).
  await maybeExtendForAntiSnipe(input.auctionId).catch((err) =>
    logger.warn("[offer.service] anti-snipe extend failed:", err),
  );

  return offer;
}

export async function reviseOffer(offerId: string, dealerId: string, input: Partial<OfferInput>) {
  const original = await prisma.offer.findFirst({ where: { id: offerId, dealerId, status: "SUBMITTED" } });
  if (!original) throw new Error("Offer not found or not revisionable");
  if (original.version >= MAX_OFFER_REVISIONS + 1) throw new Error("Max revisions reached");

  // Validate auction still active and not past deadline.
  const auction = await prisma.auction.findUnique({ where: { id: original.auctionId } });
  if (!auction || auction.status !== "ACTIVE") throw new Error("Auction closed");
  if (auction.endsAt && auction.endsAt < new Date()) {
    throw new Error("Auction has expired — revisions are no longer accepted");
  }

  // Merge input over original for full validation.
  const merged = {
    otdPriceCents: input.otdPriceCents ?? original.otdPriceCents,
    vehiclePriceCents: input.vehiclePriceCents ?? original.vehiclePriceCents,
    taxCents: input.taxCents ?? original.taxCents,
    feesCents: input.feesCents ?? original.feesCents,
    junkFeeItems: input.junkFeeItems ?? original.junkFeeItems ?? [],
    includesFinancing: input.includesFinancing ?? original.includesFinancing,
    aprRate: input.aprRate ?? original.aprRate ?? undefined,
    termMonths: input.termMonths ?? original.termMonths ?? undefined,
  };
  assertOtdComponentsMatch(merged);
  assertFinancingConsistent(merged);
  await assertWithinBuyerBudget(original.auctionId, merged.otdPriceCents);

  const aprFlag = merged.aprRate && merged.aprRate > APR_SUSPICIOUS_THRESHOLD ? "SUSPICIOUS_APR" : null;

  // §8b's classification on the revision too. A dealer who revises must not be able to launder a
  // junk fee past the ranking by resubmitting it, and a revision that carries the ORIGINAL's items
  // forward re-classifies them — so a pattern the admin added between the two submissions binds on
  // the version the buyer is actually shown.
  const classifiedFeeItems = await classifyFeeItems(merged.junkFeeItems);
  const revised = await prisma.$transaction(async (tx) => {
    const stillOriginal = await tx.offer.findFirst({
      where: { id: offerId, dealerId, status: OfferStatus.SUBMITTED },
    });
    if (!stillOriginal) throw new Error("Offer was modified concurrently");

    const created = await tx.offer.create({
      data: {
        auctionId: original.auctionId,
        dealerId,
        otdPriceCents: merged.otdPriceCents,
        vehiclePriceCents: merged.vehiclePriceCents,
        taxCents: merged.taxCents,
        feesCents: merged.feesCents,
        junkFeeItems: classifiedFeeItems as unknown as Prisma.InputJsonValue,
        includesFinancing: merged.includesFinancing,
        aprRate: merged.aprRate,
        termMonths: merged.termMonths,
        aprFlag,
        status: OfferStatus.SUBMITTED,
        version: original.version + 1,
        originalOfferId: offerId,
        submittedAt: new Date(),
      },
    });

    await tx.offer.update({ where: { id: offerId }, data: { status: OfferStatus.WITHDRAWN } });
    return created;
  }, { isolationLevel: "Serializable" });

  await writeDealerAudit({
    action: "DEALER_OFFER_REVISED",
    dealerId,
    entityType: "Offer",
    entityId: revised.id,
    metadata: {
      auctionId: original.auctionId,
      originalOfferId: offerId,
      previousOtdPriceCents: original.otdPriceCents,
      newOtdPriceCents: merged.otdPriceCents,
      version: revised.version,
    },
  });

  // Y6 — a last-minute REVISION (e.g. undercutting) is also a snipe; extend too.
  await maybeExtendForAntiSnipe(original.auctionId).catch((err) =>
    logger.warn("[offer.service] anti-snipe extend failed:", err),
  );

  return revised;
}

export async function getOffersForAuction(auctionId: string) {
  return prisma.offer.findMany({
    where: { auctionId, status: OfferStatus.SUBMITTED },
    include: { dealer: { select: { id: true, dealershipName: true, tier: true } } },
    orderBy: { otdPriceCents: "asc" },
  });
}
