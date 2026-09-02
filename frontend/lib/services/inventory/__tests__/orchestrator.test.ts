// Batch 1 — inventory orchestrator truthfulness.
//
// 2026-09 — the orchestrator now resolves WHICH MARKET to sync before any adapter
// runs, and there is no compiled-in default market. Every test that expects a
// fetch must therefore configure one; the tests that expect no fetch prove that an
// unconfigured deployment ingests nothing rather than silently syncing Manhattan.
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
  sourceFindMany: [] as Call[],
  itemUpdateMany: [] as Call[],
};
let existingItem: unknown = null;
/** Configured InventorySource rows. Empty = no market row, the fresh-database case. */
let sourceRows: Array<Record<string, unknown>> = [];
/** When set, inventorySource.findMany throws it — used to simulate P2022. */
let sourceRowsThrow: (Error & { code?: string }) | null = null;
/** When set, inventoryItem.upsert/create throws it (every call). */
let upsertThrows: Error | null = null;
/** When true, only the FIRST inventoryItem write throws. */
let upsertThrowsOnce = false;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      dealer: {
        findMany: async () => [] as unknown[],
        findFirst: async () => null,
      },
      inventoryItem: {
        findFirst: async () => existingItem,
        upsert: async ({ where, create, update }: Call) => {
          calls.itemUpsert.push({ where, create, update });
          if (upsertThrows) throw upsertThrows;
          if (upsertThrowsOnce) { upsertThrowsOnce = false; throw new Error("P2002 unique constraint"); }
          return { id: "item_1" };
        },
        create: async ({ data }: Call) => {
          calls.itemCreate.push({ data });
          if (upsertThrows) throw upsertThrows;
          if (upsertThrowsOnce) { upsertThrowsOnce = false; throw new Error("P2002 unique constraint"); }
          return { id: "item_2" };
        },
        updateMany: async (args: Call) => { calls.itemUpdateMany.push(args); return { count: 0 }; },
      },
      inventorySource: {
        findMany: async (args: Call) => {
          calls.sourceFindMany.push(args);
          if (sourceRowsThrow) throw sourceRowsThrow;
          return sourceRows;
        },
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
const origZip = process.env.INVENTORY_DEFAULT_MARKET_ZIP;

/** A Dallas-Fort Worth market, so a test that expects a fetch actually gets one. */
function configureMarket(zip = "75201") {
  process.env.INVENTORY_DEFAULT_MARKET_ZIP = zip;
}

beforeEach(() => {
  calls.itemUpsert = []; calls.itemCreate = []; calls.syncRun = []; calls.sourceUpsert = [];
  calls.sourceFindMany = []; calls.itemUpdateMany = [];
  existingItem = null;
  sourceRows = [];
  sourceRowsThrow = null;
  upsertThrows = null;
  upsertThrowsOnce = false;
  delete process.env.INVENTORY_DEFAULT_MARKET_ZIP;
});
afterEach(() => {
  globalThis.fetch = origFetch;
  if (origKey === undefined) delete process.env.MARKETCHECK_API_KEY;
  else process.env.MARKETCHECK_API_KEY = origKey;
  if (origZip === undefined) delete process.env.INVENTORY_DEFAULT_MARKET_ZIP;
  else process.env.INVENTORY_DEFAULT_MARKET_ZIP = origZip;
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
  configureMarket();
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
  configureMarket();
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
  configureMarket();
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

// ─────────────────────────────────────────────────────────────────────────────
// Market configuration (2026-09).
//
// The orchestrator used to run its single adapter with whatever params the caller
// passed — which for both crons was `{}` — and the adapter filled the gap with
// `zip ?? "10001"`. These pin the replacement: the market is resolved from the
// InventorySource row, then env, then nothing at all.
// ─────────────────────────────────────────────────────────────────────────────

/** Every MarketCheck URL requested during a run. */
function captureRequestedUrls(listings: unknown[] = []) {
  const urls: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    urls.push(String(input));
    return { ok: true, status: 200, statusText: "OK", json: async () => ({ listings }) };
  }) as unknown as typeof fetch;
  return urls;
}

function marketRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "src_dfw",
    type: "MARKETCHECK",
    name: "MarketCheck",
    isActive: true,
    marketLabel: "Dallas-Fort Worth",
    marketZip: "75201",
    marketLat: null,
    marketLng: null,
    marketRadiusMiles: 75,
    marketMakes: [],
    marketPriceMaxCents: null,
    marketYearMin: null,
    marketYearMax: null,
    ...over,
  };
}

test("REGRESSION: an API key with NO market configured ingests nothing and never queries 10001", async () => {
  process.env.MARKETCHECK_API_KEY = "test-key";
  const urls = captureRequestedUrls();
  const { runInventorySync } = await load();

  const result = await runInventorySync({}, "full");

  assert.equal(urls.length, 0, "an unconfigured market must not reach the provider at all");
  assert.equal(result.outcome, "NOT_CONFIGURED");
  assert.equal(result.configuredMarkets, 0);
  assert.equal(result.healthScore, null, "an unconfigured market is a config gap, never a health score");
  assert.equal(calls.itemUpsert.length, 0);
  assert.equal(calls.syncRun[0]!.status, "NOT_CONFIGURED");
});

test("the market comes from the InventorySource row", async () => {
  process.env.MARKETCHECK_API_KEY = "test-key";
  sourceRows = [marketRow()];
  const urls = captureRequestedUrls();
  const { runInventorySync } = await load();

  const result = await runInventorySync({}, "full");

  assert.equal(urls.length, 1);
  assert.ok(urls[0]!.includes("zip=75201"), `expected the configured DFW centre, got ${urls[0]}`);
  assert.ok(urls[0]!.includes("radius=75"));
  assert.ok(!urls[0]!.includes("10001"), "Manhattan must not appear anywhere in the request");
  assert.equal(result.configuredMarkets, 1);
  assert.equal(result.adapterResults[0]!.market, "Dallas-Fort Worth 75201 r=75mi (source)");
});

test("the source row's market wins over the env fallback", async () => {
  process.env.MARKETCHECK_API_KEY = "test-key";
  process.env.INVENTORY_DEFAULT_MARKET_ZIP = "30301";
  sourceRows = [marketRow()];
  const urls = captureRequestedUrls();
  const { runInventorySync } = await load();

  await runInventorySync({}, "full");

  assert.ok(urls[0]!.includes("zip=75201"));
  assert.ok(!urls[0]!.includes("30301"));
});

test("env configures the market when no source row carries one — the pre-migration path", async () => {
  process.env.MARKETCHECK_API_KEY = "test-key";
  process.env.INVENTORY_DEFAULT_MARKET_ZIP = "76102";
  sourceRows = [marketRow({ marketZip: null, marketRadiusMiles: null, marketLabel: null })];
  const urls = captureRequestedUrls();
  const { runInventorySync } = await load();

  await runInventorySync({}, "full");

  assert.ok(urls[0]!.includes("zip=76102"), `expected the env centre, got ${urls[0]}`);
});

test("one adapter serves several markets — one request per configured row", async () => {
  process.env.MARKETCHECK_API_KEY = "test-key";
  sourceRows = [
    marketRow(),
    marketRow({ id: "src_hou", name: "MarketCheck — Houston", marketLabel: "Houston", marketZip: "77002", marketRadiusMiles: 50 }),
  ];
  const urls = captureRequestedUrls();
  const { runInventorySync } = await load();

  const result = await runInventorySync({}, "full");

  assert.equal(urls.length, 2, "each configured market is its own query");
  assert.ok(urls.some((u) => u.includes("zip=75201")));
  assert.ok(urls.some((u) => u.includes("zip=77002")));
  assert.equal(result.configuredMarkets, 2);
  // Per-source accounting must not collapse two markets into one adapter name.
  assert.equal(calls.syncRun.length, 2);
  assert.deepEqual(
    result.adapterResults.map((r) => r.sourceName).sort(),
    ["MarketCheck", "MarketCheck — Houston"],
  );
});

test("market filters reach the provider query", async () => {
  process.env.MARKETCHECK_API_KEY = "test-key";
  sourceRows = [marketRow({ marketMakes: ["Toyota", "Honda"], marketPriceMaxCents: 4_500_000, marketYearMin: 2019 })];
  const urls = captureRequestedUrls();
  const { runInventorySync } = await load();

  await runInventorySync({}, "full");

  assert.ok(urls[0]!.includes("make=Toyota%2CHonda"), `got ${urls[0]}`);
  assert.ok(urls[0]!.includes("price_max=45000"), "priceCents must be converted to the provider's dollars");
  assert.ok(urls[0]!.includes("year_min=2019"));
});

test("an explicit param overrides the configured market (admin/manual runs)", async () => {
  process.env.MARKETCHECK_API_KEY = "test-key";
  sourceRows = [marketRow()];
  const urls = captureRequestedUrls();
  const { runInventorySync } = await load();

  await runInventorySync({ zip: "78701", radius: 25 }, "priority");

  assert.ok(urls[0]!.includes("zip=78701"));
  assert.ok(urls[0]!.includes("radius=25"));
});

test("REGRESSION: a missing market column (P2022) degrades to env, it does not take the sync down", async () => {
  // The market_* columns arrive with a migration the owner applies out of band.
  // Between deploying this code and applying it, the InventorySource read fails.
  process.env.MARKETCHECK_API_KEY = "test-key";
  process.env.INVENTORY_DEFAULT_MARKET_ZIP = "75201";
  sourceRowsThrow = Object.assign(new Error("column inventory_sources.market_zip does not exist"), { code: "P2022" });
  const urls = captureRequestedUrls();
  const { runInventorySync } = await load();

  const result = await runInventorySync({}, "full");

  assert.ok(urls[0]!.includes("zip=75201"), "the env fallback must carry the run through the pre-migration window");
  assert.equal(result.outcome, "ZERO_RESULTS");
});

test("a non-P2022 database error is NOT swallowed", async () => {
  process.env.MARKETCHECK_API_KEY = "test-key";
  sourceRowsThrow = Object.assign(new Error("connection refused"), { code: "P1001" });
  const { runInventorySync } = await load();

  await assert.rejects(
    () => runInventorySync({}, "full"),
    /connection refused/,
    "only the missing-column case may degrade; a real outage must surface",
  );
});

test("the full-sync sweep uses the corrected predicate, not `lane != LANE_1`", async () => {
  process.env.MARKETCHECK_API_KEY = "test-key";
  sourceRows = [marketRow()];
  captureRequestedUrls();
  const { runInventorySync } = await load();

  await runInventorySync({}, "full");

  assert.equal(calls.itemUpdateMany.length, 1, "a full sync sweeps");
  const where = JSON.stringify((calls.itemUpdateMany[0] as { where: unknown }).where);
  assert.ok(!/"lane":\{"not":"LANE_1"\}/.test(where), `orchestrator sweep still exempts a whole lane: ${where}`);
  assert.ok(where.includes("dealerId"));
  assert.ok(where.includes("addedByAdminId"));
  assert.ok(where.includes("createdAt"), "NULL lastSeenAt must be reachable here too");
});

test("a priority sync never sweeps", async () => {
  process.env.MARKETCHECK_API_KEY = "test-key";
  sourceRows = [marketRow()];
  captureRequestedUrls();
  const { runInventorySync } = await load();

  await runInventorySync({}, "priority");

  assert.equal(calls.itemUpdateMany.length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Provider health, source on/off, and the properties that keep the corrected
// sweep from becoming destructive.
// ─────────────────────────────────────────────────────────────────────────────

function failingFetch(status: number) {
  globalThis.fetch = (async () => ({
    ok: false, status, statusText: "err", json: async () => ({}),
  })) as unknown as typeof fetch;
}

test("REGRESSION: a full sync does NOT sweep when a source failed — no cascading wipe", async () => {
  // The sweep deactivates rows this run did not re-stamp. Running it after a
  // provider outage empties the catalogue for a reason unrelated to the listings.
  process.env.MARKETCHECK_API_KEY = "test-key";
  sourceRows = [marketRow()];
  failingFetch(500); // 5xx -> DEFERRED
  const { runInventorySync } = await load();

  const result = await runInventorySync({}, "full");

  assert.equal(result.outcome, "DEFERRED");
  assert.equal(calls.itemUpdateMany.length, 0, "a run with an unhealthy source must not sweep");
  assert.match(String(result.sweepSkippedReason), /failed or deferred/);
});

test("REGRESSION: a full sync does NOT sweep when a vehicle write failed", async () => {
  process.env.MARKETCHECK_API_KEY = "test-key";
  sourceRows = [marketRow()];
  captureRequestedUrls([
    { vin: "1HGCM82633A004352", build: { year: 2021, make: "Honda", model: "Accord" }, price: 25000 },
  ]);
  upsertThrows = new Error("P2002 unique constraint");
  const { runInventorySync } = await load();

  const result = await runInventorySync({}, "full");

  assert.equal(result.upsertFailures, 1);
  assert.equal(calls.itemUpdateMany.length, 0, "a partial write leaves live rows un-stamped — sweeping ages them out");
  assert.match(String(result.sweepSkippedReason), /write\(s\) failed/);
});

test("one failing vehicle does not abort the whole batch", async () => {
  process.env.MARKETCHECK_API_KEY = "test-key";
  sourceRows = [marketRow()];
  captureRequestedUrls([
    { vin: "1HGCM82633A004352", build: { year: 2021, make: "Honda", model: "Accord" }, price: 25000 },
    { vin: "5YJ3E1EA7KF000316", build: { year: 2022, make: "Tesla", model: "Model 3" }, price: 32000 },
  ]);
  upsertThrowsOnce = true;
  const { runInventorySync } = await load();

  const result = await runInventorySync({}, "full");

  assert.equal(result.upsertFailures, 1);
  assert.equal(result.upserted, 1, "the second vehicle must still be ingested and re-stamped");
});

test("a deactivated source is NOT synced — isActive:false is a real off switch", async () => {
  process.env.MARKETCHECK_API_KEY = "test-key";
  process.env.INVENTORY_DEFAULT_MARKET_ZIP = "75201";
  sourceRows = [marketRow({ isActive: false })];
  const urls = captureRequestedUrls();
  const { runInventorySync } = await load();

  const result = await runInventorySync({}, "full");

  assert.equal(urls.length, 0, "deactivating every source must stop the sync, not fall through to env");
  assert.equal(calls.sourceUpsert.length, 0, "a deactivated source must not be silently re-registered");
  assert.equal(result.adapterResults.length, 0);
});

test("ingested rows carry listing geography so the public radius filter can find them", async () => {
  process.env.MARKETCHECK_API_KEY = "test-key";
  sourceRows = [marketRow()];
  captureRequestedUrls([
    {
      vin: "1HGCM82633A004352",
      build: { year: 2021, make: "Honda", model: "Accord" },
      price: 25000,
      dealer: { name: "Dallas Motors", city: "Dallas", state: "TX", zip: "75201" },
    },
  ]);
  const { runInventorySync } = await load();

  await runInventorySync({}, "full");

  const create = (calls.itemUpsert[0] as { create: Record<string, unknown> }).create;
  assert.equal(create.city, "Dallas");
  assert.equal(create.state, "TX");
  assert.equal(create.zip, "75201");
  assert.ok(create.latitude !== undefined, "without coordinates the ZIP+radius catalogue filter drops the row");
  assert.ok(create.longitude !== undefined);
});

test("REGRESSION: an aggregator run never demotes a dealer's own row", async () => {
  // assignLane() can only return LANE_2/LANE_3. Restamping lane+sourceAdapter on a
  // dealer-owned row converted dealer inventory into aggregator inventory, and cost
  // it the sweep exemption that its dealer link is supposed to guarantee.
  process.env.MARKETCHECK_API_KEY = "test-key";
  sourceRows = [marketRow()];
  existingItem = { id: "item_1", dealerId: "dealer_1", priceHistory: [] };
  captureRequestedUrls([
    { vin: "1HGCM82633A004352", build: { year: 2021, make: "Honda", model: "Accord" }, price: 25000 },
  ]);
  const { runInventorySync } = await load();

  await runInventorySync({}, "full");

  const update = (calls.itemUpsert[0] as { update: Record<string, unknown> }).update;
  assert.equal(update.lane, undefined, "a dealer-owned row's lane must not be restamped by a feed");
  assert.equal(update.sourceAdapter, undefined, "nor its provenance");
  assert.equal(update.lastSeenAt instanceof Date, true, "freshness IS still refreshed");
});

test("an aggregator row with no dealer still gets its lane and provenance restamped", async () => {
  process.env.MARKETCHECK_API_KEY = "test-key";
  sourceRows = [marketRow()];
  existingItem = { id: "item_1", dealerId: null, priceHistory: [] };
  captureRequestedUrls([
    { vin: "1HGCM82633A004352", build: { year: 2021, make: "Honda", model: "Accord" }, price: 25000 },
  ]);
  const { runInventorySync } = await load();

  await runInventorySync({}, "full");

  const update = (calls.itemUpsert[0] as { update: Record<string, unknown> }).update;
  assert.equal(update.lane, "LANE_3");
  assert.equal(update.sourceAdapter, "marketcheck");
});
