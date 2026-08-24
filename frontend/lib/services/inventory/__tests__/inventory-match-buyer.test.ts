// Batch 1 — buyer-facing matcher (findMatchedVehicles) wiring.
// Proves the previously-dead VehicleMatchScore model now has a real, exercised
// writer: eligible supply is scored and the buyer-scoped score is upserted.
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/inventory/__tests__/inventory-match-buyer.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

let buyer: Record<string, unknown> | null;
let pref: Record<string, unknown> | null;
let items: Array<Record<string, unknown>>;
const calls = { findMany: [] as Record<string, unknown>[], scoreUpsert: [] as Record<string, unknown>[] };

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      buyer: { findUnique: async () => buyer },
      buyerInventoryPreference: { findUnique: async () => pref },
      inventoryItem: {
        findMany: async (args: Record<string, unknown>) => { calls.findMany.push(args); return items; },
      },
      vehicleMatchScore: {
        upsert: async (a: Record<string, unknown>) => { calls.scoreUpsert.push(a); return { id: "vms" }; },
      },
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    },
  },
});

async function load() {
  return import("@/lib/services/inventory/inventory-match.service");
}

const NOW = new Date("2026-08-24T00:00:00Z");

beforeEach(() => {
  buyer = { id: "b1", preQualification: { maxOtdAmountCents: 3_000_000 } };
  pref = { buyerId: "b1", preferredMakes: ["Toyota"] };
  items = [
    { id: "i_a", year: 2022, make: "Toyota", model: "Camry", priceCents: 2_700_000, lane: "LANE_1", images: [] },
    { id: "i_b", year: 2021, make: "Toyota", model: "Corolla", priceCents: 2_200_000, lane: "LANE_3", images: [] },
  ];
  calls.findMany = []; calls.scoreUpsert = [];
});

test("returns ranked eligible matches and persists a VehicleMatchScore per item", async () => {
  const { findMatchedVehicles } = await load();
  const result = await findMatchedVehicles("b1", 12, NOW);

  assert.equal(result.length, 2);
  assert.ok(typeof result[0]!.matchScore === "number");
  // LANE_1 outranks LANE_3 on equal criteria.
  assert.equal(result[0]!.id, "i_a");
  // The dead model now has a real writer, one upsert per ranked item, keyed by buyer+item.
  assert.equal(calls.scoreUpsert.length, 2);
  const w = calls.scoreUpsert[0]! as { where: { buyerId_inventoryItemId: { buyerId: string } }; create: Record<string, unknown> };
  assert.equal(w.where.buyerId_inventoryItemId.buyerId, "b1");
  assert.equal(typeof w.create.score, "number");
  assert.ok(w.create.factors && typeof w.create.factors === "object");
});

test("filters to executable supply (eligibility where-fragment is applied)", async () => {
  const { findMatchedVehicles } = await load();
  await findMatchedVehicles("b1", 12, NOW);
  // The query must AND the executable-supply fragment with buyer criteria.
  const where = (calls.findMany[0]! as { where: { AND?: unknown[] } }).where;
  assert.ok(Array.isArray(where.AND), "eligibility fragment must be AND-composed");
});

test("no eligible items → empty result, no score writes", async () => {
  items = [];
  const { findMatchedVehicles } = await load();
  const result = await findMatchedVehicles("b1", 12, NOW);
  assert.equal(result.length, 0);
  assert.equal(calls.scoreUpsert.length, 0);
});

test("buyer with no preference or prequal still runs (unconstrained candidates)", async () => {
  buyer = { id: "b1", preQualification: null };
  pref = null;
  const { findMatchedVehicles } = await load();
  const result = await findMatchedVehicles("b1", 12, NOW);
  assert.equal(result.length, 2);
});
