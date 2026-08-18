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

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      auction: {
        findUnique: async () => ({ endsAt: new Date(), buyerId: "b1", buyer: { zip: "75201", city: "Dallas", state: "TX" } }),
      },
      auctionVehicle: {
        findFirst: async () => existingVehicle,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return data;
        },
      },
      vehicleRequest: { findFirst: async () => vehicleReq },
      // No registered dealers → the invite short-circuits after the ladder with an
      // empty field (so the notification/resend/ghl/qstash loop never runs). This
      // keeps the integration test focused on the ladder wiring.
      dealer: { findMany: async () => [], updateMany: async () => ({ count: 0 }) },
    },
  },
});

mock.module("@/lib/services/integrations/geocoding.service", {
  namedExports: { geocodeZip: async () => ({ lat: 32.7767, lng: -96.797, source: "static" }) },
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
