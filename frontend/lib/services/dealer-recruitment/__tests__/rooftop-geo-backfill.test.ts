// Task 10 — backfill dealer_rooftops.latitude/longitude.
//
// WHY A ROOFTOP BACKFILL WHEN ONE ALREADY EXISTS. geocoding.service already
// backfills Dealer and DealerProspect coordinates from ZIP, driven by a cron.
// It does NOT touch dealer_rooftops, which has 0/1,389 coordinates. Prospects
// are meant to read geo THROUGH their rooftop rather than carrying a private
// copy, so the rooftop is the row that needs coordinates. The existing cron is
// left exactly as it is — it serves other callers.
//
// TWO SOURCES, STRONGEST FIRST:
//   dealer_intelligence  437 rows at 100% lat/lng, matched on name+city+state.
//                        A real observed location for a specific dealership.
//   zip centroid         the remainder. 1,389/1,389 rooftops have a ZIP, but a
//                        centroid is the middle of a postal area, not the store.
//
// The two are NOT equivalent and the source is recorded on every write, because
// a consumer computing "nearest dealer" needs to know whether a coordinate is a
// real location or a postal approximation.
//
// PLAN AND APPLY ARE SEPARATE CALLS. This runs against production data the owner
// has not authorised writing to, so producing the plan must be inert.

import test from "node:test";
import assert from "node:assert/strict";

import {
  planRooftopGeoBackfill,
  applyRooftopGeoBackfill,
  type RooftopGeoDeps,
  type RooftopRow,
  type IntelligenceRow,
} from "../rooftop-geo-backfill.service";

function rooftop(over: Partial<RooftopRow> = {}): RooftopRow {
  return {
    id: "rt1",
    displayName: "Round Rock Toyota",
    city: "Austin",
    state: "TX",
    zip: "78701",
    latitude: null,
    longitude: null,
    ...over,
  };
}

function intel(over: Partial<IntelligenceRow> = {}): IntelligenceRow {
  return {
    dealerName: "Round Rock Toyota",
    city: "Austin",
    state: "TX",
    latitude: 30.5083,
    longitude: -97.6789,
    ...over,
  };
}

interface Harness {
  deps: Partial<RooftopGeoDeps>;
  writes: () => { id: string; lat: number; lng: number; source: string }[];
  zipLookups: () => string[];
}

function harness(opts: {
  rooftops?: RooftopRow[];
  intelligence?: IntelligenceRow[];
  zip?: Record<string, { lat: number; lng: number }>;
  writeThrowsFor?: string;
} = {}): Harness {
  const writes: { id: string; lat: number; lng: number; source: string }[] = [];
  const zipLookups: string[] = [];
  return {
    writes: () => writes,
    zipLookups: () => zipLookups,
    deps: {
      loadRooftops: async () => opts.rooftops ?? [rooftop()],
      loadIntelligence: async () => opts.intelligence ?? [],
      geocodeZip: async (zip: string) => {
        zipLookups.push(zip);
        return opts.zip?.[zip] ?? null;
      },
      writeRooftopCoords: async (id, lat, lng, source) => {
        if (opts.writeThrowsFor === id) throw new Error("write failed");
        writes.push({ id, lat, lng, source });
      },
    },
  };
}

// ─── source precedence ──────────────────────────────────────────────────────

test("dealer_intelligence is preferred over a zip centroid", async () => {
  const h = harness({ intelligence: [intel()], zip: { "78701": { lat: 1, lng: 2 } } });
  const plan = await planRooftopGeoBackfill(h.deps);
  assert.equal(plan.entries.length, 1);
  assert.equal(plan.entries[0].source, "dealer_intelligence");
  assert.equal(plan.entries[0].latitude, 30.5083);
  assert.equal(h.zipLookups().length, 0, "the zip tier must not be consulted once intelligence matched");
});

test("the zip centroid is the fallback for the remainder", async () => {
  const h = harness({ intelligence: [], zip: { "78701": { lat: 30.26, lng: -97.74 } } });
  const plan = await planRooftopGeoBackfill(h.deps);
  assert.equal(plan.entries[0].source, "zip_centroid");
  assert.equal(plan.entries[0].latitude, 30.26);
});

test("matching is case- and suffix-insensitive via the shared name normalizer", async () => {
  // dealer_intelligence and dealer_rooftops are populated by different paths, so
  // "Round Rock Toyota, LLC" must match "round rock toyota".
  const h = harness({
    rooftops: [rooftop({ displayName: "Round Rock Toyota, LLC" })],
    intelligence: [intel({ dealerName: "ROUND ROCK TOYOTA" })],
  });
  const plan = await planRooftopGeoBackfill(h.deps);
  assert.equal(plan.entries[0].source, "dealer_intelligence");
});

test("a same-name dealership in a DIFFERENT city does not match", async () => {
  const h = harness({
    rooftops: [rooftop({ city: "Dallas" })],
    intelligence: [intel({ city: "Austin" })],
    zip: { "78701": { lat: 1, lng: 2 } },
  });
  const plan = await planRooftopGeoBackfill(h.deps);
  assert.equal(plan.entries[0].source, "zip_centroid", "name alone must not match across cities");
});

test("intelligence with null coordinates is ignored rather than written as null", async () => {
  const h = harness({
    intelligence: [intel({ latitude: null, longitude: null })],
    zip: { "78701": { lat: 30.26, lng: -97.74 } },
  });
  const plan = await planRooftopGeoBackfill(h.deps);
  assert.equal(plan.entries[0].source, "zip_centroid");
});

// ─── what is skipped ────────────────────────────────────────────────────────

test("a rooftop that already has coordinates is left alone", async () => {
  const h = harness({
    rooftops: [rooftop({ latitude: 1, longitude: 2 })],
    intelligence: [intel()],
  });
  const plan = await planRooftopGeoBackfill(h.deps);
  assert.equal(plan.entries.length, 0);
  assert.equal(plan.counts.alreadyHasCoords, 1);
});

test("a rooftop with no zip and no intelligence match is reported unresolved", async () => {
  const h = harness({ rooftops: [rooftop({ zip: null })], intelligence: [] });
  const plan = await planRooftopGeoBackfill(h.deps);
  assert.equal(plan.entries.length, 0);
  assert.equal(plan.counts.unresolved, 1);
});

test("a zip the centroid table does not know is unresolved, not guessed", async () => {
  const h = harness({ rooftops: [rooftop({ zip: "99999" })], zip: {} });
  const plan = await planRooftopGeoBackfill(h.deps);
  assert.equal(plan.counts.unresolved, 1);
  assert.equal(plan.entries.length, 0);
});

// ─── plan is inert ──────────────────────────────────────────────────────────

test("planning writes NOTHING — it runs against data nobody authorised changing", async () => {
  const h = harness({ intelligence: [intel()] });
  await planRooftopGeoBackfill(h.deps);
  assert.equal(h.writes().length, 0);
});

test("apply writes only what the plan contains", async () => {
  const h = harness({ intelligence: [intel()] });
  const plan = await planRooftopGeoBackfill(h.deps);
  const result = await applyRooftopGeoBackfill(plan, h.deps);
  assert.equal(h.writes().length, 1);
  assert.deepEqual(h.writes()[0], { id: "rt1", lat: 30.5083, lng: -97.6789, source: "dealer_intelligence" });
  assert.equal(result.written, 1);
});

test("coordinates go to the ROOFTOP and never onto the prospect", async () => {
  // Prospects read geo through the rooftop. A private copy on the prospect is a
  // second truth that drifts the moment either is corrected.
  const h = harness({ intelligence: [intel()] });
  assert.equal(typeof (h.deps as Record<string, unknown>).writeProspectCoords, "undefined",
    "there must be no prospect-writing dependency at all");
  const plan = await planRooftopGeoBackfill(h.deps);
  await applyRooftopGeoBackfill(plan, h.deps);
  assert.ok(h.writes().every((w) => w.id.startsWith("rt")));
});

test("the source is recorded on every write — a centroid is not a real location", async () => {
  const h = harness({
    rooftops: [rooftop({ id: "rt1" }), rooftop({ id: "rt2", displayName: "Other Motors", zip: "78702" })],
    intelligence: [intel()],
    zip: { "78702": { lat: 30.26, lng: -97.71 } },
  });
  const plan = await planRooftopGeoBackfill(h.deps);
  await applyRooftopGeoBackfill(plan, h.deps);
  assert.deepEqual(h.writes().map((w) => w.source).sort(), ["dealer_intelligence", "zip_centroid"]);
});

test("one failed write does not abort the batch", async () => {
  const h = harness({
    rooftops: [rooftop({ id: "rt1" }), rooftop({ id: "rt2", displayName: "Other Motors" })],
    intelligence: [intel(), intel({ dealerName: "Other Motors" })],
    writeThrowsFor: "rt1",
  });
  const plan = await planRooftopGeoBackfill(h.deps);
  const result = await applyRooftopGeoBackfill(plan, h.deps);
  assert.equal(result.written, 1);
  assert.equal(result.failed, 1);
});

test("the plan counts every rooftop it considered, so nothing is silently dropped", async () => {
  const h = harness({
    rooftops: [
      rooftop({ id: "a" }),
      rooftop({ id: "b", latitude: 1, longitude: 2 }),
      rooftop({ id: "c", zip: null }),
    ],
    intelligence: [intel()],
  });
  const plan = await planRooftopGeoBackfill(h.deps);
  const { fromIntelligence, fromZipCentroid, alreadyHasCoords, unresolved, scanned } = plan.counts;
  assert.equal(scanned, 3);
  assert.equal(fromIntelligence + fromZipCentroid + alreadyHasCoords + unresolved, scanned);
});
