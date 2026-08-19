// A4 — Y4 make-match bonus (pure) + ensureAuctionVehicleFromRequest (make signal).
// Runs under base `test` (--experimental-test-module-mocks). prisma is mocked so
// no DB is touched; the module is imported lazily after the mock is registered.
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/auction/__tests__/dealer-invitation.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

let existingVehicle: { make: string | null; model: string | null; year: number | null } | null = null;
let vehicleReq: { makePreference: string | null; modelPreference: string | null; yearMin: number | null } | null = null;
const created: Array<Record<string, unknown>> = [];
let ladderOpts: { includeProspects?: boolean; stopWhen?: (c: { registered: number }) => boolean } | undefined;

// Data-driven fixtures so a test can drive the WHOLE service path (not just the
// pure helpers): the buyer's location, the active-dealer roster, and what the
// geocoder resolves are all mutable and reset per test.
type DealerRow = { id: string; zip: string | null; latitude: number | null; longitude: number | null };
let buyerRow: { zip: string | null; city: string | null; state: string | null } = { zip: "75201", city: "Dallas", state: "TX" };
let dealerRows: DealerRow[] = [];
let geocodeZipImpl: (zip: string) => Promise<{ lat: number; lng: number; source: string } | null> =
  async () => ({ lat: 32.7767, lng: -96.797, source: "static" });
const invitedIds: string[] = []; // dealerIds that reached auctionInvitation.upsert
const loadIncremented: string[][] = []; // dealer.updateMany id lists (load increment)

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      auction: {
        findUnique: async () => ({ endsAt: new Date(), buyerId: "b1", buyer: buyerRow }),
      },
      auctionVehicle: {
        findFirst: async () => existingVehicle,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return data;
        },
      },
      vehicleRequest: { findFirst: async () => vehicleReq },
      dealer: {
        findMany: async () => dealerRows,
        // Scorable ACTIVE dealer for scoreDealerForAuction; no user email so the
        // notify loop skips email/qstash (syncGhlTag is mocked out below).
        findUnique: async () => ({
          status: "ACTIVE",
          tier: "STANDARD",
          currentAuctionLoad: 0,
          scorecardSnapshots: [],
          dealershipName: "Test Dealer",
          user: null,
        }),
        updateMany: async ({ where }: { where: { id: { in: string[] } } }) => {
          loadIncremented.push(where.id.in);
          return { count: where.id.in.length };
        },
      },
      auctionInvitation: {
        upsert: async ({ create }: { create: { dealerId: string } }) => {
          invitedIds.push(create.dealerId);
          return create;
        },
      },
      notification: { create: async () => ({}) },
    },
  },
});

mock.module("@/lib/services/integrations/geocoding.service", {
  namedExports: { geocodeZip: (zip: string) => geocodeZipImpl(zip) },
});

// Keep the notify loop network-free (only reached when a dealer is invited).
mock.module("@/lib/services/ghl/tag-sync", {
  namedExports: { syncGhlTag: () => {} },
});

mock.module("@/lib/services/auction/coverage.service", {
  namedExports: {
    selectCoverageRadius: async (_id: string, opts: typeof ladderOpts) => {
      ladderOpts = opts;
      return { coverage: 0, registered: 0, prospects: 0, radiusMiles: 50, buyerGeocoded: true };
    },
  },
});

async function load() {
  return import("../dealer-invitation.service");
}

beforeEach(() => {
  existingVehicle = null;
  vehicleReq = null;
  created.length = 0;
  ladderOpts = undefined;
  buyerRow = { zip: "75201", city: "Dallas", state: "TX" };
  dealerRows = [];
  geocodeZipImpl = async () => ({ lat: 32.7767, lng: -96.797, source: "static" });
  invitedIds.length = 0;
  loadIncremented.length = 0;
});

// ─── makeMatchBonus (pure) — bonus, never a gate ─────────────────────────────

test("makeMatchBonus rewards a make intersection (case-insensitive), positively", async () => {
  const { makeMatchBonus } = await load();
  assert.ok(makeMatchBonus(["Toyota", "Lexus"], ["toyota"]) > 0);
  assert.ok(makeMatchBonus(["honda"], ["Honda", "Acura"]) > 0);
});

test("makeMatchBonus is 0 (never negative) when there is no match or no auction make", async () => {
  const { makeMatchBonus } = await load();
  assert.equal(makeMatchBonus(["Toyota"], ["Ford"]), 0); // non-match → 0, NOT a penalty
  assert.equal(makeMatchBonus(["Toyota"], []), 0); // no auction make → neutral
  assert.equal(makeMatchBonus([], ["Toyota"]), 0); // dealer declares nothing → neutral
});

// ─── pickNearbyDealers (pure) — FAIL CLOSED geo-filter ───────────────────────

test("pickNearbyDealers returns [] when the buyer has no coordinates (never invite everyone)", async () => {
  const { pickNearbyDealers } = await load();
  const entries = [
    { dealer: { id: "d1" }, coords: { lat: 32.85, lng: -96.797 } },
    { dealer: { id: "d2" }, coords: null },
  ];
  // Fail closed: no buyer coords → NO invites, never the whole active roster.
  assert.deepEqual(pickNearbyDealers(entries, null, 50), []);
});

test("pickNearbyDealers EXCLUDES a dealer with no resolvable coordinates", async () => {
  const { pickNearbyDealers } = await load();
  const buyer = { lat: 32.7767, lng: -96.797 }; // Dallas
  const entries = [
    { dealer: { id: "near" }, coords: { lat: 32.85, lng: -96.797 } }, // ~5 mi
    { dealer: { id: "coordless" }, coords: null }, // can't be placed → excluded
  ];
  const kept = pickNearbyDealers(entries, buyer, 50).map((e) => e.dealer.id);
  assert.deepEqual(kept, ["near"]);
});

test("pickNearbyDealers keeps in-radius dealers and drops out-of-radius ones", async () => {
  const { pickNearbyDealers } = await load();
  const buyer = { lat: 32.7767, lng: -96.797 }; // Dallas
  const entries = [
    { dealer: { id: "near" }, coords: { lat: 32.85, lng: -96.797 } }, // ~5 mi → in
    { dealer: { id: "far" }, coords: { lat: 35.78, lng: -96.797 } }, // ~207 mi → out
  ];
  const kept = pickNearbyDealers(entries, buyer, 50).map((e) => e.dealer.id);
  assert.deepEqual(kept, ["near"]);
});

// ─── ensureAuctionVehicleFromRequest ─────────────────────────────────────────

test("uses an existing AuctionVehicle as-is and never creates a second (idempotent)", async () => {
  existingVehicle = { make: "Toyota", model: "Camry", year: 2022 };
  const { ensureAuctionVehicleFromRequest } = await load();
  const r = await ensureAuctionVehicleFromRequest("a1", "b1");
  assert.deepEqual(r.makes, ["Toyota"]);
  assert.deepEqual(r.primary, { make: "Toyota", model: "Camry", year: 2022 });
  assert.equal(created.length, 0); // did not overwrite / duplicate
});

test("creates an AuctionVehicle from the latest VehicleRequest make preference", async () => {
  vehicleReq = { makePreference: "Honda", modelPreference: "Accord", yearMin: 2021 };
  const { ensureAuctionVehicleFromRequest } = await load();
  const r = await ensureAuctionVehicleFromRequest("a1", "b1");
  assert.deepEqual(r.makes, ["Honda"]);
  assert.equal(created.length, 1);
  assert.equal(created[0].make, "Honda");
  assert.equal(created[0].auctionId, "a1");
});

test("degrades to no make signal when there is no request or no make preference", async () => {
  vehicleReq = { makePreference: null, modelPreference: null, yearMin: null };
  const { ensureAuctionVehicleFromRequest } = await load();
  const r = await ensureAuctionVehicleFromRequest("a1", "b1");
  assert.deepEqual(r.makes, []);
  assert.equal(r.primary, null);
  assert.equal(created.length, 0); // no vehicle created → invite proceeds make-agnostic
});

// ─── integration: invite path wires the ladder correctly ─────────────────────

test("inviteDealersToAuction targets the invite CAP (not the soft-hold floor) and skips prospect resolution", async () => {
  existingVehicle = { make: "Toyota", model: "Camry", year: 2022 };
  const { inviteDealersToAuction } = await load();
  const count = await inviteDealersToAuction("a1", "b1");
  assert.equal(count, 0); // no registered dealers seeded
  // The ladder was driven with the registered-only, cap-targeting predicate:
  assert.equal(ladderOpts?.includeProspects, false);
  assert.ok(ladderOpts?.stopWhen, "stopWhen must be provided");
  // Targets the invite cap (8), NOT the soft-hold floor (3): 8 stops, 3 keeps going.
  assert.equal(ladderOpts!.stopWhen!({ registered: 8 }), true);
  assert.equal(ladderOpts!.stopWhen!({ registered: 3 }), false);
});

// ─── integration: FAIL CLOSED through the whole service (not just the helper) ──

test("inviteDealersToAuction invites ZERO when the buyer is unplaceable (never the whole roster)", async () => {
  // Buyer has no ZIP and a city/state absent from the static tables → buyerCoords null.
  buyerRow = { zip: null, city: "Nowhereville", state: "ZZ" };
  // A perfectly scorable, coordinate-bearing dealer that a fail-OPEN regression
  // would happily invite. Fail-closed must still invite no one.
  dealerRows = [{ id: "near", zip: null, latitude: 32.85, longitude: -96.79 }];
  const { inviteDealersToAuction } = await load();
  const count = await inviteDealersToAuction("a1", "b1");
  assert.equal(count, 0);
  assert.deepEqual(invitedIds, []); // no invitation rows written
  assert.deepEqual(loadIncremented, []); // no dealer load incremented
});

test("inviteDealersToAuction EXCLUDES a coordless dealer through the real path (city-only buyer)", async () => {
  // City-only buyer → placeable via static CITY_COORDS (Dallas), radius = MAX_DISTANCE_MILES.
  buyerRow = { zip: null, city: "Dallas", state: "TX" };
  // Every ZIP geocode misses → a coordless dealer cannot be placed and must drop.
  geocodeZipImpl = async () => null;
  dealerRows = [
    { id: "hascoords", zip: null, latitude: 32.85, longitude: -96.79 }, // ~5mi → invited
    { id: "coordless", zip: "75201", latitude: null, longitude: null }, // unplaceable → excluded
  ];
  const { inviteDealersToAuction } = await load();
  const count = await inviteDealersToAuction("a1", "b1");
  assert.equal(count, 1);
  assert.deepEqual(invitedIds, ["hascoords"]); // the coordless dealer never got in
});
