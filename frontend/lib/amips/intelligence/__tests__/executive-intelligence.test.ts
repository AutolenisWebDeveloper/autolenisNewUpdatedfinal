// Methodology contract for the AMIPS executive-intelligence engine.
// Run with:
//   npx tsx --test lib/amips/intelligence/__tests__/executive-intelligence.test.ts
//
// These tests lock the *explainable* scoring math: the National Market Health
// Index, the Metro Opportunity Score, and the health grading bands. They cover
// the pure functions only (no DB), so the published methodology cannot drift
// silently.

import test from "node:test";
import assert from "node:assert/strict";
import {
  computeHealthIndex,
  computeOpportunityScore,
  healthTone,
  healthGrade,
  HEALTH_WEIGHTS,
  type HealthComponent,
} from "../executive-intelligence";

function components(values: Partial<Record<keyof typeof HEALTH_WEIGHTS, number>>): HealthComponent[] {
  return (Object.keys(HEALTH_WEIGHTS) as Array<keyof typeof HEALTH_WEIGHTS>).map((key) => ({
    key,
    label: key,
    weight: HEALTH_WEIGHTS[key],
    value: values[key] ?? 0,
    caption: "",
  }));
}

test("health weights sum to 1.0", () => {
  const sum = Object.values(HEALTH_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `weights sum to ${sum}`);
});

test("all-zero components yield a zero index and the initializing band", () => {
  const h = computeHealthIndex(components({}));
  assert.equal(h.score, 0);
  assert.equal(h.tone, "initializing");
  assert.equal(h.grade, "Initializing");
});

test("all-100 components yield a perfect index", () => {
  const full = components({
    buyerLeverage: 100, dealerCoverage: 100, marketDepth: 100,
    indexationHealth: 100, dataFreshness: 100, publishingVelocity: 100,
  });
  const h = computeHealthIndex(full);
  assert.equal(h.score, 100);
  assert.equal(h.tone, "strong");
});

test("health index is the weighted mean of components", () => {
  // Only buyer leverage at 100 → score equals its weight × 100.
  const h = computeHealthIndex(components({ buyerLeverage: 100 }));
  assert.equal(h.score, Math.round(HEALTH_WEIGHTS.buyerLeverage * 100));
});

test("health grading bands map as documented", () => {
  assert.equal(healthGrade(healthTone(85)), "Strong");
  assert.equal(healthGrade(healthTone(65)), "Healthy");
  assert.equal(healthGrade(healthTone(45)), "Developing");
  assert.equal(healthGrade(healthTone(25)), "Early Stage");
  assert.equal(healthGrade(healthTone(10)), "Initializing");
});

test("opportunity score rewards unmet demand over saturated coverage", () => {
  const base = { population: 2_000_000, maxPopulation: 2_000_000 };
  const untapped = computeOpportunityScore({
    ...base, demandScore: 9, buyerLeverage: 8, dealers: 0, pages: 0,
  });
  const saturated = computeOpportunityScore({
    ...base, demandScore: 9, buyerLeverage: 8, dealers: 30, pages: 40,
  });
  assert.ok(
    untapped.score > saturated.score,
    `untapped (${untapped.score}) should beat saturated (${saturated.score})`,
  );
});

test("opportunity score is null-safe and bounded 0-100", () => {
  const r = computeOpportunityScore({
    demandScore: null, buyerLeverage: null, population: null, maxPopulation: 0,
    dealers: 0, pages: 0,
  });
  assert.ok(r.score >= 0 && r.score <= 100);
  // With no demand/population/leverage signal, the gaps dominate the driver.
  assert.ok(["Content Gap", "Coverage Gap"].includes(r.driver));
});

test("opportunity driver names the dominant contributor", () => {
  const r = computeOpportunityScore({
    demandScore: 10, buyerLeverage: 0, population: 0, maxPopulation: 1_000_000,
    dealers: 15, pages: 10,
  });
  assert.equal(r.driver, "Demand");
});
