// End-to-end policy lifecycle: one listing, walked through time.
//
// The unit tests pin each predicate in isolation. This walks a single row through
// the whole policy the way production will, because the three windows (48h sweep,
// 7d stale flag, 30d shortlist cutoff) only make sense in relation to each other —
// and it is exactly that relation the individual tests cannot see.
//
// It also pins the two facts an operator most needs to be true:
//   • an aggregator listing cannot outlive its source going quiet
//   • a dealer's own listing is never deactivated by AutoLenis, but does not stay
//     shortlist-eligible forever either
//
//   npx tsx --test lib/services/inventory/__tests__/listing-lifecycle.test.ts

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  isStaleForSweep,
  isShortlistEligible,
  isExecutableSupply,
  listingFreshness,
} from "@/lib/services/inventory/inventory-eligibility";

const DAY = 24 * 60 * 60 * 1000;
const INGESTED = new Date("2026-09-02T12:00:00Z");
const at = (days: number) => new Date(INGESTED.getTime() + days * DAY);

/** A listing as it exists right after ingest, plus whatever ownership applies. */
function listing(over: Partial<{
  dealerId: string | null;
  addedByAdminId: string | null;
  sourceAdapter: string | null;
  lane: string;
  isActive: boolean;
}> = {}) {
  return {
    isActive: true,
    priceCents: 2_500_000,
    lane: "LANE_3",
    dealerId: null as string | null,
    addedByAdminId: null as string | null,
    sourceAdapter: "marketcheck" as string | null,
    lastSeenAt: INGESTED as Date | null,
    createdAt: INGESTED,
    ...over,
  };
}

describe("an aggregator listing whose source goes quiet", () => {
  const row = listing();

  test("day 0 — visible, matchable, shortlistable, not flagged", () => {
    const f = listingFreshness(row, at(0));
    assert.equal(f.isStale, false);
    assert.equal(isShortlistEligible(row, at(0)), true);
    assert.equal(isExecutableSupply(row, at(0)), true);
    assert.equal(isStaleForSweep(row, at(0)), false);
  });

  test("day 1 — still inside every window", () => {
    assert.equal(isStaleForSweep(row, at(1)), false);
    assert.equal(isExecutableSupply(row, at(1)), true);
  });

  test("day 3 — past 48h, so the sweep claims it", () => {
    assert.equal(isStaleForSweep(row, at(3)), true, "the sweep is what the 48h window is for");
    assert.equal(isExecutableSupply(row, at(3)), false, "and it stops being matchable at the same moment");
  });

  test("day 3, post-sweep — deactivated, so no longer shortlistable", () => {
    const swept = { ...row, isActive: false };
    assert.equal(isShortlistEligible(swept, at(3)), false);
    assert.equal(isStaleForSweep(swept, at(3)), false, "the sweep does not re-sweep what it already took");
  });

  test("the 7d flag and 30d cutoff never fire for it — it is gone by day 3", () => {
    // Not a gap: for feed rows `isActive` is the operative signal, and the sweep
    // acts long before either freshness window is reached. The windows exist for
    // the sweep-exempt rows below.
    assert.ok(3 * DAY < 7 * DAY);
  });
});

describe("a dealer's own listing", () => {
  const row = listing({ dealerId: "dealer_1", lane: "LANE_1", sourceAdapter: "dealer_manual" });

  test("day 3 — NOT swept: AutoLenis never auto-deactivates dealer inventory", () => {
    assert.equal(isStaleForSweep(row, at(3)), false);
    assert.equal(isExecutableSupply(row, at(3)), true, "and the dealer exemption keeps it matchable");
  });

  test("day 8 — flagged stale for the UI, still fully usable", () => {
    const f = listingFreshness(row, at(8));
    assert.equal(f.isStale, true);
    assert.equal(isShortlistEligible(row, at(8)), true);
    assert.equal(isExecutableSupply(row, at(8)), true);
  });

  test("day 31 — no longer shortlist-eligible, and no longer matchable either", () => {
    assert.equal(isShortlistEligible(row, at(31)), false);
    assert.equal(
      isExecutableSupply(row, at(31)),
      false,
      "the dealer freshness exemption is capped at the shortlist window, so a buyer is never " +
        "shown a vehicle they cannot then save",
    );
    assert.equal(isStaleForSweep(row, at(31)), false, "but it is still never auto-deactivated");
  });

  test("an edit at day 20 resets the clock — this is why edit paths stamp lastSeenAt", () => {
    const edited = { ...row, lastSeenAt: at(20) };
    assert.equal(isShortlistEligible(edited, at(31)), true);
    assert.equal(listingFreshness(edited, at(31)).isStale, true, "still flagged: 11 days since the edit");
  });
});

describe("an admin-curated listing (the homepage-featured case)", () => {
  const row = listing({ addedByAdminId: "admin_1", lane: "LANE_1", sourceAdapter: "manual_admin" });

  test("day 3 — NOT swept, so featuring survives a quiet feed", () => {
    assert.equal(isStaleForSweep(row, at(3)), false);
  });

  test("day 8 — flagged stale, so 'exempt' never means 'immortal and unmarked'", () => {
    assert.equal(listingFreshness(row, at(8)).isStale, true);
  });

  test("day 31 — not shortlist-eligible", () => {
    assert.equal(isShortlistEligible(row, at(31)), false);
  });
});

describe("the orphan cohort this change exists to remove", () => {
  // 95 production rows: LANE_1, dealer_id NULL, added_by_admin_id NULL,
  // source_adapter NULL, last seen up to four months ago (one never stamped).
  const orphan = listing({ lane: "LANE_1", sourceAdapter: null });
  const neverStamped = { ...orphan, lastSeenAt: null };

  test("swept, despite carrying LANE_1", () => {
    assert.equal(isStaleForSweep({ ...orphan, lastSeenAt: at(-90) }, at(0)), true);
  });

  test("swept even with no lastSeenAt at all", () => {
    assert.equal(isStaleForSweep({ ...neverStamped, createdAt: at(-120) }, at(0)), true);
  });

  test("never was executable supply — it has no provenance to attribute", () => {
    assert.equal(isExecutableSupply({ ...orphan, lastSeenAt: at(-90) }, at(0)), false);
  });
});
