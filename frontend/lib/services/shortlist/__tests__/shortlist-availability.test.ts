// Unavailable shortlist items: visible on the page, excluded from the request.
//
// 10 of 15 production shortlist rows point at inventory the corrected stale sweep will
// deactivate. ShortlistItem.inventoryItemId has NO foreign key, and the page filtered
// missing rows out entirely — so a buyer's saved car either vanished silently or rendered a
// live-looking card linking to a page that 404s.
//
//   npx tsx --test lib/services/shortlist/__tests__/shortlist-availability.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isShortlistItemAvailable, countAvailable, mileageBandFor, priceBandCentsFor,
  buildSimilarRequestHref, REQUEST_PREFILL_KEYS, MILEAGE_STOPS,
} from "@/lib/services/shortlist/shortlist-availability";

// ── Availability ─────────────────────────────────────────────────────────────

test("a deactivated listing is unavailable", () => {
  assert.equal(isShortlistItemAvailable({ isActive: false, priceCents: 2_500_000 }), false);
});

test("a MISSING inventory row is unavailable, not invisible", () => {
  // inventoryItemId is a plain string with no FK, so the row can simply be gone.
  assert.equal(isShortlistItemAvailable(null), false);
  assert.equal(isShortlistItemAvailable(undefined), false);
});

test("an unquotable price is unavailable — there is nothing to take to auction", () => {
  assert.equal(isShortlistItemAvailable({ isActive: true, priceCents: 0 }), false);
});

test("a live, priced listing is available", () => {
  assert.equal(isShortlistItemAvailable({ isActive: true, priceCents: 2_500_000 }), true);
});

test("EXCLUDED FROM THE REQUEST: unavailable items do not consume candidate slots", () => {
  // The shortlist cap is 5. Counting dead rows locks a buyer out of their own shortlist at
  // zero usable candidates — they cannot add a replacement for the car that just sold.
  const items = [
    { inv: { isActive: true, priceCents: 100 } },
    { inv: { isActive: false, priceCents: 100 } },
    { inv: null },
    { inv: { isActive: false, priceCents: 100 } },
    { inv: { isActive: true, priceCents: 100 } },
  ];
  assert.equal(items.length, 5, "five rows exist");
  assert.equal(countAvailable(items, (i) => isShortlistItemAvailable(i.inv)), 2,
    "but only two count against the cap");
});

test("EXCLUDED FROM THE AUCTION: an all-unavailable shortlist cannot activate", () => {
  const items = [{ inv: { isActive: false, priceCents: 100 } }, { inv: null }];
  const available = countAvailable(items, (i) => isShortlistItemAvailable(i.inv));
  assert.equal(available, 0);
  assert.equal(available >= 1, false, "items.length >= 1 must not be what gates activation");
});

// ── Mileage band ─────────────────────────────────────────────────────────────

test("mileageBandFor picks the smallest offered band that contains the reading", () => {
  assert.equal(mileageBandFor(0), "25k");
  assert.equal(mileageBandFor(25_000), "25k");
  assert.equal(mileageBandFor(25_001), "50k");
  assert.equal(mileageBandFor(62_000), "75k");
  assert.equal(mileageBandFor(100_000), "100k");
  assert.equal(mileageBandFor(140_000), "Any");
});

test("an unknown odometer is 'Any', never a fabricated ceiling", () => {
  assert.equal(mileageBandFor(null), "Any");
  assert.equal(mileageBandFor(undefined), "Any");
  assert.equal(mileageBandFor(Number.NaN), "Any");
  assert.equal(mileageBandFor(-5), "Any");
});

test("the bands match the ones the request form actually offers", () => {
  // A band the form does not know is silently dropped by its hydration effect, producing an
  // empty field that looks like the feature working.
  const page = readFileSync(join(process.cwd(), "app/buyer/requests/new/page.tsx"), "utf8");
  const m = page.match(/const MILEAGE_STOPS:\s*MileageOption\[\]\s*=\s*\[([^\]]*)\]/);
  assert.ok(m, "MILEAGE_STOPS not found in the request form");
  const formStops = m![1]!.split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
  assert.deepEqual(formStops, [...MILEAGE_STOPS]);
});

// ── Price band ───────────────────────────────────────────────────────────────

test("priceBandCentsFor adds headroom and rounds up to a clean $1,000", () => {
  // The car they picked is GONE. Quoting its exact price as a ceiling would systematically
  // exclude every comparable replacement.
  assert.equal(priceBandCentsFor(2_845_000), 3_200_000);   // $28,450 +10% = $31,295 -> $32,000
  assert.equal(priceBandCentsFor(2_500_000), 2_800_000);   // $25,000 +10% = $27,500 -> $28,000
  assert.ok(priceBandCentsFor(2_845_000)! > 2_845_000, "always above the asking price");
});

test("an unusable price yields no budget filter rather than a wrong one", () => {
  assert.equal(priceBandCentsFor(0), null);
  assert.equal(priceBandCentsFor(-1), null);
  assert.equal(priceBandCentsFor(null), null);
});

// ── The href ─────────────────────────────────────────────────────────────────

const SEED = { year: 2021, make: "Honda", model: "Accord", trim: "Sport", mileage: 62_000, priceCents: 2_845_000 };

test("the CTA carries year, make, model, trim, mileage band and price band", () => {
  const url = new URL(buildSimilarRequestHref(SEED), "http://localhost");
  assert.equal(url.pathname, "/buyer/requests/new");
  assert.equal(url.searchParams.get("makePreference"), "Honda");
  assert.equal(url.searchParams.get("modelPreference"), "Accord");
  assert.equal(url.searchParams.get("trim"), "Sport");
  assert.equal(url.searchParams.get("maxMileage"), "75k");
  assert.equal(url.searchParams.get("maxBudgetCents"), "3200000");
  // Year is a window for the same reason price is a band: an exact-year filter on a car
  // that has already sold is a filter that matches nothing.
  assert.equal(url.searchParams.get("yearMin"), "2020");
  assert.equal(url.searchParams.get("yearMax"), "2022");
});

test("a missing trim is omitted, not sent empty", () => {
  const url = new URL(buildSimilarRequestHref({ ...SEED, trim: null }), "http://localhost");
  assert.equal(url.searchParams.has("trim"), false);
});

test("EVERY emitted key is one the request form actually reads", () => {
  // This is the assertion that stops the feature silently degrading to an empty form: a
  // rename on either side fails here rather than in production.
  const page = readFileSync(join(process.cwd(), "app/buyer/requests/new/page.tsx"), "utf8");
  const url = new URL(buildSimilarRequestHref(SEED), "http://localhost");
  for (const key of url.searchParams.keys()) {
    assert.ok(
      (REQUEST_PREFILL_KEYS as readonly string[]).includes(key),
      `${key} is emitted but not declared in REQUEST_PREFILL_KEYS`,
    );
    assert.ok(
      page.includes(`sp.get("${key}")`),
      `${key} is emitted but /buyer/requests/new never reads it — the form would open empty`,
    );
  }
});
