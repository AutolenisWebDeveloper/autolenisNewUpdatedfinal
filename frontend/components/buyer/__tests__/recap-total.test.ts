// §11a — the out-the-door total a buyer is shown must exclude the products they did not accept.
//
// Run with:  npx tsx --test components/buyer/__tests__/recap-total.test.ts
//
// FOUND BY A REVIEW BOT AFTER TWO REVIEW PASSES MISSED IT. `RecapConfirmClient` rendered "Your
// out-the-door total" as `money(baseOtdCents)` — the reaffirmed figure, which CONTAINS every
// optional product, because `buildRecap` derives both the "Optional products" line and
// `optionalProducts` from the same `addOnItems`. One row above it, the screen said "Declined (not
// in your total)". Both statements were on screen at once and only one was true: declining a
// $1,200 GAP product struck the label through and changed the number by nothing.
//
// §11a is the rule that breaks — "separately named, separately priced, separately accepted or
// declined" — and a total that silently keeps a declined product is the charge appearing anyway.
//
// The arithmetic is extracted so it is testable without a browser. The component imports it, so
// the two cannot drift.

import test from "node:test";
import assert from "node:assert/strict";
import { recapTotals, type RecapProduct } from "../recap-totals";

const GAP: RecapProduct = { key: "p0", label: "GAP", amountCents: 120_000, accepted: null };
const WARRANTY: RecapProduct = { key: "p1", label: "Warranty", amountCents: 250_000, accepted: null };

// Vehicle + fees of $38,000, plus the two products above = $41,700 reaffirmed out-the-door.
const BASE = 3_800_000 + GAP.amountCents + WARRANTY.amountCents;

test("with everything accepted, the total is the reaffirmed figure", () => {
  const t = recapTotals(BASE, [{ ...GAP, accepted: true }, { ...WARRANTY, accepted: true }]);
  assert.equal(t.runningTotalCents, BASE);
  assert.equal(t.vehicleAndFeesCents, 3_800_000);
});

test("a DECLINED product comes out of the total — the defect this file exists for", () => {
  const t = recapTotals(BASE, [{ ...GAP, accepted: false }, { ...WARRANTY, accepted: true }]);
  assert.equal(t.declinedTotal, 120_000);
  assert.equal(t.runningTotalCents, BASE - 120_000, "the declined product must leave the total");
  assert.notEqual(t.runningTotalCents, BASE, "BASE is the old, inflated answer");
});

test("declining everything leaves vehicle and fees alone", () => {
  const t = recapTotals(BASE, [{ ...GAP, accepted: false }, { ...WARRANTY, accepted: false }]);
  assert.equal(t.runningTotalCents, 3_800_000);
});

test("an UNDECIDED product is not in the total either — §11a: silence is not an answer", () => {
  const t = recapTotals(BASE, [GAP, { ...WARRANTY, accepted: true }]);
  assert.equal(t.undecidedTotal, 120_000);
  assert.equal(t.runningTotalCents, BASE - 120_000);
});

test("the rows always sum to the total shown — the screen cannot contradict itself", () => {
  const options: Array<boolean | null> = [true, false, null];
  for (const a of options) {
    for (const b of options) {
      const t = recapTotals(BASE, [{ ...GAP, accepted: a }, { ...WARRANTY, accepted: b }]);
      assert.equal(
        t.vehicleAndFeesCents + t.acceptedTotal,
        t.runningTotalCents,
        `rows do not sum for ${String(a)}/${String(b)}`,
      );
      // Nothing unaccounted for: every cent of the reaffirmed figure is in exactly one bucket.
      assert.equal(
        t.vehicleAndFeesCents + t.acceptedTotal + t.declinedTotal + t.undecidedTotal,
        BASE,
        `buckets do not partition BASE for ${String(a)}/${String(b)}`,
      );
    }
  }
});

test("no products means the total is simply the reaffirmed figure", () => {
  const t = recapTotals(BASE, []);
  assert.equal(t.runningTotalCents, BASE);
  assert.equal(t.vehicleAndFeesCents, BASE);
});

test("the component uses this arithmetic rather than its own", () => {
  // The extraction only helps if the component actually imports it. A second copy inline is how
  // the two drift and the screen starts contradicting itself again.
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const src = readFileSync(`${process.cwd()}/components/buyer/RecapConfirmClient.tsx`, "utf8");
  assert.match(src, /from "\.\/recap-totals"/, "RecapConfirmClient must import recapTotals");
  assert.equal(
    /\{money\(baseOtdCents\)\}/.test(src),
    false,
    "the total must not be rendered from the raw reaffirmed figure — that is the defect",
  );
});
