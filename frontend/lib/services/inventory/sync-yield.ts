// lib/services/inventory/sync-yield.ts
//
// "Did this run actually sweep the market it claimed to?"
//
// The adapter used to decide its own outcome with one line:
//     outcome: vehicles.length > 0 ? "SUCCESS" : "ZERO_RESULTS"
// so a run that asked for 500 listings and received 3 recorded COMPLETED, and a provider
// response-shape change that made normalize() drop every row would have been invisible.
//
// The expectation here is NEVER invented. It is MarketCheck's own `num_found` for the exact
// query we sent — a documented field on the Inventory Search response, already typed in the
// adapter and, until now, read by nothing. Because the denominator comes from the provider,
// a genuinely small market reports a small num_found and is STRUCTURALLY INCAPABLE of
// producing a false FAILED.

import type { AdapterOutcome } from "./adapters/IInventoryAdapter";
import { PROVIDER_PAGINATION_LIMIT } from "./inventory-source-config.service";

/**
 * A full page returns exactly `rows`, so an unbroken walk yields a ratio of 1.0. The 20%
 * tolerance absorbs churn between the page-0 count and a 10-page walk over a live index
 * (listings sell mid-sweep). Below this, a page went missing while the provider still
 * claimed the rows were there.
 */
export const COVERAGE_MIN_RATIO = 0.8;

/**
 * Anti-flap floor, in listings. On a small result set ordinary churn is a large FRACTION but
 * a tiny COUNT — num_found 30 against 22 received is 73% but only 8 short. Below half a page
 * it cannot be a dropped page, and a dropped page is the only failure this gate exists to
 * catch.
 */
export const MIN_ABSOLUTE_SHORTFALL = 25;

/**
 * Calibrated against production, not invented. COMPLETED runs yielded 20-43 vehicles from a
 * 25-row (priority) or 50-row (full) call — an observed normalize yield of >= 0.40. 0.25 sits
 * well below the worst observed value, so ordinary data variance cannot trip it, while a
 * response-shape break (yield -> ~0) trips instantly.
 */
export const NORMALIZE_MIN_RATIO = 0.25;

/** Same anti-flap logic, on the normalization gate. */
export const NORMALIZE_MIN_RAW = 25;

export interface YieldEvidence {
  /** The outcome the adapter reached on its own merits, before any yield judgement. */
  outcome: AdapterOutcome;
  /** Provider's claimed total for this query. null when absent — then the gate is inert. */
  numFound: number | null;
  /** Raw listing objects received across all pages, pre-normalize and pre-dedup. */
  rawListings: number;
  /** Listings that survived normalize() — the number actually ingestable. */
  normalized: number;
  /** Pages that returned 200. A failed page is NOT counted. */
  pagesFetched: number;
  rowsPerCall: number;
}

/**
 * How many raw listings this walk should have seen.
 *
 * Bounded by pages actually FETCHED (not pages granted), so a budget-truncated sweep is
 * judged on what it was allowed to ask for; and by the provider's 500-row deep-paging
 * ceiling, because stopping there is the design rather than a failure.
 */
export function expectedListings(e: YieldEvidence): number | null {
  if (e.numFound == null) return null;
  return Math.min(e.numFound, e.pagesFetched * e.rowsPerCall, PROVIDER_PAGINATION_LIMIT);
}

export interface YieldVerdict {
  outcome: AdapterOutcome;
  reason: string | null;
  /** "OK" | "SHORT" | "UNKNOWN" — UNKNOWN means num_found was absent and the gate was inert. */
  coverage: "OK" | "SHORT" | "UNKNOWN";
}

export function classifyYield(e: YieldEvidence): YieldVerdict {
  // Gate 0 — only ever DOWNGRADE a claimed success. FAILED / DEFERRED / PARTIAL /
  // BUDGET_EXHAUSTED / NOT_CONFIGURED already tell the truth on their own merits, and
  // laundering one of them into a coverage verdict would hide the real cause.
  if (e.outcome !== "SUCCESS" && e.outcome !== "ZERO_RESULTS") {
    return { outcome: e.outcome, reason: null, coverage: "UNKNOWN" };
  }

  // Gate 1 — COVERAGE. Raw listings received vs what the provider said was there.
  const expected = expectedListings(e);
  if (expected !== null) {
    const shortfall = expected - e.rawListings;
    if (
      shortfall >= MIN_ABSOLUTE_SHORTFALL &&
      e.rawListings < Math.floor(expected * COVERAGE_MIN_RATIO)
    ) {
      return {
        outcome: "FAILED",
        coverage: "SHORT",
        reason:
          `short run: received ${e.rawListings} raw listings of ${expected} expected ` +
          `(num_found ${e.numFound}, ${e.pagesFetched} pages x ${e.rowsPerCall} rows)`,
      };
    }
  }

  // Gate 2 — NORMALIZATION LOSS. normalize() returns null for any listing missing
  // year/make/model/price, and that loss is invisible today: a provider response-shape
  // change would halve ingestion with every run still reporting COMPLETED.
  if (
    e.rawListings >= NORMALIZE_MIN_RAW &&
    e.normalized < Math.floor(e.rawListings * NORMALIZE_MIN_RATIO)
  ) {
    return {
      outcome: "FAILED",
      coverage: expected === null ? "UNKNOWN" : "OK",
      reason:
        `normalization dropped ${e.rawListings - e.normalized} of ${e.rawListings} listings ` +
        `(missing year/make/model/price)`,
    };
  }

  return { outcome: e.outcome, reason: null, coverage: expected === null ? "UNKNOWN" : "OK" };
}
