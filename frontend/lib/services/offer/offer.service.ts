// lib/services/offer/offer.service.ts
// System 4 — Offer submission, validation, revision
// Max 1 revision per offer (MAX_OFFER_REVISIONS from constants)

import { prisma } from "@/lib/prisma";
import { OfferStatus } from "@prisma/client";
import { MAX_OFFER_REVISIONS } from "@/lib/constants";

const APR_SUSPICIOUS_THRESHOLD = 29.0;

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

  // Validate dealer was invited to this auction
  const invitation = await prisma.auctionInvitation.findFirst({
    where: { auctionId: input.auctionId, dealerId: input.dealerId },
  });
  if (!invitation) throw new Error("Dealer not invited to this auction");

  // Validate auction is active and not past expiry
  const auction = await prisma.auction.findUnique({ where: { id: input.auctionId } });
  if (!auction || auction.status !== "ACTIVE") throw new Error("Auction is not active");
  if (auction.endsAt && auction.endsAt < now) throw new Error("Auction has expired");

  // Duplicate-offer guard — one active SUBMITTED offer per dealer per auction.
  // Revisions create a new row and withdraw the original, so this only blocks
  // simultaneous duplicate submissions, not legitimate revisions via reviseOffer().
  const existingOffer = await prisma.offer.findFirst({
    where: {
      auctionId: input.auctionId,
      dealerId: input.dealerId,
      status: OfferStatus.SUBMITTED,
    },
  });
  if (existingOffer) {
    throw new Error("You have already submitted an offer for this auction. Use the revise endpoint to update it.");
  }

  // APR validation
  const aprFlag = input.aprRate && input.aprRate > APR_SUSPICIOUS_THRESHOLD ? "SUSPICIOUS_APR" : null;

  const offer = await prisma.offer.create({
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

  // Mark invitation as responded
  await prisma.auctionInvitation.update({
    where: { id: invitation.id },
    data: { respondedAt: new Date() },
  });

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

  // Validate auction still active
  const auction = await prisma.auction.findUnique({ where: { id: original.auctionId } });
  if (!auction || auction.status !== "ACTIVE") throw new Error("Auction closed");

  const aprFlag = input.aprRate && input.aprRate > APR_SUSPICIOUS_THRESHOLD ? "SUSPICIOUS_APR" : null;

  // Create new version
  const revised = await prisma.offer.create({
    data: {
      auctionId: original.auctionId,
      dealerId,
      otdPriceCents: input.otdPriceCents ?? original.otdPriceCents,
      vehiclePriceCents: input.vehiclePriceCents ?? original.vehiclePriceCents,
      taxCents: input.taxCents ?? original.taxCents,
      feesCents: input.feesCents ?? original.feesCents,
      junkFeeItems: (input.junkFeeItems ?? (original.junkFeeItems as unknown)) as object[],
      includesFinancing: input.includesFinancing ?? original.includesFinancing,
      aprRate: input.aprRate ?? original.aprRate,
      termMonths: input.termMonths ?? original.termMonths,
      aprFlag,
      status: OfferStatus.SUBMITTED,
      version: 2,
      originalOfferId: offerId,
      submittedAt: new Date(),
    },
  });

  // Withdraw the original
  await prisma.offer.update({ where: { id: offerId }, data: { status: OfferStatus.WITHDRAWN } });

  return revised;
}

export async function getOffersForAuction(auctionId: string) {
  return prisma.offer.findMany({
    where: { auctionId, status: OfferStatus.SUBMITTED },
    include: { dealer: { select: { id: true, dealershipName: true, tier: true } } },
    orderBy: { otdPriceCents: "asc" },
  });
}
