// Dry-run checker for the buyer-location backfill
// (docs/plans/BUYER-LOCATION-GAP.md).
//
// READ-ONLY. Touches no database, mutates nothing, sends nothing. It answers one
// question per candidate row: would this location actually place the buyer, i.e.
// would `dealer-invitation.service` resolve coordinates for it and stop
// returning zero invitations?
//
// That question is NOT "is the ZIP real" — it is "is it resolvable by the code
// path that runs in production". The matcher resolves coordinates as:
//
//     geocodeZip(zip) ?? lookupCity(city, state)
//
// and `geocodeZip` consults the static table first, then a cache, then Google —
// but ONLY when GOOGLE_GEOCODING_API_KEY is configured, otherwise it returns
// null. This checker deliberately evaluates the STATIC tables alone, which is
// the worst case and the one that holds if the key is unset. A row that fails
// here is a row whose backfill would not fix the auction.
//
// Usage:
//   npx tsx scripts/check-buyer-location-backfill.ts candidates.json
//   npx tsx scripts/check-buyer-location-backfill.ts --coverage
//
// candidates.json is an array of:
//   { "buyerId": "6cc7bfa6", "zip": "78701", "city": "Austin", "state": "TX",
//     "source": "stripe_billing" }

import { readFileSync } from "node:fs";
import { ZIP_COORDS, CITY_COORDS, lookupZip, lookupCity } from "../lib/utils/zip-coords";

interface Candidate {
  buyerId: string;
  zip?: string | null;
  city?: string | null;
  state?: string | null;
  source?: string;
}

type Verdict = "PLACES_BY_ZIP" | "PLACES_BY_CITY" | "WILL_NOT_PLACE" | "NO_VALUE_SUPPLIED";

interface Result {
  buyerId: string;
  zip: string;
  city: string;
  state: string;
  verdict: Verdict;
  note: string;
}

/** Mirrors the matcher's resolution order, static tables only. */
function evaluate(c: Candidate): Result {
  const zip = (c.zip ?? "").trim();
  const city = (c.city ?? "").trim();
  const state = (c.state ?? "").trim().toUpperCase();
  const base = { buyerId: c.buyerId, zip: zip || "—", city: city || "—", state: state || "—" };

  if (!zip && !city && !state) {
    return { ...base, verdict: "NO_VALUE_SUPPLIED", note: "no candidate value — needs a source" };
  }

  if (zip) {
    if (lookupZip(zip)) {
      return { ...base, verdict: "PLACES_BY_ZIP", note: "static ZIP table hit" };
    }
    // A real ZIP that the static table does not carry still fails closed unless
    // GOOGLE_GEOCODING_API_KEY is set — the matcher would resolve null and
    // invite nobody.
    if (city && state && lookupCity(city, state)) {
      return {
        ...base,
        verdict: "PLACES_BY_CITY",
        note: "ZIP not in static table — placed via city/state fallback",
      };
    }
    return {
      ...base,
      verdict: "WILL_NOT_PLACE",
      note: "ZIP absent from static table and no city/state fallback — needs GOOGLE_GEOCODING_API_KEY or a covered city",
    };
  }

  if (city && state) {
    if (lookupCity(city, state)) {
      return { ...base, verdict: "PLACES_BY_CITY", note: "static city table hit" };
    }
    return {
      ...base,
      verdict: "WILL_NOT_PLACE",
      note: `"${city.toLowerCase()},${state.toLowerCase()}" absent from CITY_COORDS`,
    };
  }

  return {
    ...base,
    verdict: "WILL_NOT_PLACE",
    note: "city without state (or state without city) never resolves — lookupCity requires both",
  };
}

function printCoverage(): void {
  const zips = Object.keys(ZIP_COORDS).sort();
  const cities = Object.keys(CITY_COORDS).sort();
  console.log(`static ZIP_COORDS entries : ${zips.length}`);
  console.log(`static CITY_COORDS entries: ${cities.length}`);
  console.log("");
  console.log("ZIPs:");
  console.log(zips.join(" "));
  console.log("");
  console.log("city,state keys:");
  console.log(cities.join(" | "));
}

function main(): void {
  const arg = process.argv[2];

  if (!arg || arg === "--coverage") {
    printCoverage();
    if (!arg) {
      console.log("");
      console.log("Pass a candidates JSON file to check specific rows:");
      console.log("  npx tsx scripts/check-buyer-location-backfill.ts candidates.json");
    }
    return;
  }

  const candidates = JSON.parse(readFileSync(arg, "utf8")) as Candidate[];
  const results = candidates.map(evaluate);

  const w = {
    buyer: Math.max(8, ...results.map((r) => r.buyerId.length)),
    city: Math.max(4, ...results.map((r) => r.city.length)),
  };
  const pad = (s: string, n: number) => s.padEnd(n);

  console.log(
    `${pad("BUYER", w.buyer)}  ${pad("ZIP", 7)}  ${pad("CITY", w.city)}  ST  VERDICT             NOTE`,
  );
  for (const r of results) {
    console.log(
      `${pad(r.buyerId, w.buyer)}  ${pad(r.zip, 7)}  ${pad(r.city, w.city)}  ${pad(r.state, 2)}  ${pad(r.verdict, 18)}  ${r.note}`,
    );
  }

  const blocked = results.filter(
    (r) => r.verdict === "WILL_NOT_PLACE" || r.verdict === "NO_VALUE_SUPPLIED",
  );
  console.log("");
  console.log(`${results.length - blocked.length}/${results.length} would place.`);
  if (blocked.length > 0) {
    console.log(`${blocked.length} would NOT place — backfilling these does not fix their auction:`);
    for (const r of blocked) console.log(`  - ${r.buyerId}: ${r.note}`);
    process.exitCode = 1;
  }
}

main();
