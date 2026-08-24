// Batch 1 — executable-supply eligibility predicate.
// Proves the boundary between "row exists" and "eligible for matching/sourcing":
// orphan (unowned/unsourced) rows and stale/sold external listings are excluded;
// dealer-owned LANE_1 active inventory stays eligible.
//
//   npx tsx --test lib/services/inventory/__tests__/inventory-eligibility.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { isExecutableSupply, freshnessCutoff, FRESHNESS_WINDOW_MS } from "@/lib/services/inventory/inventory-eligibility";

const NOW = new Date("2026-08-24T00:00:00Z");
const FRESH = new Date(NOW.getTime() - 1000);
const STALE = new Date(NOW.getTime() - FRESHNESS_WINDOW_MS - 1000);

const base = {
  isActive: true,
  priceCents: 2_500_000,
  dealerId: null as string | null,
  sourceAdapter: "marketcheck" as string | null,
  addedByAdminId: null as string | null,
  lane: "LANE_3",
  lastSeenAt: FRESH as Date | null,
};

test("orphan row with NO provenance is NOT executable supply (historical unowned items)", () => {
  assert.equal(isExecutableSupply({ ...base, dealerId: null, sourceAdapter: null, addedByAdminId: null }, NOW), false);
});

test("dealer-owned provenance qualifies", () => {
  assert.equal(isExecutableSupply({ ...base, sourceAdapter: null, dealerId: "d1", lane: "LANE_1" }, NOW), true);
});

test("admin-added provenance qualifies", () => {
  assert.equal(isExecutableSupply({ ...base, sourceAdapter: null, addedByAdminId: "a1" }, NOW), true);
});

test("inactive (archived / stale-swept) row is excluded", () => {
  assert.equal(isExecutableSupply({ ...base, isActive: false }, NOW), false);
});

test("zero/negative price is excluded", () => {
  assert.equal(isExecutableSupply({ ...base, priceCents: 0 }, NOW), false);
});

test("stale external LANE_3 listing is excluded (cannot match)", () => {
  assert.equal(isExecutableSupply({ ...base, lane: "LANE_3", lastSeenAt: STALE }, NOW), false);
});

test("external listing with null lastSeenAt is excluded (no freshness signal)", () => {
  assert.equal(isExecutableSupply({ ...base, lane: "LANE_2", lastSeenAt: null }, NOW), false);
});

test("LANE_1 dealer inventory is fresh while active even without a recent lastSeenAt", () => {
  assert.equal(isExecutableSupply({ ...base, dealerId: "d1", sourceAdapter: null, lane: "LANE_1", lastSeenAt: STALE }, NOW), true);
});

test("freshnessCutoff is exactly the window behind now", () => {
  assert.equal(freshnessCutoff(NOW).getTime(), NOW.getTime() - FRESHNESS_WINDOW_MS);
});
