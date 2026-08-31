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
