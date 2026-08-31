// AMIPS — Executive Intelligence Engine.
//
// Turns the six AMIPS intelligence databases from a pile of record counts into
// decision-grade business intelligence. Every number here traces to a real
// database field (the same "no data, never estimated" rule the public Market
// Score follows). Projections are explicitly labelled and use a stated method —
// we never present a fabricated figure as an observed one.
//
// The page layer renders what this engine returns; all querying, weighting, and
// insight generation lives here so the methodology is auditable in one place and
// the pure scoring functions can be unit-tested.

import { prisma } from "@/lib/prisma";
import { haversineMiles } from "@/lib/utils/zip-coords";
import { getMetroDefs, METRO_MEMBERSHIP_RADIUS_MILES } from "@/lib/amips/metros";
import { loadStalenessRunway, type StalenessRunway } from "@/lib/amips/staleness-runway.service";
import {
  computeIndexationGates,
  decideFromRate,
  type IndexationGate,
} from "@/lib/amips/indexation-gate";

// ---------------------------------------------------------------------------
// Tunable methodology constants — surfaced in the UI so scores are explainable.
// ---------------------------------------------------------------------------

/** Top-metro program size. Coverage and depth are measured against this. */
export const METRO_UNIVERSE = 25;

/** Freshness windows (days) per the quality-gate lineage rules. */
export const FRESHNESS_DAYS = { vehicle: 180, dealer: 90, market: 30 } as const;

/** Dealers within a metro that we treat as "fully covered" for opportunity. */
const COVERAGE_TARGET_DEALERS = 15;

/** Published pages per metro we treat as "fully built out" for opportunity. */
const CONTENT_TARGET_PAGES = 10;

/** Monthly publishing throughput treated as a healthy stage-1 cadence. */
const VELOCITY_TARGET_30D = 200;

/** National Market Health Index component weights (must sum to 1.0). */
export const HEALTH_WEIGHTS = {
  buyerLeverage: 0.25,
  dealerCoverage: 0.2,
  marketDepth: 0.15,
  indexationHealth: 0.15,
  dataFreshness: 0.15,
  publishingVelocity: 0.1,
} as const;

/** Metro Opportunity Score component weights (must sum to 1.0). */
const OPPORTUNITY_WEIGHTS = {
  demand: 0.25,
  population: 0.2,
  leverage: 0.2,
  contentGap: 0.2,
  coverageGap: 0.15,
} as const;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type Trend = "up" | "down" | "flat";
export type InsightCategory = "opportunity" | "risk" | "performance" | "recommendation";
export type RiskSeverity = "high" | "medium" | "low";

export interface HealthComponent {
  key: keyof typeof HEALTH_WEIGHTS;
  label: string;
  /** 0–100 sub-score. */
  value: number;
  weight: number;
  caption: string;
}

export interface MarketHealthIndex {
  score: number; // 0–100
  grade: string;
  tone: "strong" | "healthy" | "developing" | "early" | "initializing";
  components: HealthComponent[];
}

export interface TrendInfo {
  dir: Trend;
  /** Short human label, e.g. "+3 vs Jun 19". */
  label: string;
}

export interface HeadlineMetric {
  key: string;
  label: string;
  value: string;
  caption: string;
  trend?: TrendInfo;
}

export interface OpportunityMarket {
  metro: string;
  state: string;
  population: number | null;
  demandScore: number | null; // 0–10
  buyerLeverage: number | null; // 0–10
  dealers: number;
  pages: number;
  opportunityScore: number; // 0–100
  driver: string; // dominant factor
  seasonalNote: string | null;
}

export interface VehicleSegment {
  make: string;
  model: string;
  avgBuyerAdvantage: number; // 0–10
  metros: number;
  dealers: number;
  outlook: string;
}

export interface ContentPerformance {
  activePages: number;
  underReview: number;
  refreshRequired: number;
  retired: number;
  published30d: number;
  published7d: number;
  projectedNext30d: number; // labelled projection
  impressions: number;
  clicks: number;
  ctr: number | null; // 0–1
  avgPosition: number | null;
  leads: number;
  revenueAttributionCents: number;
  revenueRunRateCents: number; // annualised from trailing 4 weeks
  indexationRate: number; // 0–1
  indexationDecision: ReturnType<typeof decideFromRate>;
  tierMix: Array<{ tier: string; count: number }>;
  topPages: Array<{ url: string; clicks: number; leads: number; revenueCents: number }>;
}

export interface Insight {
  id: string;
  category: InsightCategory;
  title: string;
  detail: string;
  metric?: string;
  action: string;
  /** Destination for the insight CTA — a drill-down route or an in-page anchor. */
  href?: string;
}

export interface RiskItem {
  id: string;
  severity: RiskSeverity;
  title: string;
  detail: string;
  count: number;
  action: string;
}

export interface OperationsSnapshot {
  vehicleRecords: number;
  dealerRecords: number;
  marketsScored: number;
  cachedScores: number;
  freshnessPct: number; // 0–1
  queue: { pending: number; inProgress: number; complete: number; failed: number };
  indexationGates: IndexationGate[];
}

export interface ExecutiveIntelligence {
  generatedAt: string;
  hasData: boolean;
  health: MarketHealthIndex;
  headline: HeadlineMetric[];
  insights: Insight[];
  opportunities: OpportunityMarket[];
  segments: VehicleSegment[];
  content: ContentPerformance;
  risks: RiskItem[];
  coverage: { metrosCovered: number; metrosScored: number; universe: number };
  operations: OperationsSnapshot;
  /** Health-score change since the most recent snapshot, if one exists. */
  healthTrend?: TrendInfo;
  /** ISO date of the baseline snapshot used for all trend deltas. */
  trendSince?: string;
  /**
   * Countdown to the staleness bound across the servable corpus. Surfaced beside
   * the corpus counts because it is a property OF those counts: it says how long
   * the pages the dashboard is reporting on will keep serving.
   */
  stalenessRunway: StalenessRunway;
}

// ---------------------------------------------------------------------------
// Pure scoring helpers (unit-testable, no I/O)
// ---------------------------------------------------------------------------

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const round = (n: number, d = 0) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

export function healthTone(score: number): MarketHealthIndex["tone"] {
  if (score >= 80) return "strong";
  if (score >= 60) return "healthy";
  if (score >= 40) return "developing";
  if (score >= 20) return "early";
  return "initializing";
}

export function healthGrade(tone: MarketHealthIndex["tone"]): string {
  return {
    strong: "Strong",
    healthy: "Healthy",
    developing: "Developing",
    early: "Early Stage",
    initializing: "Initializing",
  }[tone];
}

/** Compose the National Market Health Index from normalized 0–100 components. */
export function computeHealthIndex(components: HealthComponent[]): MarketHealthIndex {
  const score = round(
    components.reduce((acc, c) => acc + (c.value / 100) * c.weight, 0) * 100,
  );
  const tone = healthTone(score);
  return { score, grade: healthGrade(tone), tone, components };
}

/** Opportunity score (0–100): unmet demand × under-coverage. */
export function computeOpportunityScore(input: {
  demandScore: number | null;
  buyerLeverage: number | null;
  population: number | null;
  maxPopulation: number;
  dealers: number;
  pages: number;
}): { score: number; driver: string } {
  const demand = clamp01((input.demandScore ?? 0) / 10);
  const leverage = clamp01((input.buyerLeverage ?? 0) / 10);
  const population = input.maxPopulation > 0
    ? clamp01((input.population ?? 0) / input.maxPopulation)
    : 0;
  const coverageGap = clamp01(1 - input.dealers / COVERAGE_TARGET_DEALERS);
  const contentGap = clamp01(1 - input.pages / CONTENT_TARGET_PAGES);

  const contributions: Array<{ label: string; v: number }> = [
    { label: "Demand", v: demand * OPPORTUNITY_WEIGHTS.demand },
    { label: "Population", v: population * OPPORTUNITY_WEIGHTS.population },
    { label: "Buyer Leverage", v: leverage * OPPORTUNITY_WEIGHTS.leverage },
    { label: "Content Gap", v: contentGap * OPPORTUNITY_WEIGHTS.contentGap },
    { label: "Coverage Gap", v: coverageGap * OPPORTUNITY_WEIGHTS.coverageGap },
  ];
  const score = round(contributions.reduce((a, c) => a + c.v, 0) * 100);
  const driver = contributions.reduce((a, b) => (b.v > a.v ? b : a)).label;
  return { score, driver };
}

function segmentOutlook(avg: number, metros: number): string {
  if (metros < 2) return "Limited coverage";
  if (avg >= 7.5) return "Strong buyer advantage";
  if (avg >= 5.5) return "Favorable to buyers";
  if (avg >= 4) return "Balanced market";
  return "Seller-leaning";
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const pct = (num: number, den: number) => (den > 0 ? num / den : 0);

// Drill-down / anchor destinations for the insight CTAs.
const metroPath = (m: string) => `/admin/amips/metro/${encodeURIComponent(m)}`;
const vehiclePath = (mk: string, md: string) =>
  `/admin/amips/vehicle/${encodeURIComponent(mk)}/${encodeURIComponent(md)}`;

function emptyIntelligence(): ExecutiveIntelligence {
  const components: HealthComponent[] = (
    Object.keys(HEALTH_WEIGHTS) as Array<keyof typeof HEALTH_WEIGHTS>
  ).map((key) => ({
    key,
    label: key,
    value: 0,
    weight: HEALTH_WEIGHTS[key],
    caption: "Awaiting data",
  }));
  return {
    generatedAt: new Date().toISOString(),
    hasData: false,
    health: computeHealthIndex(components),
    headline: [],
    insights: [
      {
        id: "init",
        category: "recommendation",
        title: "Intelligence foundation is initializing",
        detail:
          "No AMIPS intelligence records are populated yet. Run the dealer, market, and score syncs to begin generating market intelligence.",
        action: "Run syncs in Operations",
        href: "#operations",
      },
    ],
    opportunities: [],
    segments: [],
    content: {
      activePages: 0, underReview: 0, refreshRequired: 0, retired: 0,
      published30d: 0, published7d: 0, projectedNext30d: 0,
      impressions: 0, clicks: 0, ctr: null, avgPosition: null, leads: 0,
      revenueAttributionCents: 0, revenueRunRateCents: 0,
      indexationRate: 0, indexationDecision: "pause",
      tierMix: [], topPages: [],
    },
    risks: [],
    coverage: { metrosCovered: 0, metrosScored: 0, universe: METRO_UNIVERSE },
    operations: {
      vehicleRecords: 0, dealerRecords: 0, marketsScored: 0, cachedScores: 0,
      freshnessPct: 0,
      queue: { pending: 0, inProgress: 0, complete: 0, failed: 0 },
      indexationGates: [],
    },
    // No corpus, so nothing can withhold. Explicit rather than optional: the
    // dashboard should never have to guess whether a missing runway means
    // "healthy" or "not computed".
    stalenessRunway: {
      servablePages: 0, undatedPages: 0,
      minDaysToWithhold: null, firstWithholdDate: null,
      isSingleDayCliff: false,
      within30: 0, within60: 0, within90: 0, alreadyWithheld: 0,
      severity: "OK",
    },
  };
}

/**
 * Load and compute the full executive-intelligence payload. Resilient by
 * design: if the database is unavailable (e.g. at build time) it returns an
 * empty-but-valid structure rather than throwing.
 */
export async function loadExecutiveIntelligence(): Promise<ExecutiveIntelligence> {
  try {
    return await loadInner();
  } catch {
    return emptyIntelligence();
  }
}

async function loadInner(): Promise<ExecutiveIntelligence> {
  const metroDefs = getMetroDefs();

  const [
    vehicleCount, vehicleStale,
    dealerCount, dealerStale, dealerRows,
    markets,
    marketScoreAgg, scoresByVehicle,
    queueByStatus,
    pagesByLifecycle, pagesByTier, pagesAgg,
    published30d, published7d, pagesByMetro,
    searchAll, search4w, topPagesAgg,
    indexationGates,
    txnCount,
  ] = await Promise.all([
    prisma.vehicleIntelligence.count(),
    prisma.vehicleIntelligence.count({ where: { lastUpdated: { lt: daysAgo(FRESHNESS_DAYS.vehicle) } } }),
    prisma.dealerIntelligence.count(),
    prisma.dealerIntelligence.count({ where: { lastUpdated: { lt: daysAgo(FRESHNESS_DAYS.dealer) } } }),
    prisma.dealerIntelligence.findMany({
      where: { latitude: { not: null }, longitude: { not: null } },
      select: { latitude: true, longitude: true },
    }),
    prisma.marketIntelligence.findMany({
      select: {
        metroName: true, state: true, population: true, vehicleDemandScore: true,
        competitionScore: true, inventoryScore: true, buyerLeverageScore: true,
        seasonalNotes: true, lastUpdated: true,
      },
    }),
    prisma.amipsMarketScore.aggregate({ _avg: { overallBuyerAdvantage: true }, _count: { _all: true } }),
    prisma.amipsMarketScore.groupBy({
      by: ["make", "model"],
      _avg: { overallBuyerAdvantage: true },
      _sum: { dealerCount: true },
      _count: { _all: true },
    }),
    prisma.contentQueue.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.amipsPage.groupBy({ by: ["lifecycleStatus"], _count: { _all: true } }),
    prisma.amipsPage.groupBy({ by: ["contentTier"], _count: { _all: true } }),
    prisma.amipsPage.aggregate({ _sum: { impressions: true, clicks: true, leadsGenerated: true } }),
    prisma.amipsPage.count({ where: { publishedAt: { gte: daysAgo(30) } } }),
    prisma.amipsPage.count({ where: { publishedAt: { gte: daysAgo(7) } } }),
    prisma.amipsPage.groupBy({ by: ["metro"], _count: { _all: true }, where: { metro: { not: null } } }),
    prisma.searchIntelligence.aggregate({
      _sum: { searchImpressions: true, clicks: true, leadsGenerated: true, revenueAttribution: true },
      _avg: { ctr: true, avgPosition: true },
    }),
    prisma.searchIntelligence.aggregate({
      where: { weekOf: { gte: daysAgo(28) } },
      _sum: { revenueAttribution: true, leadsGenerated: true },
    }),
    prisma.searchIntelligence.groupBy({
      by: ["url"],
      _sum: { clicks: true, leadsGenerated: true, revenueAttribution: true },
      orderBy: { _sum: { leadsGenerated: "desc" } },
      take: 5,
    }),
    computeIndexationGates(),
    prisma.marketplaceIntelligence.count().catch(() => 0),
  ]);

  const statusCount = (s: string) =>
    queueByStatus.find((q) => q.status === s)?._count._all ?? 0;
  const lifecycleCount = (s: string) =>
    pagesByLifecycle.find((p) => p.lifecycleStatus === s)?._count._all ?? 0;

  // --- Dealer counts per metro (haversine membership) ---
  const dealerCoords = dealerRows.map((d) => ({
    lat: d.latitude as number,
    lng: d.longitude as number,
  }));
  const dealersInMetro = new Map<string, number>();
  for (const def of metroDefs) {
    let n = 0;
    for (const c of dealerCoords) {
      if (haversineMiles(def.center, c) <= METRO_MEMBERSHIP_RADIUS_MILES) n++;
    }
    dealersInMetro.set(def.metro, n);
  }
  const metrosCovered = [...dealersInMetro.values()].filter((n) => n > 0).length;

  const pagesByMetroMap = new Map(
    pagesByMetro.map((p) => [p.metro as string, p._count._all]),
  );
  const marketByMetro = new Map(markets.map((m) => [m.metroName, m]));

  // --- Aggregate signals ---
  const leverageVals = markets
    .map((m) => m.buyerLeverageScore)
    .filter((v): v is number => v != null);
  const avgLeverage = leverageVals.length
    ? leverageVals.reduce((a, b) => a + b, 0) / leverageVals.length
    : 0;
  const avgMarketScore = marketScoreAgg._avg.overallBuyerAdvantage ?? 0;

  // --- Indexation rollup ---
  const submittedTotal = indexationGates.reduce((a, g) => a + g.submitted, 0);
  const indexedTotal = indexationGates.reduce((a, g) => a + g.indexed, 0);
  const indexationRate = pct(indexedTotal, submittedTotal);
  const indexationDecision = decideFromRate(indexationRate || 0);

  // --- Data freshness (share of records inside their window) ---
  const freshRecords =
    (vehicleCount - vehicleStale) + (dealerCount - dealerStale) +
    markets.filter((m) => m.lastUpdated >= daysAgo(FRESHNESS_DAYS.market)).length;
  const totalRecords = vehicleCount + dealerCount + markets.length;
  const freshnessPct = pct(freshRecords, totalRecords);

  // --- Health components (each 0–100) ---
  const components: HealthComponent[] = [
    {
      key: "buyerLeverage", label: "Buyer Leverage", weight: HEALTH_WEIGHTS.buyerLeverage,
      value: round(clamp01(avgLeverage / 10) * 100),
      caption: `Avg ${avgLeverage.toFixed(1)}/10 across ${markets.length} scored metros`,
    },
    {
      key: "dealerCoverage", label: "Dealer Coverage", weight: HEALTH_WEIGHTS.dealerCoverage,
      value: round(clamp01(metrosCovered / METRO_UNIVERSE) * 100),
      caption: `${metrosCovered} of ${METRO_UNIVERSE} metros with tracked dealers`,
    },
    {
      key: "marketDepth", label: "Market Depth", weight: HEALTH_WEIGHTS.marketDepth,
      value: round(clamp01(markets.length / METRO_UNIVERSE) * 100),
      caption: `${markets.length} of ${METRO_UNIVERSE} metros fully scored`,
    },
    {
      key: "indexationHealth", label: "Indexation Health", weight: HEALTH_WEIGHTS.indexationHealth,
      value: round(clamp01(indexationRate) * 100),
      caption: submittedTotal > 0
        ? `${Math.round(indexationRate * 100)}% of published URLs indexed`
        : "No published cohorts yet",
    },
    {
      key: "dataFreshness", label: "Data Freshness", weight: HEALTH_WEIGHTS.dataFreshness,
      value: round(clamp01(freshnessPct) * 100),
      caption: totalRecords > 0
        ? `${Math.round(freshnessPct * 100)}% of records within freshness window`
        : "No intelligence records yet",
    },
    {
      key: "publishingVelocity", label: "Publishing Velocity", weight: HEALTH_WEIGHTS.publishingVelocity,
      value: round(clamp01(published30d / VELOCITY_TARGET_30D) * 100),
      caption: `${published30d} pages published in last 30 days`,
    },
  ];
  const health = computeHealthIndex(components);

  // --- Opportunity rankings ---
  const maxPopulation = Math.max(0, ...markets.map((m) => m.population ?? 0));
  const opportunities: OpportunityMarket[] = metroDefs
    .map((def) => {
      const m = marketByMetro.get(def.metro);
      const dealers = dealersInMetro.get(def.metro) ?? 0;
      const pages = pagesByMetroMap.get(def.metro) ?? 0;
      const { score, driver } = computeOpportunityScore({
        demandScore: m?.vehicleDemandScore ?? null,
        buyerLeverage: m?.buyerLeverageScore ?? null,
        population: m?.population ?? null,
        maxPopulation,
        dealers,
        pages,
      });
      return {
        metro: def.metro,
        state: def.state,
        population: m?.population ?? null,
        demandScore: m?.vehicleDemandScore ?? null,
        buyerLeverage: m?.buyerLeverageScore ?? null,
        dealers,
        pages,
        opportunityScore: score,
        driver,
        seasonalNote: m?.seasonalNotes ?? null,
      };
    })
    .sort((a, b) => b.opportunityScore - a.opportunityScore);

  // --- Vehicle segment intelligence ---
  const segments: VehicleSegment[] = scoresByVehicle
    .map((s) => {
      const avg = s._avg.overallBuyerAdvantage ?? 0;
      return {
        make: s.make,
        model: s.model,
        avgBuyerAdvantage: round(avg, 1),
        metros: s._count._all,
        dealers: s._sum.dealerCount ?? 0,
        outlook: segmentOutlook(avg, s._count._all),
      };
    })
    .sort((a, b) => b.avgBuyerAdvantage - a.avgBuyerAdvantage)
    .slice(0, 6);

  // --- Content performance ---
  const revenue4w = search4w._sum.revenueAttribution ?? 0;
  const dailyVelocity = published30d / 30;
  const content: ContentPerformance = {
    activePages: lifecycleCount("ACTIVE"),
    underReview: lifecycleCount("UNDER_REVIEW"),
    refreshRequired: lifecycleCount("REFRESH_REQUIRED"),
    retired: lifecycleCount("RETIRED"),
    published30d,
    published7d,
    projectedNext30d: round(dailyVelocity * 30),
    impressions: (searchAll._sum.searchImpressions ?? 0) || (pagesAgg._sum.impressions ?? 0),
    clicks: (searchAll._sum.clicks ?? 0) || (pagesAgg._sum.clicks ?? 0),
    ctr: searchAll._avg.ctr ?? null,
    avgPosition: searchAll._avg.avgPosition ?? null,
    leads: (searchAll._sum.leadsGenerated ?? 0) || (pagesAgg._sum.leadsGenerated ?? 0),
    revenueAttributionCents: searchAll._sum.revenueAttribution ?? 0,
    revenueRunRateCents: round(revenue4w * 13), // 4 weeks → annualised (×13)
    indexationRate,
    indexationDecision,
    tierMix: pagesByTier
      .map((t) => ({ tier: t.contentTier, count: t._count._all }))
      .sort((a, b) => a.tier.localeCompare(b.tier)),
    topPages: topPagesAgg.map((p) => ({
      url: p.url,
      clicks: p._sum.clicks ?? 0,
      leads: p._sum.leadsGenerated ?? 0,
      revenueCents: p._sum.revenueAttribution ?? 0,
    })),
  };

  // --- Risk monitoring ---
  const uncoveredHighPop = markets.filter(
    (m) => (m.population ?? 0) > 1_000_000 && (dealersInMetro.get(m.metroName) ?? 0) === 0,
  ).length;
  const failedQueue = statusCount("failed");
  const risks: RiskItem[] = [];
  const pausedCohorts = indexationGates.filter((g) => g.decision === "pause").length;
  if (pausedCohorts > 0)
    risks.push({
      id: "indexation-pause", severity: "high", count: pausedCohorts,
      title: "Indexation cohorts paused",
      detail: `${pausedCohorts} publish-week cohort(s) are below the 50% indexation floor. New generation should pause until quality signals recover.`,
      action: "Review indexation gate",
    });
  if (vehicleStale + dealerStale > 0)
    risks.push({
      id: "stale-data", severity: "medium", count: vehicleStale + dealerStale,
      title: "Stale intelligence records",
      detail: `${vehicleStale} vehicle and ${dealerStale} dealer record(s) are outside their freshness window and will block or downgrade page generation.`,
      action: "Re-run syncs",
    });
  if (uncoveredHighPop > 0)
    risks.push({
      id: "coverage-gap", severity: "medium", count: uncoveredHighPop,
      title: "High-population metros uncovered",
      detail: `${uncoveredHighPop} metro(s) over 1M population have no tracked dealers — a coverage and revenue gap.`,
      action: "Expand dealer discovery",
    });
  if (failedQueue > 0)
    risks.push({
      id: "failed-queue", severity: "medium", count: failedQueue,
      title: "Failed queue items",
      detail: `${failedQueue} content-queue item(s) failed generation and need investigation.`,
      action: "Inspect failures",
    });
  if (content.refreshRequired > 0)
    risks.push({
      id: "refresh-required", severity: "low", count: content.refreshRequired,
      title: "Pages flagged for refresh",
      detail: `${content.refreshRequired} active page(s) have stale data lineage or have lost search visibility.`,
      action: "Schedule refresh",
    });
  if (marketScoreAgg._count._all === 0 && (vehicleCount > 0 || dealerCount > 0))
    risks.push({
      id: "no-scores", severity: "medium", count: 0,
      title: "Market scores not computed",
      detail: "Source data exists but no Market Scores are cached. Pages cannot render buyer-advantage tables until scores are computed.",
      action: "Compute market scores",
    });

  // --- Insight feed (auto-generated from the signals above) ---
  const insights: Insight[] = [];
  insights.push({
    id: "health", category: "performance",
    title: `National Market Health is ${health.grade.toLowerCase()} at ${health.score}/100`,
    detail: `Driven by ${[...components].sort((a, b) => b.value * b.weight - a.value * a.weight)[0].label.toLowerCase()}. ${markets.length} of ${METRO_UNIVERSE} metros are scored with an average buyer leverage of ${avgLeverage.toFixed(1)}/10.`,
    metric: `${health.score}/100`,
    action: "Open health breakdown",
    href: "#market-health",
  });
  const topOpp = opportunities.find((o) => o.opportunityScore > 0);
  if (topOpp)
    insights.push({
      id: "top-opp", category: "opportunity",
      title: `${topOpp.metro} is the top expansion opportunity`,
      detail: `Opportunity score ${topOpp.opportunityScore}/100, led by ${topOpp.driver.toLowerCase()}. ${topOpp.dealers} dealers and ${topOpp.pages} published pages today${topOpp.population ? ` against ${(topOpp.population / 1_000_000).toFixed(1)}M residents` : ""}.`,
      metric: `${topOpp.opportunityScore}/100`,
      action: `Open ${topOpp.metro} profile`,
      href: metroPath(topOpp.metro),
    });
  if (segments[0])
    insights.push({
      id: "top-vehicle", category: "performance",
      title: `${segments[0].make} ${segments[0].model} leads buyer advantage`,
      detail: `Averaging ${segments[0].avgBuyerAdvantage.toFixed(1)}/10 across ${segments[0].metros} metro${segments[0].metros === 1 ? "" : "s"} — ${segments[0].outlook.toLowerCase()}.`,
      metric: `${segments[0].avgBuyerAdvantage.toFixed(1)}/10`,
      action: `Open ${segments[0].make} ${segments[0].model} profile`,
      href: vehiclePath(segments[0].make, segments[0].model),
    });
  if (submittedTotal > 0)
    insights.push({
      id: "indexation", category: "recommendation",
      title: `Indexation at ${Math.round(indexationRate * 100)}% — ${indexationDecision} recommended`,
      detail: `${indexedTotal} of ${submittedTotal} published URLs are indexed. The gate recommends "${indexationDecision}" for generation volume.`,
      metric: `${Math.round(indexationRate * 100)}%`,
      action: "Review indexation gate",
      href: "#operations",
    });
  if (content.revenueAttributionCents > 0)
    insights.push({
      id: "revenue", category: "performance",
      title: `Content has attributed ${usd(content.revenueAttributionCents)} in pipeline`,
      detail: `${content.leads.toLocaleString("en-US")} leads generated to date, with an annualised run-rate of ${usd(content.revenueRunRateCents)} based on the trailing four weeks.`,
      metric: usd(content.revenueRunRateCents),
      action: "View content performance",
      href: "#content",
    });
  const contentGapMetro = opportunities.find(
    (o) => (o.buyerLeverage ?? 0) >= 6 && o.pages < CONTENT_TARGET_PAGES,
  );
  if (contentGapMetro)
    insights.push({
      id: "content-gap", category: "opportunity",
      title: `${contentGapMetro.metro} is under-published for its buyer advantage`,
      detail: `Buyer leverage is ${(contentGapMetro.buyerLeverage ?? 0).toFixed(1)}/10 but only ${contentGapMetro.pages} page(s) are live — a high-conviction content expansion target.`,
      action: `Open ${contentGapMetro.metro} profile`,
      href: metroPath(contentGapMetro.metro),
    });
  if (txnCount > 0)
    insights.push({
      id: "txn", category: "performance",
      title: `${txnCount.toLocaleString("en-US")} verified transactions feeding Tier F intelligence`,
      detail: "Real marketplace transactions are accumulating toward the 50-deal threshold that unlocks proprietary Tier F content.",
      action: "View content performance",
      href: "#content",
    });

  // --- Headline metrics ---
  const headline: HeadlineMetric[] = [
    {
      key: "active-markets", label: "Active Markets",
      value: `${markets.length}/${METRO_UNIVERSE}`,
      caption: `${metrosCovered} with dealer coverage`,
    },
    {
      key: "buyer-leverage", label: "Avg Buyer Leverage",
      value: avgLeverage > 0 ? `${avgLeverage.toFixed(1)}/10` : "—",
      caption: avgMarketScore > 0 ? `Vehicle advantage ${avgMarketScore.toFixed(1)}/10` : "Awaiting scores",
    },
    {
      key: "revenue", label: "Revenue Run-Rate",
      value: content.revenueRunRateCents > 0 ? usd(content.revenueRunRateCents) : "—",
      caption: content.leads > 0 ? `${content.leads.toLocaleString("en-US")} leads attributed` : "Awaiting search data",
    },
    {
      key: "velocity", label: "Publishing Velocity",
      value: `${published30d}/mo`,
      caption: `~${content.projectedNext30d} projected next 30d`,
    },
  ];

  const stalenessRunway = await loadStalenessRunway();

  const payload: ExecutiveIntelligence = {
    generatedAt: new Date().toISOString(),
    stalenessRunway,
    hasData: totalRecords > 0 || content.activePages > 0,
    health,
    headline,
    insights,
    opportunities,
    segments,
    content,
    risks,
    coverage: { metrosCovered, metrosScored: markets.length, universe: METRO_UNIVERSE },
    operations: {
      vehicleRecords: vehicleCount,
      dealerRecords: dealerCount,
      marketsScored: markets.length,
      cachedScores: marketScoreAgg._count._all,
      freshnessPct,
      queue: {
        pending: statusCount("pending"),
        inProgress: statusCount("in_progress"),
        complete: statusCount("complete"),
        failed: failedQueue,
      },
      indexationGates,
    },
  };

  // Attach trend deltas against the most recent snapshot. Isolated in its own
  // try/catch because the snapshot table may not exist until the Phase 5
  // migration is applied — a missing table must never break the dashboard.
  await attachTrends(payload, { avgLeverage });

  return payload;
}

// ---------------------------------------------------------------------------
// Trends — compare live metrics against the most recent stored snapshot.
// ---------------------------------------------------------------------------

function trendLabel(delta: number, since: string, opts: { fmt?: (n: number) => string } = {}): TrendInfo {
  const dir: Trend = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const mag = opts.fmt ? opts.fmt(Math.abs(delta)) : `${Math.abs(delta)}`;
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "±";
  return { dir, label: `${sign}${mag} vs ${since}` };
}

async function attachTrends(
  payload: ExecutiveIntelligence,
  ctx: { avgLeverage: number },
): Promise<void> {
  let prev: {
    capturedAt: Date; healthScore: number; metrosScored: number;
    avgBuyerLeverage: number; revenueRunRateCents: number; published30d: number;
  } | null = null;
  try {
    prev = await prisma.amipsIntelligenceSnapshot.findFirst({
      orderBy: { capturedAt: "desc" },
      select: {
        capturedAt: true, healthScore: true, metrosScored: true,
        avgBuyerLeverage: true, revenueRunRateCents: true, published30d: true,
      },
    });
  } catch {
    return; // table not migrated yet — skip trends silently
  }
  if (!prev) return;

  const since = prev.capturedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  payload.trendSince = prev.capturedAt.toISOString().slice(0, 10);
  payload.healthTrend = trendLabel(payload.health.score - prev.healthScore, since);

  const setTrend = (key: string, delta: number, fmt?: (n: number) => string) => {
    const m = payload.headline.find((h) => h.key === key);
    if (m) m.trend = trendLabel(delta, since, { fmt });
  };
  setTrend("active-markets", payload.coverage.metrosScored - prev.metrosScored);
  setTrend("buyer-leverage", round(ctx.avgLeverage - prev.avgBuyerLeverage, 1), (n) => n.toFixed(1));
  setTrend("revenue", payload.content.revenueRunRateCents - prev.revenueRunRateCents, usd);
  setTrend("velocity", payload.content.published30d - prev.published30d);
}

// ---------------------------------------------------------------------------
// Snapshot capture (written by the daily amips-snapshot cron).
// ---------------------------------------------------------------------------

/**
 * Compute the current intelligence and persist a snapshot row for trending.
 * Returns the captured scalar metrics. Throws if the snapshot table does not
 * exist yet (the caller — a cron — reports the failure).
 */
export async function captureIntelligenceSnapshot(): Promise<{ id: string; healthScore: number }> {
  const intel = await loadExecutiveIntelligence();
  const leverageComp = intel.health.components.find((c) => c.key === "buyerLeverage");
  const avgBuyerLeverage = round((leverageComp?.value ?? 0) / 10, 1);

  const row = await prisma.amipsIntelligenceSnapshot.create({
    data: {
      healthScore: intel.health.score,
      metrosCovered: intel.coverage.metrosCovered,
      metrosScored: intel.coverage.metrosScored,
      avgBuyerLeverage,
      activePages: intel.content.activePages,
      published30d: intel.content.published30d,
      impressions: intel.content.impressions,
      clicks: intel.content.clicks,
      leads: intel.content.leads,
      revenueRunRateCents: intel.content.revenueRunRateCents,
      indexationRate: intel.content.indexationRate,
      payloadJson: JSON.stringify(intel),
    },
    select: { id: true, healthScore: true },
  });
  return row;
}

/** Cents → compact USD string. */
function usd(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(1)}K`;
  return `$${dollars.toFixed(0)}`;
}

// ---------------------------------------------------------------------------
// Drill-down profiles — full intelligence for a single metro or vehicle.
// ---------------------------------------------------------------------------

export interface ProfilePage {
  slug: string;
  title: string;
  lifecycleStatus: string;
  impressions: number;
  clicks: number;
  leads: number;
}

export interface MetroProfile {
  metro: string;
  state: string;
  population: number | null;
  demandScore: number | null;
  competitionScore: number | null;
  inventoryScore: number | null;
  buyerLeverage: number | null;
  seasonalNote: string | null;
  dealers: number;
  topBrands: Array<{ brand: string; count: number }>;
  opportunityScore: number;
  opportunityDriver: string;
  vehicles: Array<{ make: string; model: string; advantage: number; dealers: number }>;
  pages: ProfilePage[];
  lastUpdated: string | null;
}

export interface VehicleProfile {
  make: string;
  model: string;
  avgAdvantage: number;
  metrosCount: number;
  bestMetro: { metro: string; advantage: number } | null;
  worstMetro: { metro: string; advantage: number } | null;
  msrpRange: { low: number; high: number } | null; // cents
  negotiationDifficulty: string | null;
  activeIncentives: string | null;
  byMetro: Array<{ metro: string; state: string; advantage: number; dealers: number }>;
  pages: ProfilePage[];
}

/** Full intelligence profile for one metro. Returns null if unknown/empty. */
export async function loadMetroProfile(metro: string): Promise<MetroProfile | null> {
  try {
    const def = getMetroDefs().find((d) => d.metro === metro);
    const [market, scores, pages, dealers, allMarkets] = await Promise.all([
      prisma.marketIntelligence.findFirst({ where: { metroName: metro } }),
      prisma.amipsMarketScore.findMany({
        where: { metro },
        orderBy: { overallBuyerAdvantage: "desc" },
        select: { make: true, model: true, overallBuyerAdvantage: true, dealerCount: true },
      }),
      prisma.amipsPage.findMany({
        where: { metro },
        orderBy: { impressions: "desc" },
        take: 25,
        select: { slug: true, title: true, lifecycleStatus: true, impressions: true, clicks: true, leadsGenerated: true },
      }),
      def
        ? prisma.dealerIntelligence.findMany({
            where: { latitude: { not: null }, longitude: { not: null } },
            select: { brand: true, latitude: true, longitude: true },
          })
        : Promise.resolve([]),
      prisma.marketIntelligence.findMany({ select: { population: true } }),
    ]);

    if (!market && scores.length === 0 && pages.length === 0) return null;

    // Dealer count + brand mix within the metro membership radius.
    let dealerCount = 0;
    const brandCounts = new Map<string, number>();
    if (def) {
      for (const d of dealers) {
        if (d.latitude == null || d.longitude == null) continue;
        if (haversineMiles(def.center, { lat: d.latitude, lng: d.longitude }) <= METRO_MEMBERSHIP_RADIUS_MILES) {
          dealerCount++;
          brandCounts.set(d.brand, (brandCounts.get(d.brand) ?? 0) + 1);
        }
      }
    }
    const topBrands = [...brandCounts.entries()]
      .map(([brand, count]) => ({ brand, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    const maxPopulation = Math.max(0, ...allMarkets.map((m) => m.population ?? 0));
    const { score, driver } = computeOpportunityScore({
      demandScore: market?.vehicleDemandScore ?? null,
      buyerLeverage: market?.buyerLeverageScore ?? null,
      population: market?.population ?? null,
      maxPopulation,
      dealers: dealerCount,
      pages: pages.length,
    });

    return {
      metro,
      state: def?.state ?? market?.state ?? "",
      population: market?.population ?? null,
      demandScore: market?.vehicleDemandScore ?? null,
      competitionScore: market?.competitionScore ?? null,
      inventoryScore: market?.inventoryScore ?? null,
      buyerLeverage: market?.buyerLeverageScore ?? null,
      seasonalNote: market?.seasonalNotes ?? null,
      dealers: dealerCount,
      topBrands,
      opportunityScore: score,
      opportunityDriver: driver,
      vehicles: scores.map((s) => ({
        make: s.make, model: s.model,
        advantage: round(s.overallBuyerAdvantage, 1), dealers: s.dealerCount,
      })),
      pages: pages.map((p) => ({
        slug: p.slug, title: p.title, lifecycleStatus: p.lifecycleStatus,
        impressions: p.impressions, clicks: p.clicks, leads: p.leadsGenerated,
      })),
      lastUpdated: market?.lastUpdated.toISOString().slice(0, 10) ?? null,
    };
  } catch {
    return null;
  }
}

/** Full intelligence profile for one make/model. Returns null if unknown. */
export async function loadVehicleProfile(make: string, model: string): Promise<VehicleProfile | null> {
  try {
    const [scores, vehicleRows, pages] = await Promise.all([
      prisma.amipsMarketScore.findMany({
        where: { make, model },
        orderBy: { overallBuyerAdvantage: "desc" },
        select: { metro: true, state: true, overallBuyerAdvantage: true, dealerCount: true },
      }),
      prisma.vehicleIntelligence.findMany({
        where: { make, model },
        select: { msrpCents: true, negotiationDifficulty: true, activeIncentives: true },
      }),
      prisma.amipsPage.findMany({
        where: { make, model },
        orderBy: { impressions: "desc" },
        take: 25,
        select: { slug: true, title: true, lifecycleStatus: true, impressions: true, clicks: true, leadsGenerated: true },
      }),
    ]);

    if (scores.length === 0 && vehicleRows.length === 0 && pages.length === 0) return null;

    const advantages = scores.map((s) => s.overallBuyerAdvantage);
    const avgAdvantage = advantages.length
      ? round(advantages.reduce((a, b) => a + b, 0) / advantages.length, 1)
      : 0;
    const best = scores[0]
      ? { metro: scores[0].metro, advantage: round(scores[0].overallBuyerAdvantage, 1) }
      : null;
    const worst = scores.length > 1
      ? { metro: scores[scores.length - 1].metro, advantage: round(scores[scores.length - 1].overallBuyerAdvantage, 1) }
      : null;

    const msrps = vehicleRows.map((v) => v.msrpCents).filter((n) => n > 0);
    const msrpRange = msrps.length
      ? { low: Math.min(...msrps), high: Math.max(...msrps) }
      : null;

    return {
      make,
      model,
      avgAdvantage,
      metrosCount: scores.length,
      bestMetro: best,
      worstMetro: worst,
      msrpRange,
      negotiationDifficulty: vehicleRows.find((v) => v.negotiationDifficulty)?.negotiationDifficulty ?? null,
      activeIncentives: vehicleRows.find((v) => v.activeIncentives)?.activeIncentives ?? null,
      byMetro: scores.map((s) => ({
        metro: s.metro, state: s.state,
        advantage: round(s.overallBuyerAdvantage, 1), dealers: s.dealerCount,
      })),
      pages: pages.map((p) => ({
        slug: p.slug, title: p.title, lifecycleStatus: p.lifecycleStatus,
        impressions: p.impressions, clicks: p.clicks, leads: p.leadsGenerated,
      })),
    };
  } catch {
    return null;
  }
}
