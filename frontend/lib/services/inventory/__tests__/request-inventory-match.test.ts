// Batch 1 — canonical request→inventory matching.
// Proves: (7) valid request + eligible inventory persists canonical results;
// (8) re-run is idempotent (upsert, never duplicate); (9) zero eligible supply and
// zero matches are truthful, distinct, non-failure results; (10) an execution
// failure THROWS and never masquerades as zero matches; terminal requests are skipped.
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/inventory/__tests__/request-inventory-match.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

let request: Record<string, unknown> | null;
let eligibleCount: number | (() => number);
let candidates: Array<Record<string, unknown>>;
const calls = { upsert: [] as Record<string, unknown>[], deleteMany: [] as Record<string, unknown>[] };

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      vehicleRequest: {
        findUnique: async () => request,
        findMany: async () => [] as unknown[],
      },
      inventoryItem: {
        count: async () => (typeof eligibleCount === "function" ? eligibleCount() : eligibleCount),
        findMany: async () => candidates,
      },
      vehicleRequestMatchResult: {
        upsert: async (args: Record<string, unknown>) => { calls.upsert.push(args); return { id: "vrmr" }; },
        deleteMany: async (args: Record<string, unknown>) => { calls.deleteMany.push(args); return { count: 0 }; },
      },
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    },
  },
});

async function load() {
  return import("@/lib/services/inventory/request-inventory-match.service");
}

const NOW = new Date("2026-08-24T00:00:00Z");

beforeEach(() => {
  request = { id: "req_1", status: "SUBMITTED", makePreference: "Toyota", modelPreference: "Camry", yearMin: 2020, yearMax: 2024, maxBudgetCents: 3_000_000 };
  eligibleCount = 0;
  candidates = [];
  calls.upsert = []; calls.deleteMany = [];
});

test("MUST #7: valid request + eligible inventory persists canonical match results", async () => {
  eligibleCount = 3;
  candidates = [
    { id: "i_a", make: "Toyota", model: "Camry", year: 2022, priceCents: 2_700_000, lane: "LANE_1" },
    { id: "i_b", make: "Toyota", model: "Camry SE", year: 2021, priceCents: 2_500_000, lane: "LANE_3" },
  ];
  const { matchInventoryForRequest } = await load();

  const res = await matchInventoryForRequest("req_1", NOW);

  assert.equal(res.outcome, "MATCHED");
  assert.equal(res.persisted, 2);
  assert.equal(calls.upsert.length, 2);
  // Rows carry a score and provenance source (lane).
  const first = calls.upsert[0]! as { create: Record<string, unknown> };
  assert.equal(typeof first.create.matchScore, "number");
  assert.ok(["LANE_1", "LANE_3"].includes(String(first.create.source)));
  // LANE_1 dealer-owned inventory ranks first.
  assert.equal((calls.upsert[0]! as { create: Record<string, unknown> }).create.inventoryItemId, "i_a");
});

test("MUST #8: re-running is idempotent — upsert (never create), stale rows pruned", async () => {
  eligibleCount = 2;
  candidates = [{ id: "i_a", make: "Toyota", model: "Camry", year: 2022, priceCents: 2_700_000, lane: "LANE_1" }];
  const { matchInventoryForRequest } = await load();

  await matchInventoryForRequest("req_1", NOW);
  const firstKeys = calls.upsert.map((c) => JSON.stringify((c as { where: unknown }).where));
  calls.upsert = []; calls.deleteMany = [];
  await matchInventoryForRequest("req_1", NOW);
  const secondKeys = calls.upsert.map((c) => JSON.stringify((c as { where: unknown }).where));

  assert.deepEqual(firstKeys, secondKeys, "same inputs → same upsert keys (idempotent)");
  // Stale-pruning delete scoped to rows NOT in the matched set.
  assert.equal(calls.deleteMany.length, 1);
  const del = calls.deleteMany[0]! as { where: { inventoryItemId?: { notIn: string[] } } };
  assert.deepEqual(del.where.inventoryItemId?.notIn, ["i_a"]);
});

test("MUST #9a: no executable supply at all → NO_ELIGIBLE_SUPPLY (not a failure)", async () => {
  eligibleCount = 0;
  const { matchInventoryForRequest } = await load();
  const res = await matchInventoryForRequest("req_1", NOW);
  assert.equal(res.outcome, "NO_ELIGIBLE_SUPPLY");
  assert.equal(res.persisted, 0);
  // Prior results for the request are cleared.
  assert.equal(calls.deleteMany.length, 1);
  assert.deepEqual(calls.deleteMany[0]!.where, { requestId: "req_1" });
});

test("MUST #9b: supply exists but none fits the request → ZERO_MATCHES", async () => {
  eligibleCount = 5;
  candidates = []; // none satisfy the criteria
  const { matchInventoryForRequest } = await load();
  const res = await matchInventoryForRequest("req_1", NOW);
  assert.equal(res.outcome, "ZERO_MATCHES");
  assert.equal(res.eligibleSupply, 5);
  assert.equal(res.persisted, 0);
});

test("MUST #10: execution failure THROWS — never masquerades as zero matches", async () => {
  eligibleCount = () => { throw new Error("db exploded"); };
  const { matchInventoryForRequest } = await load();
  await assert.rejects(() => matchInventoryForRequest("req_1", NOW), /db exploded/);
  assert.equal(calls.upsert.length, 0);
});

test("terminal request is skipped without touching inventory", async () => {
  request = { id: "req_1", status: "DEAL_CREATED", makePreference: null, modelPreference: null, yearMin: null, yearMax: null, maxBudgetCents: null };
  const { matchInventoryForRequest } = await load();
  const res = await matchInventoryForRequest("req_1", NOW);
  assert.equal(res.outcome, "SKIPPED_TERMINAL");
  assert.equal(calls.upsert.length, 0);
  assert.equal(calls.deleteMany.length, 0);
});

test("unknown request throws (caller error, not zero matches)", async () => {
  request = null;
  const { matchInventoryForRequest } = await load();
  await assert.rejects(() => matchInventoryForRequest("nope", NOW), /not found/);
});
