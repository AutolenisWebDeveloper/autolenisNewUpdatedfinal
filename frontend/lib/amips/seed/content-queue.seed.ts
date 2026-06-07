// AMIPS Phase 0 — Content Queue seeder.
//
// Seeds the content queue with priority-ordered generation work. At launch
// (before Search Intelligence has accumulated data) the opportunity score uses
// metro population as the demand proxy:
//
//   priorityScore = (metroPopulation x intentWeight x dealerCoverage)
//                   / competitionDifficulty
//
// Once Search Intelligence has 60+ days of data, AMIPS-3 swaps the population
// term for real search demand. The intent weights bias the queue toward the
// tiers that drive transactions.
//
// Seeded at launch:
//   - 100 Tier A items (national authority topics)
//   - 400 Tier B items (top 20 vehicles x 20 article angles)
//   - 500 Tier C items (top 25 metros x top 20 vehicles)
//
// Idempotent-ish: a clean re-run is achieved by keying queue rows on
// (contentTier, keywordTarget) — we skip rows whose keyword already exists so
// repeated runs do not duplicate the backlog.

import { prisma } from "@/lib/prisma";
import { VEHICLE_SEEDS } from "@/lib/amips/seed/vehicle-intelligence.seed";

// Intent weights — highest to lowest. Tier D drives transactions.
const INTENT_WEIGHT: Record<string, number> = {
  D: 4.0,
  C: 3.0,
  B: 2.0,
  A: 1.0,
};

// Top 25 US metros with hardcoded populations + primary state.
// dealerCoverage is a launch proxy (0–1) for how well-covered the metro is by
// the existing dealer cache; competitionDifficulty (1–10) approximates SEO
// difficulty. Both are refined by AMIPS-1 once dealer data is synced.
interface MetroSeed {
  metro: string;
  state: string;
  population: number;
  dealerCoverage: number;
  competitionDifficulty: number;
}

export const TOP_METROS: MetroSeed[] = [
  { metro: "Los Angeles", state: "CA", population: 13_200_000, dealerCoverage: 0.9, competitionDifficulty: 9 },
  { metro: "New York", state: "NY", population: 20_100_000, dealerCoverage: 0.9, competitionDifficulty: 10 },
  { metro: "Dallas-Fort Worth", state: "TX", population: 7_800_000, dealerCoverage: 0.85, competitionDifficulty: 7 },
  { metro: "Houston", state: "TX", population: 7_300_000, dealerCoverage: 0.85, competitionDifficulty: 7 },
  { metro: "Chicago", state: "IL", population: 9_600_000, dealerCoverage: 0.85, competitionDifficulty: 8 },
  { metro: "Miami", state: "FL", population: 6_200_000, dealerCoverage: 0.8, competitionDifficulty: 8 },
  { metro: "Atlanta", state: "GA", population: 6_300_000, dealerCoverage: 0.8, competitionDifficulty: 7 },
  { metro: "Washington DC", state: "DC", population: 6_400_000, dealerCoverage: 0.8, competitionDifficulty: 8 },
  { metro: "Phoenix", state: "AZ", population: 5_100_000, dealerCoverage: 0.8, competitionDifficulty: 6 },
  { metro: "Philadelphia", state: "PA", population: 6_200_000, dealerCoverage: 0.8, competitionDifficulty: 7 },
  { metro: "Detroit", state: "MI", population: 4_400_000, dealerCoverage: 0.75, competitionDifficulty: 6 },
  { metro: "Boston", state: "MA", population: 4_900_000, dealerCoverage: 0.8, competitionDifficulty: 7 },
  { metro: "San Antonio", state: "TX", population: 2_600_000, dealerCoverage: 0.7, competitionDifficulty: 5 },
  { metro: "Austin", state: "TX", population: 2_300_000, dealerCoverage: 0.7, competitionDifficulty: 6 },
  { metro: "Seattle", state: "WA", population: 4_000_000, dealerCoverage: 0.8, competitionDifficulty: 7 },
  { metro: "Denver", state: "CO", population: 2_900_000, dealerCoverage: 0.75, competitionDifficulty: 6 },
  { metro: "Minneapolis", state: "MN", population: 3_700_000, dealerCoverage: 0.75, competitionDifficulty: 6 },
  { metro: "Tampa", state: "FL", population: 3_300_000, dealerCoverage: 0.75, competitionDifficulty: 6 },
  { metro: "Charlotte", state: "NC", population: 2_700_000, dealerCoverage: 0.7, competitionDifficulty: 5 },
  { metro: "San Diego", state: "CA", population: 3_300_000, dealerCoverage: 0.8, competitionDifficulty: 7 },
  { metro: "Portland", state: "OR", population: 2_500_000, dealerCoverage: 0.7, competitionDifficulty: 6 },
  { metro: "Las Vegas", state: "NV", population: 2_300_000, dealerCoverage: 0.7, competitionDifficulty: 5 },
  { metro: "Nashville", state: "TN", population: 2_100_000, dealerCoverage: 0.7, competitionDifficulty: 5 },
  { metro: "Baltimore", state: "MD", population: 2_900_000, dealerCoverage: 0.7, competitionDifficulty: 6 },
  { metro: "Sacramento", state: "CA", population: 2_400_000, dealerCoverage: 0.7, competitionDifficulty: 5 },
];

// 100 Tier A national authority topics (no vehicle/metro dependency).
// These are evergreen buyer-education angles.
const TIER_A_TOPICS: string[] = [
  "how to buy a car without overpaying",
  "what is dealer markup and how to avoid it",
  "out-the-door price explained",
  "how car dealer fees work",
  "best time of year to buy a car",
  "how to negotiate a new car price",
  "msrp vs invoice price explained",
  "how dealer incentives and rebates work",
  "0% apr financing explained",
  "how to read a car buyers order",
  "trade-in value vs private sale",
  "how to avoid junk fees at the dealership",
  "leasing vs buying a car",
  "how car loan interest is calculated",
  "what credit score do you need to buy a car",
  "how to get pre-approved for a car loan",
  "extended warranty: worth it or not",
  "gap insurance explained",
  "how to buy a car out of state",
  "new vs used car: total cost of ownership",
  "how to spot a good car deal",
  "what is a fair price below msrp",
  "how dealer holdback works",
  "destination charges explained",
  "how to negotiate by email with dealers",
  "should you put money down on a car",
  "how long should a car loan be",
  "how to avoid being upsold at the dealership",
  "manufacturer rebates vs dealer discounts",
  "how to compare car loan offers",
  "what documents to bring when buying a car",
  "how to negotiate trade-in value",
  "end of model year car deals",
  "how electric vehicle tax credits work",
  "certified pre-owned explained",
  "how to avoid dealer financing markup",
  "what is a money factor on a lease",
  "residual value explained",
  "how mileage limits work on a lease",
  "how to buy a car with bad credit",
  "co-signing a car loan: what to know",
  "how to refinance a car loan",
  "what is negative equity on a trade-in",
  "how to avoid the four-square sales tactic",
  "dealer add-ons you should decline",
  "how to read a window sticker",
  "vin check before buying a car",
  "how to test drive a car the right way",
  "best months to lease a car",
  "how to negotiate a lease buyout",
  "understanding apr vs interest rate",
  "how dealers make money on financing",
  "what is a spot delivery and yo-yo financing",
  "how to budget for a car purchase",
  "total cost of ownership explained",
  "how depreciation affects resale value",
  "how to sell your car privately",
  "best way to pay for a car",
  "cash vs financing a car",
  "how to handle a high-pressure car salesperson",
  "how to get the best interest rate on a car loan",
  "what fees are negotiable at a dealership",
  "what fees are not negotiable at a dealership",
  "how to walk away from a bad car deal",
  "how to use competing offers to negotiate",
  "what is dealer-installed equipment",
  "how to verify dealer advertised prices",
  "how to avoid being charged for nitrogen tires",
  "how to negotiate the price not the payment",
  "why monthly payment shopping costs you money",
  "how to read your auto loan amortization",
  "how sales tax is calculated on a car",
  "registration and title fees explained",
  "doc fees by state explained",
  "how rebates affect your sales tax",
  "how to time a purchase around incentives",
  "how to buy a car at the end of the month",
  "how to buy a car at the end of the quarter",
  "manufacturer-to-dealer incentives explained",
  "how loyalty and conquest rebates work",
  "military and first responder car discounts",
  "recent college grad car rebates",
  "how to negotiate an electric vehicle price",
  "ev charging costs vs gas explained",
  "how to compare hybrid vs gas total cost",
  "how supply and inventory affect car prices",
  "how to tell if a market favors buyers",
  "how to research a fair price before negotiating",
  "what is the invoice price and how to find it",
  "how to use multiple dealers to compete",
  "how online car buying works",
  "how to avoid dealer markups on hot models",
  "how to negotiate when inventory is low",
  "how to negotiate when inventory is high",
  "what an auto broker does",
  "how a car buying service works",
  "questions to ask before signing a car contract",
  "red flags in a car sales contract",
  "how to cancel add-ons after buying a car",
  "your rights when buying a car",
];

// 20 article angles applied per vehicle for Tier B.
const TIER_B_ANGLES: string[] = [
  "price and msrp guide",
  "fair market value",
  "how to negotiate",
  "best time to buy",
  "incentives and rebates",
  "financing options",
  "lease deals",
  "trim comparison",
  "out-the-door price",
  "what to pay below msrp",
  "reliability and ownership cost",
  "trade-in value",
  "vs competitors comparison",
  "buying guide",
  "common dealer fees",
  "0% apr availability",
  "is it a good deal",
  "resale value",
  "fuel economy and running costs",
  "buyer faqs",
];

interface QueueDraft {
  contentTier: string;
  make?: string;
  model?: string;
  metro?: string;
  state?: string;
  intentTemplate: string;
  keywordTarget: string;
  priorityScore: number;
}

// Launch opportunity-score formula (population-based).
function launchPriority(
  population: number,
  intentWeight: number,
  dealerCoverage: number,
  competitionDifficulty: number,
): number {
  return (population * intentWeight * dealerCoverage) / competitionDifficulty;
}

// Matured opportunity-score formula (search-demand-based). Swaps the population
// proxy for real Search Console impressions and folds in realized buyer value
// (leads), so the queue self-improves as Search Intelligence accumulates.
//
//   priorityScore = (searchImpressions x intentWeight x dealerCoverage x buyerValue)
//                   / competitionDifficulty
export function searchDemandPriority(
  searchImpressions: number,
  intentWeight: number,
  dealerCoverage: number,
  buyerValue: number,
  competitionDifficulty: number,
): number {
  return (
    (searchImpressions * intentWeight * dealerCoverage * buyerValue) /
    competitionDifficulty
  );
}

// Build all queue drafts in memory (deterministic, ordered by priority).
export function buildQueueDrafts(): QueueDraft[] {
  const drafts: QueueDraft[] = [];

  // Tier A — national authority. No vehicle/metro. Use a nominal national
  // audience figure so Tier A items sort sensibly against vehicle items.
  const NATIONAL_AUDIENCE = 1_000_000;
  for (const topic of TIER_A_TOPICS) {
    drafts.push({
      contentTier: "A",
      intentTemplate: `national_authority:${topic}`,
      keywordTarget: topic,
      priorityScore: launchPriority(NATIONAL_AUDIENCE, INTENT_WEIGHT.A, 1, 5),
    });
  }

  // Tier B — vehicle authority. top 20 vehicles x 20 angles = 400.
  // Vehicle-level demand proxy uses the national audience scaled by coverage.
  for (const v of VEHICLE_SEEDS) {
    for (const angle of TIER_B_ANGLES) {
      const keyword = `${v.year} ${v.make} ${v.model} ${angle}`;
      drafts.push({
        contentTier: "B",
        make: v.make,
        model: v.model,
        intentTemplate: `vehicle_authority:${angle}`,
        keywordTarget: keyword,
        priorityScore: launchPriority(NATIONAL_AUDIENCE, INTENT_WEIGHT.B, 0.8, 5),
      });
    }
  }

  // Tier C — metro intelligence. top 25 metros x top 20 vehicles = 500.
  for (const m of TOP_METROS) {
    for (const v of VEHICLE_SEEDS) {
      const keyword = `${v.make} ${v.model} deals in ${m.metro}`;
      drafts.push({
        contentTier: "C",
        make: v.make,
        model: v.model,
        metro: m.metro,
        state: m.state,
        intentTemplate: `metro_intelligence:${m.metro}`,
        keywordTarget: keyword,
        priorityScore: launchPriority(
          m.population,
          INTENT_WEIGHT.C,
          m.dealerCoverage,
          m.competitionDifficulty,
        ),
      });
    }
  }

  // Highest priority first.
  drafts.sort((a, b) => b.priorityScore - a.priorityScore);
  return drafts;
}

/**
 * Seed the content queue. Skips keyword targets that already exist so repeated
 * runs do not duplicate the backlog.
 */
export async function seedContentQueue(): Promise<{
  inserted: number;
  skipped: number;
  byTier: Record<string, number>;
}> {
  const drafts = buildQueueDrafts();
  console.log(
    `[amips-seed] content-queue: ${drafts.length} drafts built (A/B/C)`,
  );

  // Existing keyword targets, to keep the seed idempotent.
  const existing = await prisma.contentQueue.findMany({
    select: { keywordTarget: true },
  });
  const existingKeys = new Set(existing.map((e) => e.keywordTarget));

  const toInsert = drafts.filter((d) => !existingKeys.has(d.keywordTarget));
  const skipped = drafts.length - toInsert.length;

  if (toInsert.length > 0) {
    await prisma.contentQueue.createMany({
      data: toInsert.map((d) => ({
        contentTier: d.contentTier,
        make: d.make ?? null,
        model: d.model ?? null,
        metro: d.metro ?? null,
        state: d.state ?? null,
        intentTemplate: d.intentTemplate,
        keywordTarget: d.keywordTarget,
        priorityScore: d.priorityScore,
        status: "pending",
      })),
    });
  }

  const byTier: Record<string, number> = {};
  for (const d of toInsert) {
    byTier[d.contentTier] = (byTier[d.contentTier] ?? 0) + 1;
  }

  console.log(
    `[amips-seed] content-queue: inserted ${toInsert.length}, skipped ${skipped} (already present)`,
  );
  console.log(
    `[amips-seed] content-queue: by tier — A:${byTier.A ?? 0} B:${byTier.B ?? 0} C:${byTier.C ?? 0}`,
  );

  return { inserted: toInsert.length, skipped, byTier };
}

// --- AMIPS Phase 3 — search-demand re-prioritization ---------------------

const SEARCH_MATURITY_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

// Metro → launch dealerCoverage / competitionDifficulty, for reuse in the
// search-demand formula (these factors are metro-level, not search-derived).
const METRO_FACTORS = new Map(
  TOP_METROS.map((m) => [
    m.metro,
    { dealerCoverage: m.dealerCoverage, competitionDifficulty: m.competitionDifficulty },
  ]),
);

/**
 * True once Search Intelligence has accumulated at least 60 days of data — the
 * AMIPS threshold for switching the queue from population- to demand-based
 * prioritization.
 */
export async function hasMaturedSearchIntelligence(
  minDays = SEARCH_MATURITY_DAYS,
): Promise<boolean> {
  const earliest = await prisma.searchIntelligence.findFirst({
    orderBy: { weekOf: "asc" },
    select: { weekOf: true },
  });
  if (!earliest) return false;
  const ageDays = (Date.now() - new Date(earliest.weekOf).getTime()) / DAY_MS;
  return ageDays >= minDays;
}

/**
 * Re-prioritize the content queue. While Search Intelligence is immature this is
 * a no-op (the population-based launch scores stand). Once matured, every queue
 * item linked to a published page is rescored from that page's real Search
 * Console impressions and realized leads. This is the "cron demand engine"
 * invoked weekly after the search sync.
 */
export async function reprioritizeContentQueue(): Promise<{
  reprioritized: number;
  mode: "launch" | "search";
}> {
  const matured = await hasMaturedSearchIntelligence();
  if (!matured) {
    console.log("[amips-p3-queue] search intelligence immature; keeping launch priority");
    return { reprioritized: 0, mode: "launch" };
  }

  // Only items linked to a generated page have real demand to read from.
  const items = await prisma.contentQueue.findMany({
    where: { contentPageId: { not: null } },
    select: { id: true, contentTier: true, metro: true, contentPageId: true },
  });
  if (items.length === 0) return { reprioritized: 0, mode: "search" };

  const pageIds = items.map((i) => i.contentPageId as string);
  const pages = await prisma.amipsPage.findMany({
    where: { id: { in: pageIds } },
    select: { id: true, impressions: true, leadsGenerated: true },
  });
  const pageById = new Map(pages.map((p) => [p.id, p]));

  let reprioritized = 0;
  for (const item of items) {
    const page = item.contentPageId ? pageById.get(item.contentPageId) : undefined;
    if (!page || page.impressions <= 0) continue; // no demand signal yet

    const intentWeight = INTENT_WEIGHT[item.contentTier] ?? 2.0;
    const factors = item.metro ? METRO_FACTORS.get(item.metro) : undefined;
    const dealerCoverage = factors?.dealerCoverage ?? 0.8;
    const competitionDifficulty = factors?.competitionDifficulty ?? 5;
    const buyerValue = Math.max(1, page.leadsGenerated);

    const priorityScore = searchDemandPriority(
      page.impressions,
      intentWeight,
      dealerCoverage,
      buyerValue,
      competitionDifficulty,
    );

    await prisma.contentQueue.update({
      where: { id: item.id },
      data: { priorityScore },
    });
    reprioritized++;
  }

  console.log(`[amips-p3-queue] reprioritized ${reprioritized} items from search demand`);
  return { reprioritized, mode: "search" };
}
