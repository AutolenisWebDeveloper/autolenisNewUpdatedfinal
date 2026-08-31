// lib/amips/tiers.ts — the single authoritative AMIPS tier + lifecycle vocabulary.
//
// WHY THIS FILE EXISTS
// Three files independently defined "which tiers carry local market data", and
// they disagreed:
//
//   lib/amips/assembler.ts    METRO_TIERS  = {C,D,E}
//   lib/amips/quality-gate.ts METRO_TIERS  = {C,D,E}
//   lib/amips/lifecycle-manager.ts isTierCPlus = {C,D,E,F}
//
// Tier F reaches its market data through its own earlier branch in the
// assembler, so it genuinely *is* a market-backed tier — but that branch never
// populated dealerDataAsOf / marketDataAsOf. The lifecycle manager included F in
// its freshness check and read those nulls as "stale", so every Tier F page was
// flagged REFRESH_REQUIRED on its first lifecycle run, permanently, while the
// quality gate (using the {C,D,E} set) certified the same page as fresh.
//
// The two sets that must agree — the freshness gate and the lifecycle staleness
// check — are now one: MARKET_DATA_TIERS. The assembler's routing set is
// deliberately separate and narrower; see METRO_ASSEMBLY_TIERS.

/**
 * Tiers whose pages carry metro / dealer / market context and therefore MUST
 * persist `dealerDataAsOf` and `marketDataAsOf`.
 *
 * This is the authoritative set for BOTH:
 *   - Quality Gate 5 (freshness at generation time)
 *   - the lifecycle staleness check (freshness over time)
 *
 * They must never diverge again: a tier the gate does not check for freshness
 * must not be a tier the lifecycle manager de-indexes for staleness.
 */
export const MARKET_DATA_TIERS: ReadonlySet<string> = new Set(["C", "D", "E", "F"]);

/**
 * Tiers routed down the assembler's metro-assembly branch.
 *
 * Narrower than MARKET_DATA_TIERS **by design**: Tier F returns earlier from its
 * own transaction-backed branch (which supplies its own market context), so it
 * never reaches the metro branch. This set is an assembler routing detail, not a
 * statement about which tiers carry market data — use MARKET_DATA_TIERS for that.
 */
export const METRO_ASSEMBLY_TIERS: ReadonlySet<string> = new Set(["C", "D", "E"]);

/** True when this tier's pages must carry dealer + market as-of dates. */
export function requiresMarketData(tier: string): boolean {
  return MARKET_DATA_TIERS.has(tier);
}

// ── Lifecycle status vocabulary ────────────────────────────────────────────

export const LIFECYCLE_ACTIVE = "ACTIVE";
export const LIFECYCLE_REFRESH_REQUIRED = "REFRESH_REQUIRED";
export const LIFECYCLE_UNDER_REVIEW = "UNDER_REVIEW";
export const LIFECYCLE_RETIRED = "RETIRED";

/**
 * Lifecycle statuses whose pages are served publicly and listed in sitemaps.
 *
 * REFRESH_REQUIRED is INCLUDED, deliberately. It means "this page's underlying
 * data is aging and should be regenerated" — an editorial signal, not a
 * statement that the page is unfit to serve. Treating it as non-servable turned
 * a freshness reminder into an HTTP 404 plus sitemap removal, which destroys
 * ranking equity, link equity and crawl history for a page that is still
 * substantially correct. The refresh signal belongs in the admin queue.
 *
 * UNDER_REVIEW and RETIRED remain non-servable: the first is awaiting a human
 * decision, the second has been withdrawn.
 *
 * Serving and sitemap inclusion are driven by this ONE set so a page can never
 * be live but unlisted, or listed but 404 (the divergence that already exists
 * between the /buying-guide route and its sitemap query).
 */
export const SERVABLE_LIFECYCLE_STATUSES: readonly string[] = [
  LIFECYCLE_ACTIVE,
  LIFECYCLE_REFRESH_REQUIRED,
];

/** True when a page with this lifecycle status should be served and listed. */
export function isServableLifecycleStatus(status: string): boolean {
  return (SERVABLE_LIFECYCLE_STATUSES as readonly string[]).includes(status);
}

// ── Outer staleness bound (serving backstop) ───────────────────────────────

/**
 * The age past which a page stops being served, however fresh its lifecycle
 * status says it is.
 *
 * WHY A BOUND EXISTS AT ALL
 * SERVABLE_LIFECYCLE_STATUSES deliberately stopped treating staleness as a
 * withholding condition, because a 404 is worse than slightly-aged data. But
 * with no refresh path in place that removed the upper bound entirely: a page
 * could serve MSRP, fair-market pricing and dealer counts of unbounded age.
 * These are vehicle-pricing and dealer pages, so past some age the numbers stop
 * being merely aged and start being wrong.
 *
 * WHY 180 DAYS, AND NOT A ROUND NUMBER PICKED FOR ITS OWN SAKE
 * This is not a new threshold — it is `FRESHNESS_DAYS.vehicle`, the age at which
 * Quality Gate 5 already REFUSES TO GENERATE a page. The invariant it creates is
 * the coherent one:
 *
 *     serve only what we would still be willing to publish.
 *
 * Continuing to serve pricing we would not publish today is indefensible; that
 * is the whole argument, and it needs no independent number.
 *
 * It is a backstop, not a refresh trigger:
 *   - 6x the market gate (30d) and 2x the dealer gate (90d), so a page must be
 *     six market-refresh cycles overdue before it goes dark.
 *   - Against owner-verified production (market 66d, dealer 66d, vehicle 85d)
 *     nothing withholds today, with ~95 days of headroom. It cannot re-create
 *     the 30-day defect, where pages went dark almost immediately.
 *
 * Why not longer (365d): a year guarantees crossing a model-year rollover, so
 * the page would quote prior-model-year MSRP as current — a factual-accuracy
 * failure on a car-buying platform, not a freshness nit.
 * Why not shorter (e.g. 120d): the system is willing to PUBLISH at 180d, so a
 * withholding bound tighter than the publication bound would dark pages that are
 * freshly publishable.
 *
 * THE BOUND HAS A DEADLINE — READ THIS BEFORE DEPLOYING
 * Owner-verified vehicle data is 85 days old (2026-08-31), so it crosses 180
 * days on approximately **2026-12-04**. There is NO scheduled refresh for any of
 * the three sources: VehicleIntelligence is written only by the manual seed
 * (lib/amips/seed/vehicle-intelligence.seed.ts:97) and MarketIntelligence only
 * by the pipeline behind POST /api/admin/amips/sync-market-intelligence — no
 * cron drives either. Unless that source data is refreshed before then, the
 * corpus goes dark on that date.
 *
 * That is the correct outcome, not a regression, and it does not create a new
 * cliff. Quality Gate 5 ALREADY refuses to generate or regenerate past this same
 * threshold (assembler.ts: `isFresh(vehicleRow.lastUpdated, FRESHNESS_DAYS.vehicle)`
 * returns null, sending the queue item to pending_enrichment). Past 180 days the
 * system can neither publish nor regenerate these pages — serving was the only
 * place still ignoring that. Regenerating will NOT clear the bound either, since
 * the as-of dates come from the source rows; only refreshing the source data
 * will. Scheduling that refresh is a cron change, deliberately out of scope here.
 *
 * Kept here rather than imported from the assembler to avoid an import cycle
 * (the assembler imports this module). `tiers.test.ts` asserts the two stay
 * equal, so they cannot drift.
 */
export const STALE_WITHHOLD_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DataAsOfBearing {
  contentTier: string;
  vehicleDataAsOf: Date | null;
  dealerDataAsOf: Date | null;
  marketDataAsOf: Date | null;
}

/**
 * The OLDEST applicable data timestamp on a page — the worst case, which is what
 * both the disclosure and the withholding bound must key on.
 *
 * Applicability follows the same rule as the lifecycle staleness check: vehicle
 * data applies to every tier; dealer and market data apply only to market-data
 * tiers. Returns null when nothing applicable is populated.
 */
export function oldestApplicableDataAsOf(page: DataAsOfBearing): Date | null {
  const dates: Date[] = [];
  if (page.vehicleDataAsOf) dates.push(page.vehicleDataAsOf);
  if (requiresMarketData(page.contentTier)) {
    if (page.dealerDataAsOf) dates.push(page.dealerDataAsOf);
    if (page.marketDataAsOf) dates.push(page.marketDataAsOf);
  }
  if (dates.length === 0) return null;
  return dates.reduce((oldest, d) => (d.getTime() < oldest.getTime() ? d : oldest));
}

/**
 * True when a page's oldest applicable data has passed STALE_WITHHOLD_DAYS and
 * the page must stop being served and listed.
 *
 * A page with NO applicable timestamp is NOT withheld. The generator sets
 * `vehicleDataAsOf` on every path and Gate 5 requires it, so this case does not
 * arise for generated pages; withholding on it would dark rows for an
 * unprovable reason rather than a measured one. It matches `hasStaleData`,
 * which likewise treats a null vehicle date as not-applicable rather than stale.
 */
export function isPastWithholdBound(page: DataAsOfBearing, now: number): boolean {
  const oldest = oldestApplicableDataAsOf(page);
  if (!oldest) return false;
  return now - oldest.getTime() > STALE_WITHHOLD_DAYS * DAY_MS;
}
