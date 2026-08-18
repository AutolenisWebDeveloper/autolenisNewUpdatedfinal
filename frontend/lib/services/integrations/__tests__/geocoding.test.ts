// Y5 — geocoding adapter tests (Block A / A1).
//
// All external effects (static lookup, cache, Google) are injected, so this runs
// under test:integrations with no module mocks and never hits the network.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/integrations/__tests__/geocoding.test.ts

import test, { mock } from "node:test";
import assert from "node:assert/strict";
import {
  geocodeZip,
  parseGoogleGeocodeResponse,
  backfillCoordinates,
  type GeocodeDeps,
  type LatLng,
  type CoordRow,
} from "../geocoding.service";

const DALLAS: LatLng = { lat: 32.7767, lng: -96.797 };
const AUSTIN: LatLng = { lat: 30.2672, lng: -97.7431 };

// Typed mock factories so `.mock.calls[i].arguments` keeps its tuple shape.
const staticMock = (fn: (zip: string) => LatLng | null = () => null) =>
  mock.fn<(zip: string) => LatLng | null>(fn);
const cacheGetMock = (fn: (key: string) => Promise<LatLng | null> = async () => null) =>
  mock.fn<(key: string) => Promise<LatLng | null>>(fn);
const cacheSetMock = () => mock.fn<(key: string, val: LatLng) => Promise<void>>(async () => {});
const googleMock = (fn: (q: string) => Promise<LatLng | null> = async () => null) =>
  mock.fn<(q: string) => Promise<LatLng | null>>(fn);

// Build a full deps object from typed mocks (each test constructs the mocks it
// wants to assert on and passes them in, so the reference stays typed).
function deps(over: Partial<GeocodeDeps>): GeocodeDeps {
  return {
    staticLookup: staticMock(),
    cacheGet: cacheGetMock(),
    cacheSet: cacheSetMock(),
    googleGeocode: googleMock(),
    apiKeyPresent: () => true,
    ...over,
  };
}

// ─── static-first ────────────────────────────────────────────────────────────

test("a static ZIP hit returns source 'static' and never touches cache or Google", async () => {
  const cacheGet = cacheGetMock();
  const googleGeocode = googleMock();
  const r = await geocodeZip("75201", deps({ staticLookup: staticMock(() => DALLAS), cacheGet, googleGeocode }));
  assert.deepEqual(r, { ...DALLAS, source: "static" });
  assert.equal(cacheGet.mock.callCount(), 0);
  assert.equal(googleGeocode.mock.callCount(), 0);
});

// ─── cache before Google ─────────────────────────────────────────────────────

test("a cache hit (static miss) returns source 'cache' and never calls Google", async () => {
  const googleGeocode = googleMock();
  const r = await geocodeZip("78701", deps({ cacheGet: cacheGetMock(async () => AUSTIN), googleGeocode }));
  assert.deepEqual(r, { ...AUSTIN, source: "cache" });
  assert.equal(googleGeocode.mock.callCount(), 0);
});

// ─── Google path + cache write ───────────────────────────────────────────────

test("static+cache miss with key present calls Google, returns 'google', and writes cache", async () => {
  const cacheSet = cacheSetMock();
  const r = await geocodeZip("75201", deps({ googleGeocode: googleMock(async () => DALLAS), cacheSet }));
  assert.deepEqual(r, { ...DALLAS, source: "google" });
  assert.equal(cacheSet.mock.callCount(), 1);
  assert.deepEqual(cacheSet.mock.calls[0].arguments[1], DALLAS);
});

// ─── fail-closed: no API key ─────────────────────────────────────────────────

test("no API key fails closed — returns null, never calls Google, never writes cache", async () => {
  const cacheSet = cacheSetMock();
  const googleGeocode = googleMock();
  const r = await geocodeZip("99999", deps({ apiKeyPresent: () => false, cacheSet, googleGeocode }));
  assert.equal(r, null);
  assert.equal(googleGeocode.mock.callCount(), 0);
  assert.equal(cacheSet.mock.callCount(), 0);
});

// ─── Google miss (ZERO_RESULTS) ──────────────────────────────────────────────

test("Google returning null yields null and does not write cache", async () => {
  const cacheSet = cacheSetMock();
  const r = await geocodeZip("00000", deps({ googleGeocode: googleMock(async () => null), cacheSet }));
  assert.equal(r, null);
  assert.equal(cacheSet.mock.callCount(), 0);
});

// ─── fail-closed: Google throws / times out ──────────────────────────────────

test("Google throwing fails closed — returns null, no throw, no cache write", async () => {
  const cacheSet = cacheSetMock();
  const r = await geocodeZip(
    "75201",
    deps({
      googleGeocode: googleMock(async () => {
        throw new Error("network timeout");
      }),
      cacheSet,
    }),
  );
  assert.equal(r, null);
  assert.equal(cacheSet.mock.callCount(), 0);
});

// ─── blank input ─────────────────────────────────────────────────────────────

test("a blank ZIP returns null and calls nothing", async () => {
  const staticLookup = staticMock(() => DALLAS);
  const r = await geocodeZip("   ", deps({ staticLookup }));
  assert.equal(r, null);
  assert.equal(staticLookup.mock.callCount(), 0);
});

// ─── ZIP+4 normalization ─────────────────────────────────────────────────────

test("a ZIP+4 is normalized to the 5-digit ZIP before lookup", async () => {
  const staticLookup = staticMock(() => DALLAS);
  const r = await geocodeZip("75201-1234", deps({ staticLookup }));
  assert.deepEqual(r, { ...DALLAS, source: "static" });
  assert.equal(staticLookup.mock.calls[0].arguments[0], "75201");
});

// ─── parseGoogleGeocodeResponse (pure) ───────────────────────────────────────

test("parseGoogleGeocodeResponse extracts lat/lng from an OK response", () => {
  const json = {
    status: "OK",
    results: [{ geometry: { location: { lat: 32.7767, lng: -96.797 } } }],
  };
  assert.deepEqual(parseGoogleGeocodeResponse(json), DALLAS);
});

test("parseGoogleGeocodeResponse returns null for ZERO_RESULTS / errors / malformed", () => {
  assert.equal(parseGoogleGeocodeResponse({ status: "ZERO_RESULTS", results: [] }), null);
  assert.equal(parseGoogleGeocodeResponse({ status: "OVER_QUERY_LIMIT" }), null);
  assert.equal(parseGoogleGeocodeResponse({ status: "OK", results: [{}] }), null);
  assert.equal(parseGoogleGeocodeResponse(null), null);
  assert.equal(parseGoogleGeocodeResponse("nope"), null);
});

// ─── backfill ────────────────────────────────────────────────────────────────

function backfillDeps(dealers: CoordRow[], prospects: CoordRow[], geocode: (zip: string) => Promise<LatLng | null>) {
  const dealerUpdates: Array<{ id: string; c: LatLng }> = [];
  const prospectUpdates: Array<{ id: string; c: LatLng }> = [];
  const d = {
    loadDealers: async () => dealers,
    loadProspects: async () => prospects,
    updateDealer: async (id: string, c: LatLng) => {
      dealerUpdates.push({ id, c });
    },
    updateProspect: async (id: string, c: LatLng) => {
      prospectUpdates.push({ id, c });
    },
    geocode,
  };
  return { deps: d, dealerUpdates, prospectUpdates };
}

test("backfill geocodes only rows with a ZIP and updates their coordinates", async () => {
  const { deps: d, dealerUpdates } = backfillDeps(
    [
      { id: "d1", zip: "75201" },
      { id: "d2", zip: null }, // no zip → skipped, never geocoded
    ],
    [],
    async (zip) => (zip === "75201" ? DALLAS : null),
  );
  const r = await backfillCoordinates(d);
  assert.equal(dealerUpdates.length, 1);
  assert.deepEqual(dealerUpdates[0], { id: "d1", c: DALLAS });
  assert.equal(r.dealers.geocoded, 1);
  assert.equal(r.dealers.skipped, 1);
  assert.equal(r.dealers.scanned, 2);
});

test("backfill isolates a failing update — the row is skipped and the batch continues", async () => {
  // updateDealer throws for the first row (e.g. deleted/merged between select and
  // update → Prisma P2025); the second row must still be geocoded + updated.
  const updated: string[] = [];
  const d = {
    loadDealers: async (): Promise<CoordRow[]> => [
      { id: "d_throws", zip: "75201" },
      { id: "d_ok", zip: "78701" },
    ],
    loadProspects: async (): Promise<CoordRow[]> => [],
    updateDealer: async (id: string) => {
      if (id === "d_throws") throw new Error("P2025: record not found");
      updated.push(id);
    },
    updateProspect: async () => {},
    geocode: async (zip: string): Promise<LatLng | null> => (zip === "75201" ? DALLAS : AUSTIN),
  };
  const r = await backfillCoordinates(d);
  assert.deepEqual(updated, ["d_ok"]);
  assert.equal(r.dealers.geocoded, 1);
  assert.equal(r.dealers.skipped, 1); // the throwing row counted skipped, not fatal
  assert.equal(r.dealers.scanned, 2);
});

test("backfill leaves a row unchanged when geocoding returns null, and continues the batch", async () => {
  const { deps: d, prospectUpdates } = backfillDeps(
    [],
    [
      { id: "p_bad", zip: "00000" }, // geocode → null
      { id: "p_ok", zip: "78701" },
    ],
    async (zip) => (zip === "78701" ? AUSTIN : null),
  );
  const r = await backfillCoordinates(d);
  assert.equal(prospectUpdates.length, 1);
  assert.equal(prospectUpdates[0].id, "p_ok");
  assert.equal(r.prospects.geocoded, 1);
  assert.equal(r.prospects.skipped, 1);
});
