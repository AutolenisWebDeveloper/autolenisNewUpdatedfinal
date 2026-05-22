// lib/services/offer/offer.service.ts
// System 4 — Offer submission, validation, revision
// Max 1 revision per offer (MAX_OFFER_REVISIONS from constants)

import { prisma } from "@/lib/prisma";
import { OfferStatus } from "@prisma/client";
import { MAX_OFFER_REVISIONS } from "@/lib/constants";

const APR_SUSPICIOUS_THRESHOLD = 29.0;
// Allow up to 1 cent rounding tolerance when summing OTD components
const OTD_SUM_TOLERANCE_CENTS = 1;

function assertOtdComponentsMatch(input: {
  otdPriceCents: number;
  vehiclePriceCents: number;
  taxCents: number;
  feesCents: number;
  junkFeeItems?: Array<{ name: string; amount: number }>;
}) {
  const junkFeeCents = (input.junkFeeItems ?? []).reduce(
    (sum, item) => sum + Math.round((item.amount ?? 0) * 100),
    0,
  );
  const expected = input.vehiclePriceCents + input.taxCents + input.feesCents + junkFeeCents;
  if (Math.abs(input.otdPriceCents - expected) > OTD_SUM_TOLERANCE_CENTS) {
    throw new Error(
      `OTD breakdown mismatch: components sum to ${expected} cents but otdPriceCents is ${input.otdPriceCents}`,
    );
  }
}

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
  junkFeeItems?: Array<{ name: string; amount: number }>;
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
        junkFeeItems: input.junkFeeItems ?? [],
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
      data: { respondedAt: new Date() },
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
  }).catch(() => {});

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
    junkFeeItems: (input.junkFeeItems ?? (original.junkFeeItems as unknown as Array<{ name: string; amount: number }>)) ?? [],
    includesFinancing: input.includesFinancing ?? original.includesFinancing,
    aprRate: input.aprRate ?? original.aprRate ?? undefined,
    termMonths: input.termMonths ?? original.termMonths ?? undefined,
  };
  assertOtdComponentsMatch(merged);
  assertFinancingConsistent(merged);
  await assertWithinBuyerBudget(original.auctionId, merged.otdPriceCents);

  const aprFlag = merged.aprRate && merged.aprRate > APR_SUSPICIOUS_THRESHOLD ? "SUSPICIOUS_APR" : null;

  // Atomic: create revision + withdraw original together.
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
        junkFeeItems: merged.junkFeeItems as object[],
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

  return revised;
}

export async function getOffersForAuction(auctionId: string) {
  return prisma.offer.findMany({
    where: { auctionId, status: OfferStatus.SUBMITTED },
    include: { dealer: { select: { id: true, dealershipName: true, tier: true } } },
    orderBy: { otdPriceCents: "asc" },
  });
}
