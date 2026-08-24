// Batch 1 — inventory orchestrator truthfulness.
//
// Proves: (1) an unconfigured provider can NEVER report a successful/healthy sync;
// (2) a configured provider returning zero vehicles is ZERO_RESULTS, distinct from
// a failure; (3) runs persist truthful InventorySyncRun accounting; (4) provenance
// (sourceAdapter) is stamped on every ingested row; (5) duplicate-VIN input is
// deduplicated to a single upsert.
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/inventory/__tests__/orchestrator.test.ts

import test, { mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

interface Call { [k: string]: unknown }
const calls = {
  itemUpsert: [] as Call[],
  itemCreate: [] as Call[],
  syncRun: [] as Call[],
  sourceUpsert: [] as Call[],
};
let existingItem: unknown = null;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      dealer: {
        findMany: async () => [] as unknown[],
        findFirst: async () => null,
      },
      inventoryItem: {
        findFirst: async () => existingItem,
        upsert: async ({ where, create, update }: Call) => { calls.itemUpsert.push({ where, create, update }); return { id: "item_1" }; },
        create: async ({ data }: Call) => { calls.itemCreate.push({ data }); return { id: "item_2" }; },
        updateMany: async () => ({ count: 0 }),
      },
      inventorySource: {
        upsert: async ({ where }: Call) => { calls.sourceUpsert.push({ where }); return { id: "src_1" }; },
        update: async () => ({ id: "src_1" }),
      },
      inventorySyncRun: {
        create: async ({ data }: Call) => { calls.syncRun.push(data as Call); return { id: "run_1" }; },
      },
      notification: { create: async () => ({ id: "n_1" }) },
    },
  },
});

async function load() {
  return import("@/lib/services/inventory/orchestrator");
}

const origFetch = globalThis.fetch;
const origKey = process.env.MARKETCHECK_API_KEY;

beforeEach(() => {
  calls.itemUpsert = []; calls.itemCreate = []; calls.syncRun = []; calls.sourceUpsert = [];
  existingItem = null;
});
afterEach(() => {
  globalThis.fetch = origFetch;
  if (origKey === undefined) delete process.env.MARKETCHECK_API_KEY;
  else process.env.MARKETCHECK_API_KEY = origKey;
});

function mockFetchListings(listings: unknown[]) {
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ listings }),
  })) as unknown as typeof fetch;
}

test("MUST #1: unconfigured provider is NOT_CONFIGURED — never healthy, never ingests", async () => {
  delete process.env.MARKETCHECK_API_KEY;
  const { runInventorySync } = await load();

  const result = await runInventorySync({}, "full");

  assert.equal(result.outcome, "NOT_CONFIGURED");
  assert.equal(result.healthScore, null, "unconfigured run must have null health, never 100");
  assert.equal(result.configuredSources, 0);
  assert.equal(result.attemptedSources, 0);
  assert.equal(result.upserted, 0);
  assert.equal(calls.itemUpsert.length, 0, "nothing may be ingested");
  assert.equal(calls.itemCreate.length, 0);
  // A truthful sync run is still recorded, with the honest status.
  assert.equal(calls.syncRun.length, 1);
  assert.equal(calls.syncRun[0]!.status, "NOT_CONFIGURED");
  assert.equal(calls.syncRun[0]!.healthScore, null);
});

test("MUST #2: configured provider with zero listings is ZERO_RESULTS, not a failure", async () => {
  process.env.MARKETCHECK_API_KEY = "test-key";
  mockFetchListings([]);
  const { runInventorySync } = await load();

  const result = await runInventorySync({}, "full");

  assert.equal(result.outcome, "ZERO_RESULTS");
  assert.notEqual(result.outcome, "FAILED");
  assert.equal(result.configuredSources, 1);
  assert.equal(result.attemptedSources, 1);
  assert.equal(result.healthScore, 100, "a successful empty fetch is healthy — the integration works");
  assert.equal(calls.syncRun[0]!.status, "ZERO_RESULTS");
  assert.equal(calls.itemUpsert.length, 0);
});

test("MUST #3/#4: successful sync records truthful counts and stamps provenance", async () => {
  process.env.MARKETCHECK_API_KEY = "test-key";
  mockFetchListings([
    { vin: "1HGCM82633A004352", build: { year: 2021, make: "Honda", model: "Accord" }, price: 25000, miles: 30000, dealer: { name: "Foo Motors" } },
  ]);
  const { runInventorySync } = await load();

  const result = await runInventorySync({}, "full");

  assert.equal(result.outcome, "SUCCESS");
  assert.equal(result.healthScore, 100);
  assert.equal(result.upserted, 1);
  assert.equal(calls.itemUpsert.length, 1);
  const upsert = calls.itemUpsert[0]! as { create: Record<string, unknown> };
  assert.equal(upsert.create.sourceAdapter, "marketcheck", "provenance must be stamped");
  assert.ok(upsert.create.lastSeenAt instanceof Date, "freshness must be stamped");
  assert.equal(calls.syncRun[0]!.status, "COMPLETED");
  assert.equal(calls.syncRun[0]!.vehiclesFetched, 1);
  assert.equal(calls.syncRun[0]!.vehiclesUpserted, 1);
});

test("MUST #5: duplicate-VIN listings dedupe to a single ingested row", async () => {
  process.env.MARKETCHECK_API_KEY = "test-key";
  mockFetchListings([
    { vin: "1HGCM82633A004352", build: { year: 2021, make: "Honda", model: "Accord" }, price: 25000 },
    { vin: "1HGCM82633A004352", build: { year: 2021, make: "Honda", model: "Accord" }, price: 25500 },
  ]);
  const { runInventorySync } = await load();

  const result = await runInventorySync({}, "full");

  assert.equal(result.totalFetched, 2);
  assert.equal(result.totalAfterDedup, 1);
  assert.equal(calls.itemUpsert.length, 1, "same VIN must not create uncontrolled duplicate supply");
});
