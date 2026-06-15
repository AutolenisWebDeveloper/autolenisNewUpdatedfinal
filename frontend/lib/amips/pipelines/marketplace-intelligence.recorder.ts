// AMIPS Phase 4 — Marketplace Intelligence recorder.
//
// Every completed AutoLenis transaction (buyer accepts a dealer's offer on a
// deposited auction) is written to marketplace_intelligence. This is the live
// activity stream that, once it crosses 50 transactions for a vehicle + metro,
// unlocks Tier F — the unreplicable, transaction-backed content moat.
//
// The recorder is intentionally side-effect-safe: it is invoked from a
// non-blocking after() hook so a failure here never affects the buyer's deal
// flow. It records only real, observed values — never estimates.

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { resolveMetro } from "@/lib/amips/metros";

export interface MarketplaceIntelligenceInput {
  vehicleMake: string;
  vehicleModel: string;
  vehicleTrim?: string | null;
  metro: string;
  dealersInvited: number;
  dealersResponded: number;
  timeToFirstOfferMinutes?: number | null;
  timeToFinalOfferMinutes?: number | null;
  buyerAcceptedOffer: boolean;
  avgOffersPerRequest?: number | null;
  transactionDate: Date;
  buyerOpportunityId?: string | null;
}

/**
 * Write one marketplace_intelligence row from already-resolved values. Computes
 * responseRate from the invited/responded counts. Pure persistence — callers
 * supply real, observed numbers.
 */
export async function recordMarketplaceIntelligence(
  input: MarketplaceIntelligenceInput,
): Promise<void> {
  const responseRate =
    input.dealersInvited > 0
      ? input.dealersResponded / input.dealersInvited
      : null;

  await prisma.marketplaceIntelligence.create({
    data: {
      vehicleMake: input.vehicleMake,
      vehicleModel: input.vehicleModel,
      vehicleTrim: input.vehicleTrim ?? null,
      metro: input.metro,
      dealersInvited: input.dealersInvited,
      dealersResponded: input.dealersResponded,
      responseRate,
      timeToFirstOfferMinutes: input.timeToFirstOfferMinutes ?? null,
      timeToFinalOfferMinutes: input.timeToFinalOfferMinutes ?? null,
      buyerAcceptedOffer: input.buyerAcceptedOffer,
      avgOffersPerRequest: input.avgOffersPerRequest ?? null,
      transactionDate: input.transactionDate,
      buyerOpportunityId: input.buyerOpportunityId ?? null,
    },
  });

  logger.info(
    `[amips-p4-marketplace] recorded ${input.vehicleMake} ${input.vehicleModel} in ${input.metro} — invited ${input.dealersInvited}, responded ${input.dealersResponded}`,
  );
}

/**
 * Assemble a marketplace_intelligence record from a completed auction and
 * persist it. Pulls the vehicle, resolves the buyer's metro, derives the
 * invited/responded counts and offer timing from the auction, then records.
 *
 * Safe to call from after(): swallows its own errors and skips silently when
 * the transaction can't be attributed to a tracked vehicle/metro.
 */
export async function recordMarketplaceFromAuction(
  auctionId: string,
): Promise<void> {
  try {
    const auction = await prisma.auction.findUnique({
      where: { id: auctionId },
      include: {
        vehicles: true,
        offers: {
          select: {
            dealerId: true,
            externalDealerEmail: true,
            submittedAt: true,
          },
        },
        invitations: { select: { id: true } },
        outsideInvites: { select: { id: true } },
        buyer: { select: { city: true, state: true, zip: true } },
      },
    });
    if (!auction) return;

    const vehicle = auction.vehicles[0];
    if (!vehicle?.make || !vehicle?.model) {
      logger.info(
        `[amips-p4-marketplace] skip auction ${auctionId}: no vehicle make/model`,
      );
      return;
    }

    const metro = resolveMetro(
      auction.buyer.city,
      auction.buyer.state,
      auction.buyer.zip,
    );
    if (!metro) {
      logger.info(
        `[amips-p4-marketplace] skip auction ${auctionId}: buyer not in a tracked metro`,
      );
      return;
    }

    const dealersInvited =
      auction.invitations.length + auction.outsideInvites.length;

    // Only submitted offers count as a dealer response. Distinct by registered
    // dealer id, or by external email for unregistered/outside dealers (which
    // all share the system placeholder Dealer record).
    const submittedOffers = auction.offers.filter((o) => o.submittedAt);
    const responders = new Set<string>();
    for (const o of submittedOffers) {
      responders.add(o.externalDealerEmail ?? o.dealerId);
    }
    const dealersResponded = responders.size;

    // Offer timing relative to auction start.
    const start = auction.startedAt ?? auction.createdAt;
    const submitMs = submittedOffers
      .map((o) => o.submittedAt!.getTime())
      .sort((a, b) => a - b);
    const toMinutes = (t: number) =>
      Math.max(0, Math.round((t - start.getTime()) / 60_000));
    const timeToFirstOfferMinutes = submitMs.length
      ? toMinutes(submitMs[0])
      : null;
    const timeToFinalOfferMinutes = submitMs.length
      ? toMinutes(submitMs[submitMs.length - 1])
      : null;

    await recordMarketplaceIntelligence({
      vehicleMake: vehicle.make,
      vehicleModel: vehicle.model,
      vehicleTrim: vehicle.trim,
      metro: metro.metro,
      dealersInvited,
      dealersResponded,
      timeToFirstOfferMinutes,
      timeToFinalOfferMinutes,
      buyerAcceptedOffer: true,
      // One auction = one buyer request; offers received is the per-request total.
      avgOffersPerRequest: submittedOffers.length,
      transactionDate: new Date(),
    });
  } catch (err) {
    logger.error(
      `[amips-p4-marketplace] record failed for auction ${auctionId}:`,
      err,
    );
  }
}
