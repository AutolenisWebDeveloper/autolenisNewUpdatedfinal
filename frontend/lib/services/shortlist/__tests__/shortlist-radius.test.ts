// The radius and freshness gates apply to the shortlist ACTION, never to display.
//
// Transaction-flow spec s22a: the catalogue is served from inventory_items and every listing
// stays visible to every buyer. What changes past 100 miles -- AutoLenis's own policy ceiling,
// not a provider limit -- is which ACTION the card offers, not whether the card exists.
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/shortlist/__tests__/shortlist-radius.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("the shortlist ceiling is 100 miles of AUTOLENIS POLICY, not a provider restriction", () => {
  assert.equal(SHORTLIST_RADIUS_MILES, 100);
});

// ── the ceiling's REASON, which is the requirement ───────────────────────────
//
// s22a's rule is not "the number is 100". It is "the number is 100 BECAUSE AutoLenis
// decided so, and a change of provider, plan or technical limit never moves it". Those
// are different requirements and only the second one is at risk: the constant was
// already correct while the comment above it said the provider's cap was the reason.
// Nothing an engineer can RUN distinguishes the two today -- MarketCheck's package cap
// is also 100 (probed live 2026-09-10: radius=250 -> HTTP 422 "Subscribed package
// radius limit of 100 miles exceeded") -- so the prose is the only carrier of the
// distinction, and prose decays silently. These two tests are what stop it.

test("the policy ceiling is stated as policy, and is not attributed to the provider", () => {
  const src = readFileSync(new URL("../shortlist-radius.ts", import.meta.url), "utf8");
  const header = src.slice(0, src.indexOf("export const SHORTLIST_RADIUS_MILES"));

  assert.match(
    header,
    /AUTOLENIS POLICY/,
    "s22a L1067: 'The 100-mile ceiling is AutoLenis policy ... Policy is decided here, not on an " +
      "invoice.' The header must say so, because the constant alone cannot."
  );

  // The exact sentence that was there before Phase 4, and the shape of any sentence
  // that would reintroduce the same inversion. A header may DISCUSS the provider cap
  // -- it does, to say the two are separate -- but it may not give it as the reason.
  const inverted = /capped at 100 miles,?\s+because that is the data provider|because that is the (?:data )?provider'?s? radius restriction/i;
  assert.doesNotMatch(
    header,
    inverted,
    "The ceiling's rationale has been inverted back to 'the provider's restriction'. That reading is " +
      "what makes an engineer raise this constant the day the sourcing ladder reaches 250 miles. The " +
      "provider cap is a SEPARATE constant (MAX_RADIUS_MILES in inventory-source-config.service.ts) " +
      "with a separate reason."
  );
});

test("the policy ceiling does not derive from the provider's ceiling", () => {
  // The structural half of the same rule, and the half that cannot be talked around:
  // if this file ever derives its number from lib/services/inventory, the policy IS
  // the provider's cap by construction and no header can prevent it.
  //
  // Comments are stripped first. The rule is about CODE — the header deliberately
  // discusses the provider's constant, in order to say that nothing here reads it,
  // and a scan that could not tell those apart would forbid the very sentence that
  // documents the separation.
  const src = readFileSync(new URL("../shortlist-radius.ts", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  const imports = [...code.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]!);
  assert.deepEqual(
    imports.filter((i) => i.includes("services/inventory")),
    [],
    "shortlist-radius.ts must not import from lib/services/inventory: the provider cap must not leak " +
      "into a path that does not answer to the provider."
  );
  assert.doesNotMatch(
    code,
    /\bMAX_RADIUS_MILES\b/,
    "SHORTLIST_RADIUS_MILES must be an independent literal, never derived from the provider's cap."
  );
  assert.match(
    code,
    /export const SHORTLIST_RADIUS_MILES = 100;/,
    "The ceiling must stay a plain literal. Computing it from anything is how it stops being policy."
  );
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
