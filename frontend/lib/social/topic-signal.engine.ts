// AutoLenis Social Engine — Topic Signal Engine.
//
// Scans existing AutoLenis intelligence (AMIPS market/vehicle data + the
// content-article store) and materializes TopicSignal rows for fresh content
// opportunities. This module is READ-ONLY against every existing table — it
// only writes to topic_signals. Each signal expires after 7 days and is
// deduplicated against identical signals raised in the trailing 7 days.

import { prisma } from "@/lib/prisma";
import type { TopicSignal, Prisma } from "@prisma/client";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Buyer-leverage threshold — metros where buyers currently hold the advantage.
const BUYER_LEVERAGE_MIN = 7.5;
// How many top articles to consider for repurposing per scan.
const ARTICLE_LIMIT = 10;
// How many vehicle-intelligence rows to consider per scan.
const VEHICLE_LIMIT = 25;

interface PendingSignal {
  signalType: string;
  make?: string | null;
  model?: string | null;
  city?: string | null;
  metro?: string | null;
  state?: string | null;
  signalValue?: number | null;
  signalContext?: Prisma.InputJsonValue;
  sourceTable?: string | null;
  sourceId?: string | null;
}

// Returns true when an identical signal (type + make + model + city) already
// exists from the trailing 7 days, so we skip re-creating it.
async function isDuplicate(s: PendingSignal): Promise<boolean> {
  const since = new Date(Date.now() - SEVEN_DAYS_MS);
  const existing = await prisma.topicSignal.findFirst({
    where: {
      signalType: s.signalType,
      make: s.make ?? null,
      model: s.model ?? null,
      city: s.city ?? null,
      createdAt: { gte: since },
    },
    select: { id: true },
  });
  return existing !== null;
}

async function createSignal(s: PendingSignal): Promise<TopicSignal | null> {
  if (await isDuplicate(s)) return null;
  return prisma.topicSignal.create({
    data: {
      signalType: s.signalType,
      make: s.make ?? null,
      model: s.model ?? null,
      city: s.city ?? null,
      metro: s.metro ?? null,
      state: s.state ?? null,
      signalValue: s.signalValue ?? null,
      signalContext: s.signalContext ?? {},
      sourceTable: s.sourceTable ?? null,
      sourceId: s.sourceId ?? null,
      assetsGenerated: false,
      expiresAt: new Date(Date.now() + SEVEN_DAYS_MS),
    },
  });
}

// 1. BUYER_LEVERAGE — metros where buyer_leverage_score is high.
async function scanBuyerLeverage(): Promise<PendingSignal[]> {
  const rows = await prisma.marketIntelligence.findMany({
    where: { buyerLeverageScore: { gt: BUYER_LEVERAGE_MIN } },
    orderBy: { buyerLeverageScore: "desc" },
    take: 20,
  });
  return rows.map((r) => ({
    signalType: "buyer_leverage",
    metro: r.metroName,
    city: r.metroName,
    state: r.state,
    signalValue: r.buyerLeverageScore,
    signalContext: {
      competitionScore: r.competitionScore,
      inventoryScore: r.inventoryScore,
      vehicleDemandScore: r.vehicleDemandScore,
    },
    sourceTable: "market_intelligence",
    sourceId: r.id,
  }));
}

// 2. HIGH_CTR_ARTICLE — long-form published articles worth repurposing.
async function scanHighCtrArticles(): Promise<PendingSignal[]> {
  const rows = await prisma.contentArticle.findMany({
    where: { status: "PUBLISHED" },
    orderBy: { wordCount: "desc" },
    take: ARTICLE_LIMIT,
  });
  return rows
    .filter((r) => r.metro && r.make)
    .map((r) => ({
      signalType: "high_ctr_article",
      make: r.make,
      model: null,
      city: r.metro,
      metro: r.metro,
      state: r.state,
      signalContext: {
        slug: r.slug,
        title: r.title,
        cluster: r.cluster,
        wordCount: r.wordCount,
      },
      sourceTable: "content_articles",
      sourceId: r.id,
    }));
}

// 3. VEHICLE_PRICE — per make/model pricing snapshots from AMIPS.
async function scanVehiclePricing(): Promise<PendingSignal[]> {
  const rows = await prisma.vehicleIntelligence.findMany({
    orderBy: { lastUpdated: "desc" },
    take: VEHICLE_LIMIT,
  });
  return rows.map((r) => ({
    signalType: "price_drop",
    make: r.make,
    model: r.model,
    signalValue: r.msrpCents / 100,
    signalContext: {
      year: r.year,
      trim: r.trim,
      fairMarketLow: r.fairMarketLowCents / 100,
      fairMarketHigh: r.fairMarketHighCents / 100,
      aggressiveTarget: r.aggressiveTargetCents / 100,
      negotiationDifficulty: r.negotiationDifficulty,
      activeIncentives: r.activeIncentives,
    },
    sourceTable: "vehicle_intelligence",
    sourceId: r.id,
  }));
}

// Gate that decides whether a signal is worth generating content from. Keeps
// low-leverage buyer signals and ultra-luxury price drops (outside AutoLenis's
// target market) out of the pipeline; trending topics always pass through.
export function filterSignalQuality(signal: {
  signalType: string;
  signalValue?: number | null;
  make?: string | null;
}): boolean {
  // Buyer leverage: only generate if score > 5.0 (neutral threshold)
  if (signal.signalType === "buyer_leverage") {
    if ((signal.signalValue ?? 0) < 5.0) {
      console.log(
        `[signal-filter] skipping low-leverage signal: ${signal.signalValue}`,
      );
      return false;
    }
  }

  // Price drop: skip ultra-luxury vehicles (above AutoLenis target market)
  if (signal.signalType === "price_drop") {
    if ((signal.signalValue ?? 0) > 80000) {
      return false;
    }
  }

  // Trending topics always pass through
  if (
    signal.signalType === "trending_topic" ||
    signal.signalType === "trending_search"
  ) {
    return true;
  }

  return true;
}

// Scans all sources and persists non-duplicate signals. Returns the rows
// actually created this run.
export async function scanForTopicSignals(): Promise<TopicSignal[]> {
  const pending: PendingSignal[] = [];
  for (const scan of [scanBuyerLeverage, scanHighCtrArticles, scanVehiclePricing]) {
    try {
      pending.push(...(await scan()));
    } catch (err) {
      console.error(`[topic-signal] scan ${scan.name} failed:`, err);
    }
  }

  const created: TopicSignal[] = [];
  for (const s of pending) {
    try {
      const row = await createSignal(s);
      if (row) created.push(row);
    } catch (err) {
      console.error(`[topic-signal] create failed for ${s.signalType}:`, err);
    }
  }

  console.log(
    `[topic-signal] scan complete: ${pending.length} candidates, ${created.length} new signals`,
  );
  return created;
}
