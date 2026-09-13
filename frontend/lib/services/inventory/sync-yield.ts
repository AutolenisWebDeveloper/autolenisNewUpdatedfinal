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

/**
 * How many REJECTED listings normalize() inspects before it stops counting.
 *
 * The tally answers exactly one question — which predicate failed — and one page of rejected
 * listings answers it as well as ten. Capping the sample keeps a pathological run from
 * accumulating per-listing work on a path that is, by definition, already going wrong.
 */
export const DROP_SAMPLE_LIMIT = 25;

/**
 * Which required field was absent when normalize() rejected a listing, counted over a bounded
 * sample. FAILURE PATH ONLY: a listing that normalizes touches none of this.
 *
 * It exists because `reason` could say how MANY listings were dropped and never which field
 * was missing, so "normalization dropped 50 of 50 listings (missing year/make/model/price)"
 * named all four candidates and distinguished none. Eight consecutive production failures
 * (2026-09-03 to 09-10, `phase-4-proof/sweep-failure-diagnostic.sql`) were read with that
 * message and it could not settle the question; two more followed the include-flag fix.
 *
 * `buildAbsent` is counted SEPARATELY from the three fields read off `build`, and it is the
 * discriminator the others cannot be. `year`, `make` and `model` are all `listing.build?.x`,
 * so an absent `build` makes all three read falsy at once and is indistinguishable, from the
 * counts alone, from a `build` that arrived carrying empty fields. The first is provider-side
 * — the response does not contain the object the request asked for — and the second is not.
 * `price` is `listing.price`, independent of `build`, so a price-weighted tally points
 * somewhere else again.
 *
 * `threw` is normalize()'s `catch`, which is not a predicate failing. Counting it means
 * `threw` plus the predicate rejections equals `sampled`, instead of leaving `sampled` with an
 * unexplained remainder.
 *
 * **The five field counters are per-field prevalence over `sampled`, NOT a partition of it.**
 * One listing missing year, make and model increments all three, so they can sum to more than
 * `sampled` — `sampled 25: ... year 25, make 25, model 25` is 25 listings each missing three
 * fields, not 75 listings. Read every count against `sampled`, never against their own sum.
 */
export interface NormalizeDropTally {
  /**
   * Rejected listings INSPECTED — never exceeds DROP_SAMPLE_LIMIT, and never the total
   * dropped. The total is in the sentence this breakdown is appended to.
   */
  sampled: number;
  buildAbsent: number;
  year: number;
  make: number;
  model: number;
  price: number;
  threw: number;
}

export function newDropTally(): NormalizeDropTally {
  return { sampled: 0, buildAbsent: 0, year: 0, make: 0, model: 0, price: 0, threw: 0 };
}

/**
 * The ONLY way to write to a tally, and the only place the cap is enforced.
 *
 * Found in the second review: the cap was checked at each call site, so `sampled` stayed
 * within DROP_SAMPLE_LIMIT only as long as every future rejection path remembered to check
 * it. Here it is a property of the writer instead of a convention the callers share. A
 * `tally` of `undefined` is the no-op case, so a caller that does not tally needs no branch.
 */
export function recordDrop(
  tally: NormalizeDropTally | undefined,
  missing: {
    buildAbsent?: boolean;
    year?: boolean;
    make?: boolean;
    model?: boolean;
    price?: boolean;
    threw?: boolean;
  },
): void {
  if (!tally || tally.sampled >= DROP_SAMPLE_LIMIT) return;
  tally.sampled++;
  if (missing.buildAbsent) tally.buildAbsent++;
  if (missing.year) tally.year++;
  if (missing.make) tally.make++;
  if (missing.model) tally.model++;
  if (missing.price) tally.price++;
  if (missing.threw) tally.threw++;
}

/**
 * Every counter is emitted, zeros included. A zero is the most informative reading this can
 * produce: `build absent 0` says the response DID carry the object, which is the opposite
 * conclusion from `build absent 25` and would be unreadable if zeros were omitted.
 */
export function formatDropTally(t: NormalizeDropTally): string {
  return (
    `sampled ${t.sampled}: build absent ${t.buildAbsent}, year ${t.year}, ` +
    `make ${t.make}, model ${t.model}, price ${t.price}, threw ${t.threw}`
  );
}

export interface YieldEvidence {
  /** The outcome the adapter reached on its own merits, before any yield judgement. */
  outcome: AdapterOutcome;
  /** Provider's claimed total for this query. null when absent — then the gate is inert. */
  numFound: number | null;
  /** Raw listing objects received across all pages, pre-normalize and pre-dedup. */
  rawListings: number;
  /** Listings that survived normalize() — the number actually ingestable. */
  normalized: number;
  /**
   * Listings the adapter rejected for being outside the requested radius, BEFORE normalize()
   * was called on them.
   *
   * Gate 2 measures response-SHAPE loss, and a policy rejection is not a shape failure. These
   * rows are counted in `rawListings` but can never appear in `normalized`, so without this
   * they read as normalize() failing on them. A page of 50 in which 40 are out of radius —
   * the exact case the rejection was added for — produced 10 normalized of 50 raw, tripped
   * the 0.25 floor, and reported a healthy run as FAILED with "normalization dropped 40 of
   * 50 listings (missing year/make/model/price)". The orchestrator then raised
   * INVENTORY_SWEEP_SHORTFALL with that false root cause. Found in review.
   */
  radiusRejected?: number;
  /**
   * Which predicate rejected a listing, over a bounded sample. Optional: an adapter that does
   * not tally reports this message exactly as before, so the breakdown ADDS a clause and
   * removes nothing.
   */
  dropTally?: NormalizeDropTally;
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
  // Measured over the listings normalize() was actually GIVEN. Rows rejected for being
  // outside the radius never reached it, so counting them as normalization loss accuses the
  // wrong subsystem — see `radiusRejected`.
  const offered = e.rawListings - (e.radiusRejected ?? 0);
  if (
    offered >= NORMALIZE_MIN_RAW &&
    e.normalized < Math.floor(offered * NORMALIZE_MIN_RATIO)
  ) {
    return {
      outcome: "FAILED",
      coverage: expected === null ? "UNKNOWN" : "OK",
      reason:
        `normalization dropped ${offered - e.normalized} of ${offered} listings ` +
        `(missing year/make/model/price)` +
        // APPENDED, never substituted. The existing sentence is what the production record
        // and its regression tests already match on, and a run whose adapter does not tally
        // must keep reading exactly as it did.
        (e.dropTally && e.dropTally.sampled > 0 ? ` — ${formatDropTally(e.dropTally)}` : ""),
    };
  }

  return { outcome: e.outcome, reason: null, coverage: expected === null ? "UNKNOWN" : "OK" };
}
