// Batch 1 — executable-supply eligibility predicate.
// Proves the boundary between "row exists" and "eligible for matching/sourcing":
// orphan (unowned/unsourced) rows and stale/sold external listings are excluded;
// dealer-owned LANE_1 active inventory stays eligible.
//
//   npx tsx --test lib/services/inventory/__tests__/inventory-eligibility.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  isExecutableSupply,
  isShortlistEligible,
  isStaleForSweep,
  isSweepExempt,
  freshnessCutoff,
  FRESHNESS_WINDOW_MS,
} from "@/lib/services/inventory/inventory-eligibility";

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
  createdAt: new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000),
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

test("dealer inventory is fresh while active even without a recent lastSeenAt", () => {
  assert.equal(isExecutableSupply({ ...base, dealerId: "d1", sourceAdapter: null, lane: "LANE_1", lastSeenAt: STALE }, NOW), true);
});

test("REGRESSION: the dealer freshness exemption is CAPPED at the shortlist window", () => {
  // Uncapped, a dealer row unseen for 45 days is matchable but rejected by the
  // shortlist gate — the buyer is shown a vehicle and gets a 409 saving it.
  const fortyFiveDays = new Date(NOW.getTime() - 45 * 24 * 60 * 60 * 1000);
  assert.equal(
    isExecutableSupply({ ...base, dealerId: "d1", sourceAdapter: null, lane: "LANE_1", lastSeenAt: fortyFiveDays }, NOW),
    false,
  );
});

test("INVARIANT: executable supply is always shortlist-eligible (no buyer dead ends)", () => {
  const days = [0, 1, 2, 3, 7, 8, 29, 30, 31, 45, 90];
  for (const lane of ["LANE_1", "LANE_2", "LANE_3"]) {
    for (const dealerId of [null, "d1"]) {
      for (const d of days) {
        const item = {
          ...base,
          lane,
          dealerId,
          lastSeenAt: new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000),
        };
        if (isExecutableSupply(item, NOW)) {
          assert.equal(
            isShortlistEligible(item, NOW),
            true,
            `lane=${lane} dealerId=${dealerId} age=${d}d is matchable but not shortlistable`,
          );
        }
      }
    }
  }
});

test("INVARIANT: a sweep-exempt row is exactly a row the sweep predicate skips", () => {
  for (const dealerId of [null, "d1"]) {
    for (const addedByAdminId of [null, "a1"]) {
      const item = { ...base, dealerId, addedByAdminId, lastSeenAt: STALE };
      assert.equal(
        isStaleForSweep(item, NOW),
        !isSweepExempt(item),
        `exemption and sweep disagree for dealerId=${dealerId} admin=${addedByAdminId}`,
      );
    }
  }
});

test("freshnessCutoff is exactly the window behind now", () => {
  assert.equal(freshnessCutoff(NOW).getTime(), NOW.getTime() - FRESHNESS_WINDOW_MS);
});
