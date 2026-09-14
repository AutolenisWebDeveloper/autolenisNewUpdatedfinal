// §8a / parity row A17b — the required-feature match that §8c's tie-break reads.
//
// The columns shipped in the Phase 1 wave with no writer, so the second key of "lowest
// out-the-door, then best required-feature match, then shortest distance, then earliest
// submission" had nothing to read. What this file mostly pins is the honesty rule: an unknown
// feature list is not an absent one.
//
//   npx tsx --test lib/services/offer/__tests__/feature-match.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { computeFeatureMatch, normalizeFeature } from "../feature-match";

test("a required feature the vehicle has is a match", () => {
  const r = computeFeatureMatch(["Heated Seats"], ["Heated Seats", "Bluetooth"]);
  assert.deepEqual(r.matches, ["Heated Seats"]);
  assert.deepEqual(r.mismatches, []);
  assert.equal(r.score, 1);
});

test("a required feature the vehicle lacks is a mismatch, and costs score", () => {
  const r = computeFeatureMatch(["AWD", "Sunroof"], ["Sunroof"]);
  assert.deepEqual(r.matches, ["Sunroof"]);
  assert.deepEqual(r.mismatches, ["AWD"]);
  assert.equal(r.score, 0, "one match and one mismatch is neutral, not positive");
});

test("case, punctuation and spacing do not decide who wins a tie", () => {
  const r = computeFeatureMatch(["heated-seats"], ["Heated  Seats"]);
  assert.equal(r.score, 1);
  assert.equal(normalizeFeature("Heated-Seats"), "heated seats");
});

test("a more specific offered feature satisfies a general requirement", () => {
  // The vehicle has a sunroof and then some.
  assert.equal(computeFeatureMatch(["Sunroof"], ["Panoramic Sunroof"]).score, 1);
});

test("a general offered feature does NOT satisfy a more specific requirement", () => {
  // Matching here would tell the buyer they are getting something they are not.
  const r = computeFeatureMatch(["Panoramic Sunroof"], ["Sunroof"]);
  assert.deepEqual(r.mismatches, ["Panoramic Sunroof"]);
  assert.equal(r.score, -1);
});

// ── the honesty rule ────────────────────────────────────────────────────────────────────────────

test("an UNKNOWN feature list establishes nothing — it is not a list of mismatches", () => {
  // `InventoryItem.features` is `String[] @default([])`, so a feed that does not publish features
  // stores `[]`. Reading that as "has none of them" would mark every required feature a mismatch,
  // bottom out that dealership in the ranked report and lose it every tie — for a gap in someone
  // else's data feed rather than anything about its offer.
  for (const offered of [undefined, null, [], ["   "]]) {
    const r = computeFeatureMatch(["AWD", "Sunroof"], offered);
    assert.equal(r.matches, null, `offered=${JSON.stringify(offered)}`);
    assert.equal(r.mismatches, null);
    assert.equal(r.score, null, "a null score must be neutral in the comparator, never worst");
  }
});

test("NO required features is established, not unknown", () => {
  // The buyer required nothing, so every offer matches equally and the tie-break falls through to
  // the next key for all of them — rather than being decided by whichever dealership happens to
  // publish the longer feature list.
  for (const required of [undefined, null, [], ["  "]]) {
    const r = computeFeatureMatch(required, ["Bluetooth"]);
    assert.deepEqual(r.matches, []);
    assert.deepEqual(r.mismatches, []);
    assert.equal(r.score, 0);
  }
});

test("blank requirements are dropped rather than counted as mismatches", () => {
  const r = computeFeatureMatch(["AWD", "", "   ", "-"], ["AWD"]);
  assert.deepEqual(r.matches, ["AWD"]);
  assert.deepEqual(r.mismatches, []);
  assert.equal(r.score, 1);
});

test("the required strings are echoed back as the buyer wrote them", () => {
  // Normalisation decides the comparison; it must not rewrite what is stored and shown. An
  // operator reading `required_feature_mismatches` needs the buyer's own words.
  const r = computeFeatureMatch(["All-Wheel Drive"], ["Bluetooth"]);
  assert.deepEqual(r.mismatches, ["All-Wheel Drive"]);
});
