// Coverage guard for the ZIPs the buyer-location backfill actually needs.
//
// `dealer-invitation.service` resolves a buyer's coordinates as
// `geocodeZip(zip) ?? lookupCity(city, state)`, and `geocodeZip` falls back to
// Google ONLY when GOOGLE_GEOCODING_API_KEY is configured — a variable that is
// read in code but declared in neither env.d.ts nor .env.example, so its
// production value is unverified. The static tables are therefore the worst
// case, and the case this guard pins.
//
// The four recoverable buyers in docs/plans/BUYER-LOCATION-BACKFILL.md carry
// 75035 (x3) and 75034 — both Frisco, TX. Before this change both MISSED the
// static ZIP table and `frisco,tx` missed CITY_COORDS, so writing those ZIPs
// would have resolved to null and the auctions would still have invited zero
// dealers. The backfill would have looked done and changed nothing.
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
