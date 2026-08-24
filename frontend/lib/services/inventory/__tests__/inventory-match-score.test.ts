// Batch 1 — deterministic match scoring.
//   npx tsx --test lib/services/inventory/__tests__/inventory-match-score.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { computeMatchScore } from "@/lib/services/inventory/inventory-match-score";

const item = { make: "Toyota", model: "Camry", year: 2022, priceCents: 2_800_000, lane: "LANE_1" };

test("identical inputs yield identical scores (determinism)", () => {
  const c = { make: "Toyota", model: "Camry", yearMin: 2020, yearMax: 2023, maxPriceCents: 3_000_000 };
  const a = computeMatchScore(c, item);
  const b = computeMatchScore(c, item);
  assert.deepEqual(a, b);
});

test("exact make+model+year+in-budget+LANE_1 scores near the top", () => {
  const s = computeMatchScore({ make: "Toyota", model: "Camry", yearMin: 2020, yearMax: 2023, maxPriceCents: 3_000_000 }, item);
  assert.ok(s.score >= 0.95, `expected high score, got ${s.score}`);
});

test("wrong make drops the score below a partial match", () => {
  const wrong = computeMatchScore({ make: "Honda" }, item);
  const right = computeMatchScore({ make: "Toyota" }, item);
  assert.ok(wrong.score < right.score);
  assert.equal(wrong.factors.make, 0);
});

test("unspecified criteria are non-constraining (treated as satisfied)", () => {
  const s = computeMatchScore({}, item);
  assert.equal(s.factors.make, 1);
  assert.equal(s.factors.model, 1);
  assert.equal(s.factors.year, 1);
  assert.equal(s.factors.price, 1);
});

test("lane provenance orders LANE_1 > LANE_2 > LANE_3", () => {
  const l1 = computeMatchScore({}, { ...item, lane: "LANE_1" }).factors.lane;
  const l2 = computeMatchScore({}, { ...item, lane: "LANE_2" }).factors.lane;
  const l3 = computeMatchScore({}, { ...item, lane: "LANE_3" }).factors.lane;
  assert.ok(l1 > l2 && l2 > l3);
});

test("over-budget item scores price factor 0", () => {
  const s = computeMatchScore({ maxPriceCents: 2_000_000 }, item);
  assert.equal(s.factors.price, 0);
});
