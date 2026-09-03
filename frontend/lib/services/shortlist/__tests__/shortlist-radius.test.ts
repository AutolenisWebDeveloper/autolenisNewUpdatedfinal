// The radius and freshness gates apply to the shortlist ACTION, never to display.
//
// Transaction-flow spec s22a: the catalogue is served from inventory_items and every listing
// stays visible to every buyer. What changes past 100 miles -- the data provider's radius
// restriction -- is which ACTION the card offers, not whether the card exists.
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/shortlist/__tests__/shortlist-radius.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  SHORTLIST_RADIUS_MILES,
  STALE_FLAG_WINDOW_MS,
  SHORTLIST_FRESHNESS_WINDOW_MS,
  freshnessOf,
  shortlistGate,
  type ListingGateFacts,
} from "../shortlist-radius";

const NOW = new Date("2026-09-03T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

/** A swept third-party listing 10 miles away, seen today. The ordinary case. */
function listing(over: Partial<ListingGateFacts> = {}): ListingGateFacts {
  return {
    distanceMiles: 10,
    isActive: true,
    priceCents: 2_500_000,
    lastSeenAt: NOW,
    lane: "LANE_3",
    dealerId: null,
    addedByAdminId: null,
    ...over,
  };
}

// ── the ceiling itself ───────────────────────────────────────────────────────

test("the shortlist ceiling is the provider's 100 mile restriction", () => {
  assert.equal(SHORTLIST_RADIUS_MILES, 100);
});

test("windows are 7 days for the stale flag and 30 for eligibility", () => {
  assert.equal(STALE_FLAG_WINDOW_MS, 7 * 24 * 60 * 60 * 1000);
  assert.equal(SHORTLIST_FRESHNESS_WINDOW_MS, 30 * 24 * 60 * 60 * 1000);
});

// ── radius gating ────────────────────────────────────────────────────────────

test("within 100 miles the buyer may shortlist", () => {
  const g = shortlistGate(listing({ distanceMiles: 99.9 }), { hasZip: true }, NOW);
  assert.equal(g.action, "ADD");
  assert.equal(g.visible, true, "visibility is never in question");
});

test("exactly 100 miles is INSIDE the radius", () => {
  assert.equal(shortlistGate(listing({ distanceMiles: 100 }), { hasZip: true }, NOW).action, "ADD");
});

test("beyond 100 miles the action becomes the custom request, and the card stays", () => {
  const g = shortlistGate(listing({ distanceMiles: 100.1 }), { hasZip: true }, NOW);
  assert.equal(g.action, "REQUEST_SIMILAR");
  assert.equal(g.reason, "OUT_OF_RADIUS");
  assert.equal(g.visible, true, "a distant listing is still browsable -- hide nothing");
});

test("a listing that cannot be placed fails CLOSED, but is still shown", () => {
  const g = shortlistGate(listing({ distanceMiles: null }), { hasZip: true }, NOW);
  assert.equal(g.action, "REQUEST_SIMILAR", "unprovable proximity is not proven proximity");
  assert.equal(g.reason, "DISTANCE_UNKNOWN");
  assert.equal(g.visible, true);
});

test("with no buyer ZIP the catalogue still renders and the action asks for one", () => {
  const g = shortlistGate(listing({ distanceMiles: null }), { hasZip: false }, NOW);
  assert.equal(g.action, "NEED_ZIP");
  assert.equal(g.visible, true, "the grid renders before we know where the buyer is");
});

test("no ZIP outranks every other gate -- we cannot judge distance yet", () => {
  const g = shortlistGate(listing({ distanceMiles: 5000, lastSeenAt: daysAgo(90) }), { hasZip: false }, NOW);
  assert.equal(g.action, "NEED_ZIP");
});

// ── freshness gating ─────────────────────────────────────────────────────────

test("seen today: fresh, no flag", () => {
  assert.equal(freshnessOf(NOW, NOW), "FRESH");
});

test("not seen in 7 days: stale FLAG only -- still shortlistable", () => {
  assert.equal(freshnessOf(daysAgo(8), NOW), "STALE");
  const g = shortlistGate(listing({ lastSeenAt: daysAgo(8) }), { hasZip: true }, NOW);
  assert.equal(g.action, "ADD", "a stale flag warns; it does not withdraw the action");
  assert.equal(g.freshness, "STALE");
});

test("not seen in 30 days: NOT shortlist-eligible, offers the custom request", () => {
  assert.equal(freshnessOf(daysAgo(31), NOW), "EXPIRED");
  const g = shortlistGate(listing({ lastSeenAt: daysAgo(31) }), { hasZip: true }, NOW);
  assert.equal(g.action, "REQUEST_SIMILAR");
  assert.equal(g.reason, "STALE_LISTING");
  assert.equal(g.visible, true, "an expired listing is still displayed -- gating is on the action");
});

test("a never-seen listing is treated as expired, not as fresh", () => {
  assert.equal(freshnessOf(null, NOW), "EXPIRED");
  assert.equal(shortlistGate(listing({ lastSeenAt: null }), { hasZip: true }, NOW).action, "REQUEST_SIMILAR");
});

test("dealer-MANAGED inventory has no feed to be re-seen in, so it never expires", () => {
  const g = shortlistGate(
    listing({ lastSeenAt: daysAgo(400), lane: "LANE_1", dealerId: "d1" }),
    { hasZip: true },
    NOW,
  );
  assert.equal(g.action, "ADD");
  assert.equal(g.freshness, "FRESH");
});

test("the LANE_1 label ALONE does not grant the exemption -- a dealer must own the row", () => {
  const g = shortlistGate(
    listing({ lastSeenAt: daysAgo(400), lane: "LANE_1", dealerId: null }),
    { hasZip: true },
    NOW,
  );
  assert.equal(g.action, "REQUEST_SIMILAR", "the 95 production orphans must not read as forever-fresh");
});

test("an admin-entered vehicle is exempt too", () => {
  const g = shortlistGate(
    listing({ lastSeenAt: daysAgo(400), addedByAdminId: "a1" }),
    { hasZip: true },
    NOW,
  );
  assert.equal(g.action, "ADD");
});

// ── availability still wins ──────────────────────────────────────────────────

test("a deactivated listing offers the custom request even when near and fresh", () => {
  const g = shortlistGate(listing({ isActive: false }), { hasZip: true }, NOW);
  assert.equal(g.action, "REQUEST_SIMILAR");
  assert.equal(g.reason, "UNAVAILABLE");
});

test("an unpriced listing has nothing to quote", () => {
  const g = shortlistGate(listing({ priceCents: 0 }), { hasZip: true }, NOW);
  assert.equal(g.action, "REQUEST_SIMILAR");
  assert.equal(g.reason, "UNAVAILABLE");
});

test("EVERY gate outcome leaves the listing visible -- the invariant of the whole feature", () => {
  const cases: Array<Partial<ListingGateFacts>> = [
    {}, { distanceMiles: 9999 }, { distanceMiles: null }, { lastSeenAt: daysAgo(400) },
    { lastSeenAt: null }, { isActive: false }, { priceCents: 0 },
  ];
  for (const over of cases) {
    for (const hasZip of [true, false]) {
      assert.equal(shortlistGate(listing(over), { hasZip }, NOW).visible, true,
        `hidden for ${JSON.stringify(over)} hasZip=${hasZip}`);
    }
  }
});
