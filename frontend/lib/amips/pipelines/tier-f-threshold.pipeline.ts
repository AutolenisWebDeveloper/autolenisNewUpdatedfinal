// AMIPS Phase 4 — Tier F threshold monitor.
//
// Tier F is the moat: pages narrated from REAL completed-transaction data, not
// estimates. The AMIPS gate is strict — a vehicle + metro must have at least 50
// accepted-offer transactions before a single Tier F page may exist.
//
// This monitor runs daily. For every vehicle + metro that has crossed the
// threshold it (1) aggregates the verified metrics into autolenis_intelligence
// and (2) seeds Tier F content-queue items the first time the combo qualifies.
// The generator (assembler + quality gate) does the actual page production and
// re-checks the 50-transaction gate, so this stays purely about unlocking.

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { TOP_METROS } from "@/lib/amips/seed/content-queue.seed";

// AMIPS Tier F gate: minimum completed transactions per vehicle + metro.
export const TIER_F_TRANSACTION_THRESHOLD = 50;

// All-time rolling aggregate period key for the autolenis_intelligence row that
// backs Tier F narration (the @@unique includes periodMonth).
export const TIER_F_PERIOD = "all-time";

// Tier F is demand-proven content, so it outranks every population-estimated
// item in the queue. Scaling by transaction count means the most-proven combos
// generate first.
const TIER_F_PRIORITY_BASE = 1_000_000;

// Tier F article angles — proprietary, transaction-backed narratives.
const TIER_F_ANGLES: string[] = [
  "real dealer competition results",
  "verified buyer outcomes",
  "actual offers buyers received",
  "transaction-backed market report",
];

export interface TierFMonitorResult {
  combosOverThreshold: number;
  unlocked: number; // combos newly seeded into the Tier F queue
  queueItemsSeeded: number;
  aggregated: number; // autolenis_intelligence rows upserted
}

const STATE_BY_METRO = new Map(TOP_METROS.map((m) => [m.metro, m.state]));

/**
 * Daily Tier F unlock pass. Idempotent: re-running refreshes the aggregates and
 * only seeds queue items for combos that don't already have Tier F items.
 */
export async function runTierFThresholdMonitor(): Promise<TierFMonitorResult> {
  // Accepted-offer transaction counts + verified averages per vehicle + metro.
  const groups = await prisma.marketplaceIntelligence.groupBy({
    by: ["vehicleMake", "vehicleModel", "metro"],
    where: { buyerAcceptedOffer: true },
    _count: { id: true },
    _avg: {
      responseRate: true,
      avgOffersPerRequest: true,
      timeToFinalOfferMinutes: true,
    },
  });

  const qualifying = groups.filter(
    (g) => (g._count.id ?? 0) >= TIER_F_TRANSACTION_THRESHOLD,
  );

  let unlocked = 0;
  let queueItemsSeeded = 0;
  let aggregated = 0;

  for (const g of qualifying) {
    const count = g._count.id ?? 0;
    const make = g.vehicleMake;
    const model = g.vehicleModel;
    const metro = g.metro;

    // 1 — Aggregate verified metrics into autolenis_intelligence (all-time).
    await prisma.autolenisIntelligence.upsert({
      where: {
        metro_vehicleMake_vehicleModel_periodMonth: {
          metro,
          vehicleMake: make,
          vehicleModel: model,
          periodMonth: TIER_F_PERIOD,
        },
      },
      create: {
        metro,
        vehicleMake: make,
        vehicleModel: model,
        periodMonth: TIER_F_PERIOD,
        requestVolume: count,
        transactionCount: count,
        dealerResponseRate: g._avg.responseRate ?? null,
        avgOffersReceived: g._avg.avgOffersPerRequest ?? null,
      },
      update: {
        requestVolume: count,
        transactionCount: count,
        dealerResponseRate: g._avg.responseRate ?? null,
        avgOffersReceived: g._avg.avgOffersPerRequest ?? null,
        lastUpdated: new Date(),
      },
    });
    aggregated += 1;

    // 2 — Seed Tier F queue items the first time this combo qualifies.
    const existing = await prisma.contentQueue.count({
      where: { contentTier: "F", make, model, metro },
    });
    if (existing > 0) continue;

    const state = STATE_BY_METRO.get(metro) ?? null;
    const priorityScore = TIER_F_PRIORITY_BASE * count;
    const items = TIER_F_ANGLES.map((angle) => ({
      contentTier: "F",
      make,
      model,
      metro,
      state,
      intentTemplate: `proprietary_autolenis:${angle}`,
      keywordTarget: `${make} ${model} ${angle} in ${metro}`,
      priorityScore,
      status: "pending",
    }));

    await prisma.contentQueue.createMany({ data: items });
    queueItemsSeeded += items.length;
    unlocked += 1;

    logger.info(
      `[amips-tier-f-unlocked] ${make} ${model} in ${metro} — ${count} verified transactions, seeded ${items.length} Tier F items`,
    );
  }

  const result: TierFMonitorResult = {
    combosOverThreshold: qualifying.length,
    unlocked,
    queueItemsSeeded,
    aggregated,
  };
  logger.info(
    `[amips-p4-tier-f] combosOverThreshold ${result.combosOverThreshold}, unlocked ${result.unlocked}, queueItemsSeeded ${result.queueItemsSeeded}, aggregated ${result.aggregated}`,
  );
  return result;
}
