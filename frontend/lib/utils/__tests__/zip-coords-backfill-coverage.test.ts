// Coverage guard for the ZIPs the buyer-location backfill actually needs.
//
// `dealer-invitation.service` resolves a buyer's coordinates as
// `geocodeZip(zip) ?? lookupCity(city, state)`, and `geocodeZip` falls back to
// Google ONLY when GOOGLE_GEOCODING_API_KEY is configured — a variable that is
// read in code but declared in neither env.d.ts nor .env.example, so its
// production value is unverified. The static tables are therefore the worst
// case, and the case this guard pins.
//
// It pins every ZIP in the production buyer_opportunities distribution, not just
// the ones a given backfill batch happens to write. Two rounds of additions so
// far, each caught by the checker BEFORE any row was written:
//
//   Frisco, TX     75034, 75035        — the four recoverable buyers
//   Broward, FL    33064, 33068, 33069 — the Florida opportunity cluster
//
// In both cases the ZIPs missed the static table and their cities missed
// CITY_COORDS, so writing them would have resolved to null and the auctions
// would still have invited zero dealers — a backfill that looked done and
// changed nothing.
//
// Run: pnpm test:utils

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lookupZip, lookupCity, ZIP_COORDS, CITY_COORDS } from "../zip-coords";

// The exact values the backfill will write, from buyer_opportunities.zip.
const BACKFILL_ZIPS = ["75034", "75035"] as const;

test("every ZIP the backfill will write resolves in the static table", () => {
  for (const zip of BACKFILL_ZIPS) {
    assert.ok(
      lookupZip(zip),
      `${zip} must resolve without GOOGLE_GEOCODING_API_KEY — otherwise the backfill writes a value that still invites zero dealers`,
    );
  }
});

test("the city/state fallback for those ZIPs also resolves", () => {
  // Defence in depth: if a backfill writes city+state instead of (or as well as)
  // the ZIP, the second leg of the matcher's resolution must work too.
  assert.ok(lookupCity("Frisco", "TX"), "frisco,tx must be in CITY_COORDS");
  // lookupCity lowercases both sides, so casing must not matter.
  assert.ok(lookupCity("frisco", "tx"));
  assert.ok(lookupCity("FRISCO", "Tx"));
});

test("the Frisco coordinates are in the right place", () => {
  // A wrong coordinate is worse than a missing one: it silently selects the
  // wrong dealers. Pin a generous box around Frisco, TX (~33.15N, ~96.82W) —
  // tight enough to catch a transposed sign or swapped lat/lng, loose enough
  // not to bind an editorial refinement of the centroid.
  for (const zip of BACKFILL_ZIPS) {
    const c = lookupZip(zip)!;
    assert.ok(c.lat > 32.9 && c.lat < 33.4, `${zip} latitude ${c.lat} is not in the Frisco area`);
    assert.ok(c.lng > -97.1 && c.lng < -96.5, `${zip} longitude ${c.lng} is not in the Frisco area`);
  }
  const city = lookupCity("Frisco", "TX")!;
  assert.ok(city.lat > 32.9 && city.lat < 33.4);
  assert.ok(city.lng > -97.1 && city.lng < -96.5);
});

test("Frisco sits north of Dallas and near Plano — a sanity check on the geography", () => {
  // Catches a coordinate pasted from the wrong row: Frisco is ~25mi N of Dallas
  // and just N of Plano.
  const frisco = lookupCity("Frisco", "TX")!;
  const dallas = lookupCity("Dallas", "TX")!;
  const plano = lookupCity("Plano", "TX")!;

  assert.ok(frisco.lat > dallas.lat, "Frisco must be north of Dallas");
  assert.ok(frisco.lat > plano.lat, "Frisco must be north of Plano");
  assert.ok(Math.abs(frisco.lng - dallas.lng) < 0.5, "Frisco must be near Dallas' longitude");
});

test("the additions did not disturb the existing tables", () => {
  // Regression: a hand edit to a large literal is easy to get wrong. Pin two
  // pre-existing neighbours exactly, and assert the tables only ever grew.
  // Exact counts are deliberately NOT pinned — a legitimate future addition
  // should not have to edit this test — but a deletion still trips the floor.
  assert.deepEqual(ZIP_COORDS["75024"], { lat: 33.0795, lng: -96.8088 }); // Plano
  assert.deepEqual(ZIP_COORDS["75201"], { lat: 32.7831, lng: -96.8067 }); // Dallas
  assert.ok(Object.keys(ZIP_COORDS).length >= 175, "173 baseline + 75034 + 75035");
  assert.ok(Object.keys(CITY_COORDS).length >= 128, "127 baseline + frisco,tx");
});

test("no duplicate keys were introduced into the source literals", () => {
  // Checked against the SOURCE TEXT, not the parsed object: a duplicated key in
  // an object literal is silently last-wins, so Object.keys() has already
  // deduped by the time a test can see it and could never catch this.
  // process.cwd()-relative, matching the repo's other structural guard
  // (lib/services/auction/__tests__/no-inhouse-financing-on-auction-spine.test.ts):
  // import.meta.dirname is not populated under the tsx transform.
  const src = readFileSync(join(process.cwd(), "lib/utils/zip-coords.ts"), "utf8");

  for (const [label, re] of [
    ["ZIP", /^\s*"(\d{5})":/gm],
    ["city", /^\s*"([a-z .'-]+,[a-z]{2})":/gm],
  ] as const) {
    const keys = [...src.matchAll(re)].map((m) => m[1]);
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    assert.deepEqual(dupes, [], `duplicate ${label} keys in zip-coords.ts: ${dupes.join(", ")}`);
  }
});

// ─── Broward County, FL — the Florida opportunity cluster ────────────────────
// Production buyer_opportunities distribution: 33068 Margate x5, 33069 Pompano
// x1; buyers.zip also carries 33064 (a Pompano Beach ZIP). All three missed the
// static table before this change.
//
// These resolve so the DIAGNOSIS is honest, not because a dealer will be found:
// both dealers sit in 75035 (Frisco, TX), so a placeable Florida buyer returns
// NO_DEALER_IN_RANGE rather than BUYER_NOT_GEOCODABLE. That distinction is the
// whole point of Fix 2 — a dealer-supply gap must not masquerade as a
// buyer-data gap.

const BROWARD_ZIPS = ["33064", "33068", "33069"] as const;

test("every Florida cluster ZIP resolves in the static table", () => {
  for (const zip of BROWARD_ZIPS) {
    assert.ok(
      lookupZip(zip),
      `${zip} must resolve without GOOGLE_GEOCODING_API_KEY — otherwise a Florida buyer reports BUYER_NOT_GEOCODABLE when the real cause is dealer supply`,
    );
  }
});

test("the city/state fallback resolves for the Florida cities", () => {
  assert.ok(lookupCity("Margate", "FL"), "margate,fl must be in CITY_COORDS");
  assert.ok(lookupCity("Pompano Beach", "FL"), "pompano beach,fl must be in CITY_COORDS");
  // lookupCity lowercases both sides; the two-word city name must survive it.
  assert.ok(lookupCity("pompano beach", "fl"));
  assert.ok(lookupCity("POMPANO BEACH", "Fl"));
});

test("the Broward coordinates are in the right place", () => {
  // Same discipline as Frisco: a wrong coordinate silently selects the wrong
  // dealers. Broward County spans roughly 25.9-26.4N, 80.0-80.5W.
  for (const zip of BROWARD_ZIPS) {
    const c = lookupZip(zip)!;
    assert.ok(c.lat > 25.9 && c.lat < 26.5, `${zip} latitude ${c.lat} is not in Broward County`);
    assert.ok(c.lng > -80.5 && c.lng < -80.0, `${zip} longitude ${c.lng} is not in Broward County`);
  }
  for (const [city, st] of [["Margate", "FL"], ["Pompano Beach", "FL"]] as const) {
    const c = lookupCity(city, st)!;
    assert.ok(c.lat > 25.9 && c.lat < 26.5, `${city} latitude ${c.lat} is not in Broward County`);
    assert.ok(c.lng > -80.5 && c.lng < -80.0, `${city} longitude ${c.lng} is not in Broward County`);
  }
});

test("Broward geography: both cities north of Fort Lauderdale, Margate inland of Pompano", () => {
  // Catches a coordinate pasted from the wrong row. Margate and Pompano Beach
  // are both ~10-14mi north of Fort Lauderdale; Pompano Beach is coastal and
  // Margate is inland, so Margate must sit further west.
  const ftl = lookupCity("Fort Lauderdale", "FL")!;
  const margate = lookupCity("Margate", "FL")!;
  const pompano = lookupCity("Pompano Beach", "FL")!;

  assert.ok(margate.lat > ftl.lat, "Margate must be north of Fort Lauderdale");
  assert.ok(pompano.lat > ftl.lat, "Pompano Beach must be north of Fort Lauderdale");
  assert.ok(margate.lng < pompano.lng, "Margate is inland, so west of coastal Pompano Beach");
});

test("the Florida ZIPs are not accidentally mapped to Texas", () => {
  // The two rounds of additions sit in the same file; a copy-paste between them
  // would be invisible to a bounding-box test that only checked one region.
  for (const zip of BROWARD_ZIPS) {
    assert.ok(lookupZip(zip)!.lng > -85, `${zip} must be in Florida, not Texas`);
  }
  for (const zip of BACKFILL_ZIPS) {
    assert.ok(lookupZip(zip)!.lng < -90, `${zip} must be in Texas, not Florida`);
  }
});

test("the already-covered distribution ZIPs still resolve", () => {
  // 75024 (Plano x15) and 30301 (Atlanta x1) were already present. Pinned so a
  // future edit to this table cannot silently drop them.
  assert.ok(lookupZip("75024"), "75024 Plano must stay covered");
  assert.ok(lookupZip("30301"), "30301 Atlanta must stay covered");
});
