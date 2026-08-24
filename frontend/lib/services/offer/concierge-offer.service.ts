// lib/services/offer/concierge-offer.service.ts — Batch 4
//
// The single canonical convergence path for the concierge / admin-sourced offer
// tracks (Systems B & C). It represents a concierge offer as the AUTHORITATIVE
// artifacts — a deposit-OPTIONAL Auction + a canonical `Offer` — and produces a
// `Deal` through the one accepted-offer authority `Deal.offerId`. There is no
// second "accepted offer" concept: everything converges here.
//
// Idempotent + concurrency-safe via `Offer.conciergeSourceRef @unique`: the same
// source (e.g. "vehicle_request_offer:<id>") can never mint a duplicate
// Auction/Offer/Deal. Honest pricing: a single concierge price becomes the OTD
// with vehiclePrice=OTD, tax=0, fees=0, no junk fees — truthful, never fabricated.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getOrCreateOutsideDealerId } from "@/lib/services/offer/outside-dealer";

export interface ConciergeOfferContext {
  buyerId: string;
  /** Deterministic idempotency key, e.g. `vehicle_request_offer:<id>`. */
  sourceRef: string;
  vehicleRequestId?: string | null;
  /** Registered dealer id when known; else the outside placeholder + external* fields are used. */
  dealerId?: string | null;
  externalDealerName?: string | null;
  externalDealerEmail?: string | null;
  externalDealerPhone?: string | null;
  /** Truthful out-the-door price in cents (> 0). */
  otdPriceCents: number;
  vehicleSummary?: string | null;
  includesFinancing?: boolean;
  aprRate?: number | null;
  termMonths?: number | null;
}

export interface ConciergeConversionResult {
  dealId: string;
  offerId: string;
  auctionId: string;
  alreadyConverted: boolean;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * Convert a concierge offer into the canonical Deal. Idempotent: a repeat call for
 * the same `sourceRef` returns the existing Deal without minting anything new.
 */
export async function convertConciergeOfferToDeal(ctx: ConciergeOfferContext): Promise<ConciergeConversionResult> {
  if (!(ctx.otdPriceCents > 0)) {
    throw new Error("convertConciergeOfferToDeal: otdPriceCents must be a positive integer");
  }
  const includesFinancing = !!ctx.includesFinancing;
  if (includesFinancing && (ctx.aprRate == null || ctx.termMonths == null)) {
    throw new Error("convertConciergeOfferToDeal: a financing offer requires aprRate and termMonths");
  }

  // Fast idempotency path — already fully converted.
  const existing = await prisma.offer.findUnique({
    where: { conciergeSourceRef: ctx.sourceRef },
    include: { deal: { select: { id: true } } },
  });
  if (existing?.deal) {
    return { dealId: existing.deal.id, offerId: existing.id, auctionId: existing.auctionId, alreadyConverted: true };
  }

  // Resolve dealer identity: a valid registered dealer, else the outside placeholder.
  let dealerId = ctx.dealerId ?? null;
  if (dealerId) {
    const d = await prisma.dealer.findUnique({ where: { id: dealerId }, select: { id: true } });
    if (!d) dealerId = null;
  }
  const isOutside = !dealerId;
  if (!dealerId) dealerId = await getOrCreateOutsideDealerId();

  try {
    const result = await prisma.$transaction(async (tx) => {
      let offerId = existing?.id ?? null;
      let auctionId = existing?.auctionId ?? null;

      if (!offerId) {
        // Deposit-OPTIONAL concierge auction — already CLOSED (no bidding window).
        const auction = await tx.auction.create({
          data: {
            buyerId: ctx.buyerId,
            status: "CLOSED",
            closedAt: new Date(),
            ...(ctx.vehicleRequestId ? { vehicleRequestId: ctx.vehicleRequestId } : {}),
          },
          select: { id: true },
        });
        auctionId = auction.id;
        const offer = await tx.offer.create({
          data: {
            auctionId: auction.id,
            dealerId: dealerId as string,
            status: "SUBMITTED",
            otdPriceCents: ctx.otdPriceCents,
            vehiclePriceCents: ctx.otdPriceCents,
            taxCents: 0,
            feesCents: 0,
            junkFeeItems: [] as Prisma.InputJsonValue,
            includesFinancing,
            aprRate: ctx.aprRate ?? null,
            termMonths: ctx.termMonths ?? null,
            ...(isOutside
              ? { externalDealerName: ctx.externalDealerName ?? null, externalDealerEmail: ctx.externalDealerEmail ?? null, externalDealerPhone: ctx.externalDealerPhone ?? null }
              : {}),
            notes: ctx.vehicleSummary ?? null,
            submittedAt: new Date(),
            conciergeSourceRef: ctx.sourceRef,
          },
          select: { id: true },
        });
        offerId = offer.id;
      }

      // The one accepted-offer authority: Deal.offerId.
      const deal = await tx.deal.create({
        data: { buyerId: ctx.buyerId, offerId: offerId as string, status: "FINANCING_PENDING" },
        select: { id: true },
      });
      await tx.offer.update({ where: { id: offerId as string }, data: { status: "ACCEPTED" } });

      return { dealId: deal.id, offerId: offerId as string, auctionId: auctionId as string };
    });
    return { ...result, alreadyConverted: false };
  } catch (err) {
    // A concurrent caller won the sourceRef (or the deal) — return the winner's Deal.
    if (isUniqueViolation(err)) {
      const winner = await prisma.offer.findUnique({
        where: { conciergeSourceRef: ctx.sourceRef },
        include: { deal: { select: { id: true } } },
      });
      if (winner?.deal) {
        return { dealId: winner.deal.id, offerId: winner.id, auctionId: winner.auctionId, alreadyConverted: true };
      }
    }
    throw err;
  }
}
