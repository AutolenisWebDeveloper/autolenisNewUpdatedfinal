// lib/services/inventory/inventory-match.service.ts — ENH-6, rewired in Batch 1.
//
// Buyer-facing "recommended vehicles" matching. Now filters to EXECUTABLE SUPPLY
// (fresh, priced, attributable inventory), scores each candidate deterministically,
// and persists the buyer-scoped score into VehicleMatchScore (previously a dead
// model with no writer). Returns the ranked items for the buyer dashboard.

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { executableSupplyWhere } from "./inventory-eligibility";
import { computeMatchScore, type MatchCriteria } from "./inventory-match-score";
import type { Prisma } from "@prisma/client";

const CANDIDATE_SCAN_CAP = 250;

function criteriaWhere(c: MatchCriteria): Prisma.InventoryItemWhereInput {
  const clauses: Prisma.InventoryItemWhereInput[] = [];
  if (c.make) clauses.push({ make: { equals: c.make, mode: "insensitive" } });
  if (c.maxPriceCents != null && c.maxPriceCents > 0) clauses.push({ priceCents: { lte: c.maxPriceCents } });
  return clauses.length ? { AND: clauses } : {};
}

export async function findMatchedVehicles(buyerId: string, limit = 12, now: Date = new Date()) {
  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId }, include: { preQualification: true } });
  const pref = await prisma.buyerInventoryPreference.findUnique({ where: { buyerId } });
  const maxCents = buyer?.preQualification?.maxOtdAmountCents ?? null;

  // A buyer with a preferred-makes list becomes multiple criteria (one per make);
  // we union the candidate sets. With no make preference, all eligible supply is a
  // candidate (constrained only by budget).
  const makes = pref?.preferredMakes?.length ? pref.preferredMakes : [null];

  const eligibleBase = executableSupplyWhere(now);
  const seen = new Map<string, { item: { id: string; make: string; model: string; year: number; priceCents: number; lane: string; images: string[] }; score: number; factors: Record<string, number> }>();

  for (const make of makes) {
    const criteria: MatchCriteria = { make, maxPriceCents: maxCents };
    const items = await prisma.inventoryItem.findMany({
      where: { AND: [eligibleBase, criteriaWhere(criteria)] },
      take: CANDIDATE_SCAN_CAP,
      select: { id: true, year: true, make: true, model: true, priceCents: true, lane: true, images: true },
    });
    for (const item of items) {
      const s = computeMatchScore(criteria, item);
      const prev = seen.get(item.id);
      if (!prev || s.score > prev.score) seen.set(item.id, { item, score: s.score, factors: s.factors });
    }
  }

  const ranked = Array.from(seen.values())
    .sort((a, b) => (b.score - a.score) || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0))
    .slice(0, limit);

  // Persist buyer-scoped scores (idempotent on the unique [buyerId, inventoryItemId]).
  // Best-effort: a scoring-cache write must never break the buyer dashboard.
  try {
    await prisma.$transaction(
      ranked.map((r) =>
        prisma.vehicleMatchScore.upsert({
          where: { buyerId_inventoryItemId: { buyerId, inventoryItemId: r.item.id } },
          create: { buyerId, inventoryItemId: r.item.id, score: r.score, factors: r.factors },
          update: { score: r.score, factors: r.factors, calculatedAt: now },
        })
      )
    );
  } catch (e) {
    logger.warn(`[inventory-match] VehicleMatchScore persist failed for buyer ${buyerId}:`, e);
  }

  return ranked.map((r) => ({
    id: r.item.id,
    year: r.item.year,
    make: r.item.make,
    model: r.item.model,
    priceCents: r.item.priceCents,
    lane: r.item.lane,
    images: r.item.images,
    matchScore: r.score,
  }));
}

export async function saveVehiclePreferences(buyerId: string, makes: string[], bodyStyles: string[], maxMileage?: number, minYear?: number) {
  return prisma.buyerInventoryPreference.upsert({
    where: { buyerId },
    create: { buyerId, preferredMakes: makes, preferredBodyStyles: bodyStyles, maxMileage, minYear },
    update: { preferredMakes: makes, preferredBodyStyles: bodyStyles, maxMileage, minYear },
  });
}
