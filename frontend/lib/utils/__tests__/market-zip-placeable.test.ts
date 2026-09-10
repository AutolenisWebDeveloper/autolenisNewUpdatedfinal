// The market AutoLenis actually sweeps must be placeable without a Google key.
//
// `inventory_sources.center_zip` is 76011 (Arlington) in production. `lookupZip` is the free,
// authoritative first tier of `geocodeZip`; the cache and Google sit behind it. With 76011
// absent from the table and no GOOGLE_GEOCODING_API_KEY provisioned, `geocodeZip("76011")`
// returned null — so a buyer in the served market got NEED_ZIP on the qualified-results view
// and NO_ZIP on every shortlist add, with no way forward. Reproduced against a real database
// by lib/services/shortlist/__tests__/destructive/shortlist-cap-concurrency.test.ts before it
// was fixed.
//
// This is a floor, not a geocoding strategy: the table is a hand-curated fallback and the
// answer to the NEXT market is the Google tier, not another edit here. What it pins is that
// the market we are configured for today cannot silently become unplaceable again.
//
//   npx tsx --test lib/utils/__tests__/market-zip-placeable.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { lookupZip, haversineMiles } from "../zip-coords";

/** The configured sweep centre, and the DFW anchors a buyer in that market is nearest to. */
const SERVED_MARKET_ZIPS = ["76011", "76102", "75201"] as const;

test("the configured market centre resolves from the free tier alone", () => {
  const arlington = lookupZip("76011");
  assert.ok(arlington, "76011 is inventory_sources.center_zip — it must never be unplaceable");
  // Arlington TX sits inside this box. A transposed sign or a swapped lat/lng would leave the
  // ZIP 'placeable' and put every distance in the wrong hemisphere, which is worse than null.
  assert.ok(arlington.lat > 32 && arlington.lat < 33.5, `latitude out of Texas: ${arlington.lat}`);
  assert.ok(arlington.lng < -96 && arlington.lng > -98, `longitude out of Texas: ${arlington.lng}`);
});

test("every served-market ZIP resolves, and they are plausibly near one another", () => {
  const placed = SERVED_MARKET_ZIPS.map((z) => {
    const c = lookupZip(z);
    assert.ok(c, `${z} is a served-market ZIP and does not resolve`);
    return c;
  });
  const centre = placed[0]!;
  for (let i = 1; i < placed.length; i++) {
    const d = haversineMiles(centre, placed[i]!);
    assert.ok(d < 60, `${SERVED_MARKET_ZIPS[i]} is ${d.toFixed(1)} miles from the sweep centre — that is not the same metro`);
  }
});

test("an unknown ZIP still returns null rather than a guess", () => {
  assert.equal(lookupZip("00000"), null);
  assert.equal(lookupZip(""), null);
  assert.equal(lookupZip("7601"), null, "a four-digit fragment is not a ZIP");
});
