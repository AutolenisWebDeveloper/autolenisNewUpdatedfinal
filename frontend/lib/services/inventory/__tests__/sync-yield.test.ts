// Materially-short runs must record FAILED, not COMPLETED.
//
// The old rule was one line — `vehicles.length > 0 ? "SUCCESS" : "ZERO_RESULTS"` — so a run
// that asked for 500 listings and got 3 recorded COMPLETED. The hard part is not detecting a
// short run; it is not FAILING a legitimate one. Half of this suite is the false-positive
// battery.
//
//   npx tsx --test lib/services/inventory/__tests__/sync-yield.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyYield, expectedListings, formatDropTally, newDropTally, recordDrop,
  COVERAGE_MIN_RATIO, MIN_ABSOLUTE_SHORTFALL, NORMALIZE_MIN_RATIO, NORMALIZE_MIN_RAW,
  DROP_SAMPLE_LIMIT,
} from "@/lib/services/inventory/sync-yield";
import type { YieldEvidence, NormalizeDropTally } from "@/lib/services/inventory/sync-yield";

const ev = (o: Partial<YieldEvidence>): YieldEvidence => ({
  outcome: "SUCCESS", numFound: null, rawListings: 0, normalized: 0,
  pagesFetched: 0, rowsPerCall: 50, ...o,
});

// ── The defect ───────────────────────────────────────────────────────────────

test("REPRODUCTION: 200 raw listings when the provider claimed 5000 is FAILED", () => {
  const v = classifyYield(ev({ numFound: 5000, rawListings: 200, normalized: 180, pagesFetched: 10 }));
  assert.equal(v.outcome, "FAILED");
  assert.equal(v.coverage, "SHORT");
  assert.match(String(v.reason), /200/);
  assert.match(String(v.reason), /500/);
  assert.match(String(v.reason), /num_found 5000/);
});

test("REPRODUCTION: normalization collapse is FAILED even with full coverage", () => {
  // A provider response-shape change halves ingestion while every run reports COMPLETED.
  const v = classifyYield(ev({ numFound: 50, rawListings: 50, normalized: 10, pagesFetched: 1 }));
  assert.equal(v.outcome, "FAILED");
  assert.match(String(v.reason), /normalization dropped 40 of 50/);
});

// ── False-positive battery: every one of these must NOT be FAILED ────────────

test("a genuinely small market cannot produce a false FAILED", () => {
  // The denominator comes FROM the provider, so it shrinks with the market.
  const v = classifyYield(ev({ numFound: 12, rawListings: 12, normalized: 11, pagesFetched: 1 }));
  assert.equal(v.outcome, "SUCCESS");
  assert.equal(v.coverage, "OK");
});

test("an empty market is ZERO_RESULTS, never FAILED", () => {
  const v = classifyYield(ev({ outcome: "ZERO_RESULTS", numFound: 0, rawListings: 0, normalized: 0, pagesFetched: 1 }));
  assert.equal(v.outcome, "ZERO_RESULTS");
});

test("small-set churn below the absolute floor is not a short run", () => {
  // 22 of 30 is 73% — under the ratio — but only 8 short, which cannot be a dropped page.
  const v = classifyYield(ev({ numFound: 30, rawListings: 22, normalized: 20, pagesFetched: 1 }));
  assert.equal(v.outcome, "SUCCESS", "the anti-flap floor must absorb this");
});

test("hitting the provider's 500-row deep-paging ceiling is the DESIGN, not a failure", () => {
  const v = classifyYield(ev({ numFound: 4000, rawListings: 500, normalized: 470, pagesFetched: 10 }));
  assert.equal(v.outcome, "SUCCESS");
  assert.equal(expectedListings(ev({ numFound: 4000, pagesFetched: 10, rowsPerCall: 50 })), 500);
});

test("a BUDGET-TRUNCATED sweep is judged on the pages it was allowed to fetch", () => {
  // 2 of 10 calls granted, 100 raw against a 40000-listing market. Expected is computed
  // from pages FETCHED, not pages granted, so this is a complete run of what it could do.
  const v = classifyYield(ev({ numFound: 40_000, rawListings: 100, normalized: 95, pagesFetched: 2 }));
  assert.equal(v.outcome, "SUCCESS");
  assert.equal(expectedListings(ev({ numFound: 40_000, pagesFetched: 2, rowsPerCall: 50 })), 100);
});

test("the worst normalize yield ever observed in production is NOT failed", () => {
  // Production COMPLETED runs yielded 20-43 vehicles from 25- or 50-row calls: >= 0.40.
  // 20 of 50 is exactly that worst case. This test guards the calibration of 0.25.
  const v = classifyYield(ev({ numFound: 50, rawListings: 50, normalized: 20, pagesFetched: 1 }));
  assert.equal(v.outcome, "SUCCESS", "0.40 observed yield must sit safely above the 0.25 gate");
});

test("a tiny raw sample cannot trip the normalization gate", () => {
  const v = classifyYield(ev({ numFound: 20, rawListings: 20, normalized: 2, pagesFetched: 1 }));
  assert.equal(v.outcome, "SUCCESS", `below NORMALIZE_MIN_RAW (${NORMALIZE_MIN_RAW})`);
});

test("absent num_found makes the coverage gate INERT and says so", () => {
  // We never fabricate a denominator. The run records coverage UNKNOWN so an operator can
  // see the gate did not run, rather than reading silence as a pass.
  const v = classifyYield(ev({ numFound: null, rawListings: 3, normalized: 3, pagesFetched: 10 }));
  assert.equal(v.outcome, "SUCCESS");
  assert.equal(v.coverage, "UNKNOWN");
  assert.equal(expectedListings(ev({ numFound: null })), null);
});

// ── Gate 0: never upgrade, never launder ─────────────────────────────────────

test("an outcome that already tells the truth is returned unchanged", () => {
  for (const outcome of ["FAILED", "DEFERRED", "PARTIAL", "BUDGET_EXHAUSTED", "NOT_CONFIGURED"] as const) {
    const v = classifyYield(ev({ outcome, numFound: 5000, rawListings: 0, normalized: 0, pagesFetched: 0 }));
    assert.equal(v.outcome, outcome, `${outcome} must not be laundered into a coverage verdict`);
    assert.equal(v.reason, null);
  }
});

test("a 429 on page 4 stays PARTIAL — the HTTP cause must not be hidden by a coverage FAILED", () => {
  const v = classifyYield(ev({ outcome: "PARTIAL", numFound: 5000, rawListings: 150, normalized: 140, pagesFetched: 3 }));
  assert.equal(v.outcome, "PARTIAL");
});

// ── Threshold documentation ──────────────────────────────────────────────────

test("thresholds are the documented, justified values", () => {
  assert.equal(COVERAGE_MIN_RATIO, 0.8);
  assert.equal(MIN_ABSOLUTE_SHORTFALL, 25);
  assert.equal(NORMALIZE_MIN_RATIO, 0.25);
  assert.equal(NORMALIZE_MIN_RAW, 25);
  assert.ok(MIN_ABSOLUTE_SHORTFALL * 2 === 50, "half a page, where a page is 50 rows");
});

test("the boundary is exactly where the thresholds put it", () => {
  // expected 100, ratio floor = 80. 79 received is 21 short — under the absolute floor of
  // 25 — so it passes. 74 received is 26 short AND under 80, so it fails.
  assert.equal(classifyYield(ev({ numFound: 100, rawListings: 79, normalized: 70, pagesFetched: 2 })).outcome, "SUCCESS");
  assert.equal(classifyYield(ev({ numFound: 100, rawListings: 74, normalized: 70, pagesFetched: 2 })).outcome, "FAILED");
});

// ── The drop-reason breakdown (owner-approved 2026-09-13) ────────────────────
//
// The message could say how MANY listings were dropped and never WHICH field was missing. It
// named all four candidates — year/make/model/price — and distinguished none, which is why ten
// consecutive production failures could not settle whether the cause was provider-side.

test("REPRODUCTION: without a tally the message still names four fields and no count", () => {
  // The state of the world before this change, pinned so the regression is visible rather
  // than remembered.
  const v = classifyYield(ev({ numFound: 50, rawListings: 50, normalized: 0, pagesFetched: 1 }));
  assert.equal(v.outcome, "FAILED");
  assert.equal(
    v.reason,
    "normalization dropped 50 of 50 listings (missing year/make/model/price)",
    "an adapter that does not tally must read EXACTLY as it did — the breakdown adds a clause, it does not replace one",
  );
});

test("a tally appends a counted breakdown without disturbing the existing sentence", () => {
  const dropTally: NormalizeDropTally = {
    sampled: 25, buildAbsent: 25, year: 25, make: 25, model: 25, price: 0, threw: 0,
  };
  const v = classifyYield(ev({
    numFound: 50, rawListings: 50, normalized: 0, pagesFetched: 1, dropTally,
  }));
  assert.equal(v.outcome, "FAILED");
  // The original sentence survives verbatim — the production record and the assertions above
  // both match on it.
  assert.match(String(v.reason), /^normalization dropped 50 of 50 listings \(missing year\/make\/model\/price\)/);
  assert.match(String(v.reason), /sampled 25: build absent 25, year 25, make 25, model 25, price 0, threw 0/);
});

test("build absent 0 and build absent 25 are the two readings that must differ", () => {
  // This is the whole point. `year`, `make` and `model` are all read off `listing.build`, so
  // an absent build fails all three at once and the three counts alone cannot tell "the
  // provider sent no build object" from "it sent one with empty fields". Those have different
  // causes and different fixes, and only `buildAbsent` separates them.
  const providerSide = { ...newDropTally(), sampled: 25, buildAbsent: 25, year: 25, make: 25, model: 25 };
  const fieldsEmpty  = { ...newDropTally(), sampled: 25, buildAbsent: 0,  year: 25, make: 25, model: 25 };
  assert.match(formatDropTally(providerSide), /build absent 25/);
  assert.match(formatDropTally(fieldsEmpty),  /build absent 0/);
  assert.notEqual(formatDropTally(providerSide), formatDropTally(fieldsEmpty));
});

test("a price-weighted tally points somewhere other than the build object", () => {
  // `price` is `listing.price`, independent of `build`. The live probe returned price on only
  // 10 of 15 listings, so price-absent and build-absent are both live hypotheses and the
  // breakdown has to be able to tell them apart.
  const t = { ...newDropTally(), sampled: 25, buildAbsent: 0, price: 25 };
  assert.match(formatDropTally(t), /build absent 0, year 0, make 0, model 0, price 25/);
});

test("zeros are emitted, because a zero is the informative reading", () => {
  assert.equal(
    formatDropTally(newDropTally()),
    "sampled 0: build absent 0, year 0, make 0, model 0, price 0, threw 0",
  );
});

test("a tally that sampled nothing adds no clause", () => {
  // An adapter can hand over an empty tally — a coverage failure drops no listings at all.
  // Printing "sampled 0:" on such a run would be noise asserting a measurement nobody made.
  const v = classifyYield(ev({
    numFound: 50, rawListings: 50, normalized: 0, pagesFetched: 1, dropTally: newDropTally(),
  }));
  assert.equal(v.reason, "normalization dropped 50 of 50 listings (missing year/make/model/price)");
});

test("the sample limit is bounded and small", () => {
  // Not a magic number check: the tally runs on the failure path of every rejected listing,
  // and the cap is what keeps a pathological run from doing per-listing work indefinitely.
  assert.ok(DROP_SAMPLE_LIMIT > 0 && DROP_SAMPLE_LIMIT <= 50, "bounded, and within one page");
});

test("recordDrop is the only writer, and the cap is its property not the caller's", () => {
  // Found in the second review. The cap used to be checked at each call site, so `sampled`
  // stayed bounded only while every future rejection path remembered to check it.
  const t = newDropTally();
  for (let i = 0; i < DROP_SAMPLE_LIMIT * 3; i++) recordDrop(t, { buildAbsent: true, year: true });
  assert.equal(t.sampled, DROP_SAMPLE_LIMIT, "sampled never exceeds the limit");
  assert.equal(t.buildAbsent, DROP_SAMPLE_LIMIT);
  assert.equal(t.year, DROP_SAMPLE_LIMIT);
  assert.equal(t.price, 0, "a field that was present is never counted");
});

test("recordDrop on an absent tally is a no-op, so a caller that does not tally needs no branch", () => {
  assert.doesNotThrow(() => recordDrop(undefined, { threw: true }));
});
