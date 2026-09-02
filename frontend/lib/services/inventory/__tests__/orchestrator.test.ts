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
  sourceUpdate: [] as Call[],
  itemUpdateMany: [] as Call[],
  itemFindMany: [] as Call[],
  itemFindFirst: [] as Call[],
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
        // Batched VIN prefetch — one findMany replaced the per-vehicle findFirst.
        findMany: async (args: Call) => { calls.itemFindMany.push(args); return existingItem ? [existingItem] : []; },
        findFirst: async (args: Call) => { calls.itemFindFirst.push(args); return existingItem; },
        upsert: async ({ where, create, update }: Call) => { calls.itemUpsert.push({ where, create, update }); return { id: "item_1" }; },
        create: async ({ data }: Call) => { calls.itemCreate.push({ data }); return { id: "item_2" }; },
        updateMany: async (args: Call) => { calls.itemUpdateMany.push(args); return { count: 0 }; },
      },
      inventorySource: {
        // Market config resolution reads the source row before any adapter runs.
        findFirst: async () => ({ id: "src_1", isActive: true, centerZip: "76011", radiusMiles: 100,
          filterMake: null, filterModel: null, filterYearMin: null, filterYearMax: null,
          filterPriceMaxCents: null, rowsPerCall: 50, maxCallsPerRun: 10,
          monthlyCallBudget: 400, callsUsedThisCycle: 0, budgetCycleKey: "2026-09" }),
        upsert: async ({ where }: Call) => { calls.sourceUpsert.push({ where }); return { id: "src_1" }; },
        update: async (args: Call) => { calls.sourceUpdate.push(args); return { id: "src_1" }; },
        updateMany: async () => ({ count: 1 }),
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
  calls.itemUpsert = []; calls.itemCreate = []; calls.syncRun = []; calls.sourceUpsert = []; calls.sourceUpdate = [];
  calls.itemUpdateMany = []; calls.itemFindMany = []; calls.itemFindFirst = [];
  existingItem = null;
});
afterEach(() => {
  globalThis.fetch = origFetch;
  if (origKey === undefined) delete process.env.MARKETCHECK_API_KEY;
  else process.env.MARKETCHECK_API_KEY = origKey;
});

/** Single-page stub. The adapter now paginates, so a page shorter than `rows` is what
 *  terminates the walk — which a one-page fixture always is. */
function mockFetchListings(listings: unknown[], numFound?: number) {
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ listings, num_found: numFound ?? listings.length }),
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

  // The adapter now collapses duplicates inside its own walk (a listing can legitimately
  // appear on two pages), so `totalFetched` counts DISTINCT normalized vehicles while
  // `rawListings` records what was actually received. Both numbers are reported so a run
  // cannot claim coverage it did not have.
  assert.equal(result.adapterResults[0]!.rawListings, 2, "two raw listings were received");
  assert.equal(result.totalFetched, 1, "which are one distinct vehicle");
  assert.equal(result.totalAfterDedup, 1);
  assert.equal(calls.itemUpsert.length, 1, "same VIN must not create uncontrolled duplicate supply");
});

// ── The duplicate stale sweep is gone ────────────────────────────────────────

test("a full sync deactivates NOTHING — the sweep is not a hidden side effect of ingestion", async () => {
  // runInventorySync used to carry a SECOND copy of the stale-sweep predicate, with the
  // same `lane != LANE_1` defect and no NULL branch on lastSeenAt. A sweep that hides
  // inside a sync is a sweep nobody can dry-run, and it deactivated rows on a cadence
  // nobody had chosen.
  process.env.MARKETCHECK_API_KEY = "test-key";
  mockFetchListings([
    { vin: "1HGCM82633A004352", build: { year: 2021, make: "Honda", model: "Accord" }, price: 25000 },
  ]);
  const { runInventorySync } = await load();
  const result = await runInventorySync({}, "full");

  assert.equal(calls.itemUpdateMany.length, 0, "ingestion must never deactivate rows");
  assert.equal("deactivated" in (result as unknown as Record<string, unknown>), false,
    "the field is gone from the result — the sweep reports its own numbers");
});

test("inventorySource.update is NARROWED with select — an unnarrowed update throws P2022", async () => {
  // Prisma returns every column a model declares unless the query narrows it. The moment
  // schema.prisma names a column the database does not have yet (the deploy-before-migrate
  // window), an unnarrowed update throws P2022 — silently, inside the .catch(() => {}) that
  // wraps this call, taking the run accounting with it.
  process.env.MARKETCHECK_API_KEY = "test-key";
  mockFetchListings([
    { vin: "1HGCM82633A004352", build: { year: 2021, make: "Honda", model: "Accord" }, price: 25000 },
  ]);
  const { runInventorySync } = await load();
  await runInventorySync({}, "full");

  assert.equal(calls.sourceUpdate.length, 1);
  assert.deepEqual((calls.sourceUpdate[0] as { select?: unknown }).select, { id: true });
});

test("VIN lookups are ONE batched query, not one per vehicle", async () => {
  // At 500 vehicles the old per-vehicle findFirst is 500 round-trips inside a serverless
  // function — which pagination would have turned from slow into a timeout.
  process.env.MARKETCHECK_API_KEY = "test-key";
  mockFetchListings([
    { vin: "1HGCM82633A004352", build: { year: 2021, make: "Honda", model: "Accord" }, price: 25000 },
    { vin: "5YJ3E1EA7JF006588", build: { year: 2020, make: "Tesla", model: "Model 3" }, price: 32000 },
    { vin: "1FTFW1E50NFA12345", build: { year: 2022, make: "Ford", model: "F-150" }, price: 45000 },
  ]);
  const { runInventorySync } = await load();
  await runInventorySync({}, "full");

  assert.equal(calls.itemFindMany.length, 1, "exactly one prefetch for three VINs");
  assert.equal(calls.itemFindFirst.length, 0, "the per-vehicle findFirst is gone");
});

test("spend and market are reported so the run is auditable", async () => {
  process.env.MARKETCHECK_API_KEY = "test-key";
  mockFetchListings([
    { vin: "1HGCM82633A004352", build: { year: 2021, make: "Honda", model: "Accord" }, price: 25000, dist: 33 },
  ]);
  const { runInventorySync } = await load();
  const result = await runInventorySync({}, "full");

  assert.equal(result.apiCallsUsed, 1);
  assert.equal(result.configSource, "row");
  assert.deepEqual(result.market, { zip: "76011", radiusMiles: 100 });
  assert.equal(result.adapterResults[0]!.maxDistMiles, 33, "proof the radius took effect");
});

test("a priority run is granted exactly ONE call, never a ten-page sweep", async () => {
  process.env.MARKETCHECK_API_KEY = "test-key";
  let fetches = 0;
  globalThis.fetch = (async () => {
    fetches++;
    return {
      ok: true, status: 200, statusText: "OK",
      json: async () => ({
        num_found: 5000,
        listings: Array.from({ length: 50 }, (_, i) => ({
          vin: `VIN${String(fetches * 100 + i).padStart(14, "0")}`,
          build: { year: 2022, make: "Ford", model: "F-150" }, price: 40000 + i,
        })),
      }),
    };
  }) as unknown as typeof fetch;

  const { runInventorySync } = await load();
  const result = await runInventorySync({}, "priority");
  assert.equal(fetches, 1, "priority is a manual re-check, not a sweep");
  assert.equal(result.apiCallsUsed, 1);
});
