// Unit tests for buildInventoryWhereFromFilters — the saved-search `filters`
// JSON → InventoryItem where-clause mapping used by the saved-search matcher.
// Run with:  npx tsx --tsconfig lib/crm/__tests__/tsconfig.test.json \
//              --test lib/crm/__tests__/saved-search-filters.proof.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { buildInventoryWhereFromFilters } from "../saved-search-filters";

test("maps make/model to case-insensitive equals", () => {
  const w = buildInventoryWhereFromFilters({ make: "Toyota", model: "Camry" });
  assert.deepEqual(w.make, { equals: "Toyota", mode: "insensitive" });
  assert.deepEqual(w.model, { equals: "Camry", mode: "insensitive" });
});

test("maps year range and converts dollar price to cents", () => {
  const w = buildInventoryWhereFromFilters({ yearMin: 2018, yearMax: 2022, priceMax: 25000 });
  assert.deepEqual(w.year, { gte: 2018, lte: 2022 });
  assert.deepEqual(w.priceCents, { lte: 2_500_000 });
});

test("accepts numeric strings and applies priceMin floor", () => {
  const w = buildInventoryWhereFromFilters({ priceMin: "15000", mileageMax: "60000" });
  assert.deepEqual(w.priceCents, { gte: 1_500_000 });
  assert.deepEqual(w.mileage, { lte: 60000 });
});

test("ignores empty / unknown / non-scalar keys", () => {
  const w = buildInventoryWhereFromFilters({
    make: "   ",
    randomKey: "x",
    nested: { a: 1 },
    model: "",
  });
  assert.deepEqual(w, {}, "blank, unknown, and object values produce no clause");
});

test("maps the insensitive enum-ish fields", () => {
  const w = buildInventoryWhereFromFilters({ condition: "used", bodyType: "SUV", fuelType: "hybrid" });
  assert.deepEqual((w as Record<string, unknown>).condition, { equals: "used", mode: "insensitive" });
  assert.deepEqual((w as Record<string, unknown>).bodyType, { equals: "SUV", mode: "insensitive" });
  assert.deepEqual((w as Record<string, unknown>).fuelType, { equals: "hybrid", mode: "insensitive" });
});
