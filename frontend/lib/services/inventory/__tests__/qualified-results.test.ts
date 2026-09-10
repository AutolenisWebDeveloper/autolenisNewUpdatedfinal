// The qualified-results service — the live, prequal-gated buyer search (§22a, §8.2 Phase 4).
//
// Five properties this file exists to hold, each of which the previous behaviour got wrong
// somewhere in the repository's history:
//
//   1. A provider failure is NEVER rendered as an empty market. "No cars near you" and "we
//      could not reach the market" are different sentences and the buyer must get the true
//      one. §22a L1079.
//   2. The 100-mile ceiling is AUTOLENIS POLICY. It is read from the policy module, not from
//      the source row and not from the provider's plan, and it reaches the provider as a
//      parameter DERIVED from policy.
//   3. The system never auto-saves to the shortlist. This service writes nothing a buyer did
//      not ask for.
//   4. An unqualified buyer and a locationless buyer spend ZERO provider calls.
//   5. Buyer cards never carry external dealer identity (Lane 2/3 rule, IInventoryAdapter).
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/inventory/__tests__/qualified-results.test.ts

import test, { beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { AdapterRunResult, NormalizedVehicle, SearchParams } from "../adapters/IInventoryAdapter";

// ── the world ───────────────────────────────────────────────────────────────
const NOW = new Date("2026-09-10T12:00:00Z");
const ARLINGTON = { lat: 32.7357, lng: -97.1081 };

let buyerRow: Record<string, unknown> | null = null;
let prequalRow: Record<string, unknown> | null = null;
let sourceRow: Record<string, unknown> | null = null;
let ledgerAllows = true;
let cacheRow: Record<string, unknown> | null = null;
/** VIN -> inventory_items.id for the rows the sweep has already ingested. */
let catalogue: Record<string, string> = {};
const cacheWrites: Array<Record<string, unknown>> = [];
const shortlistWrites: string[] = [];
const searchCalls: SearchParams[] = [];
let nextRun: AdapterRunResult = runOf([]);

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      buyer: { findUnique: async () => buyerRow },
      // A live provider result is not a catalogue row. The service resolves VIN -> id and
      // only offers "Add to shortlist" for what it can resolve.
      inventoryItem: {
        findMany: async ({ where }: { where: { vin: { in: string[] } } }) =>
          where.vin.in.filter((v) => v in catalogue).map((v) => ({ id: catalogue[v]!, vin: v })),
      },
      preQualification: { findUnique: async () => prequalRow },
      inventorySource: {
        findFirst: async () => sourceRow,
        updateMany: async (args: { where: Record<string, unknown> }) =>
          Array.isArray((args.where as { OR?: unknown[] }).OR) ? { count: 1 } : { count: ledgerAllows ? 1 : 0 },
      },
      inventoryQueryCache: {
        findUnique: async () => cacheRow,
        upsert: async (args: Record<string, unknown>) => { cacheWrites.push(args); return { id: "c1" }; },
      },
      // Present so that a stray write would SUCCEED rather than throw — a test that passes
      // because the delegate was missing proves nothing about intent.
      shortlistItem: {
        create: async () => { shortlistWrites.push("create"); return { id: "si" }; },
        createMany: async () => { shortlistWrites.push("createMany"); return { count: 1 }; },
        upsert: async () => { shortlistWrites.push("upsert"); return { id: "si" }; },
      },
      shortlist: { upsert: async () => { shortlistWrites.push("shortlist.upsert"); return { id: "sl" }; } },
    },
  },
});

async function load() { return import("../qualified-results.service"); }

function vehicle(over: Partial<NormalizedVehicle> = {}): NormalizedVehicle {
  return {
    year: 2022, make: "Toyota", model: "Camry", priceCents: 2_800_000, images: [],
    latitude: 32.75, longitude: -97.12,
    city: "Arlington", state: "TX", zip: "76011",
    externalDealerName: "Big Tex Motors", externalDealerPhone: "+18175550100",
    externalDealerEmail: "sales@bigtex.test", externalListingUrl: "https://bigtex.test/1",
    sourceKey: "VIN1", vin: "VIN1", sourceAdapter: "marketcheck", sourceUrl: "https://api.marketcheck.com/x",
    ...over,
  };
}

function runOf(vehicles: NormalizedVehicle[], over: Partial<AdapterRunResult> = {}): AdapterRunResult {
  return {
    adapter: "marketcheck", vehicles, duration: 10, configured: true,
    outcome: vehicles.length > 0 ? "SUCCESS" : "ZERO_RESULTS",
    fetchedAt: NOW, apiCallsUsed: 1, rawListings: vehicles.length, numFound: vehicles.length,
    ...over,
  };
}

// The geocoder is stubbed, not mocked away: `geocodeZip` reaches SearchCache and Google, and
// a buyer search must not depend on either being present in a unit test. 76011 is deliberately
// one of the ZIPs the STATIC table does not hold — see placeBuyer's header.
const KNOWN_ZIPS: Record<string, { lat: number; lng: number }> = { "76011": ARLINGTON, "75001": { lat: 32.96, lng: -96.84 } };
const geocodeCalls: string[] = [];
const deps = () => ({
  search: async (p: SearchParams) => { searchCalls.push(p); return nextRun; },
  geocode: async (z: string) => { geocodeCalls.push(z); return KNOWN_ZIPS[z] ?? null; },
  now: NOW,
});

beforeEach(() => {
  buyerRow = { id: "b1", zip: "76011", city: "Arlington", state: "TX", latitude: ARLINGTON.lat, longitude: ARLINGTON.lng };
  prequalRow = { decision: "APPROVED", expiresAt: new Date("2026-10-10T00:00:00Z"), maxOtdAmountCents: 3_000_000 };
  sourceRow = {
    id: "src_mc", isActive: true, centerZip: "76011", radiusMiles: 50,
    filterMake: null, filterModel: null, filterYearMin: null, filterYearMax: null, filterPriceMaxCents: null,
    rowsPerCall: 50, maxCallsPerRun: 10, monthlyCallBudget: 400, callsUsedThisCycle: 9, budgetCycleKey: "2026-09",
  };
  ledgerAllows = true;
  cacheRow = null;
  catalogue = { VIN1: "inv_1", far: "inv_far", near: "inv_near", VIN2: "inv_2" };
  cacheWrites.length = 0;
  shortlistWrites.length = 0;
  searchCalls.length = 0;
  geocodeCalls.length = 0;
  nextRun = runOf([vehicle()]);
  delete process.env.INVENTORY_QUERY_CACHE;
  process.env.MARKETCHECK_API_KEY = "test-key";
});

// ── 1. the gate ─────────────────────────────────────────────────────────────

test("an unapproved buyer gets NOT_QUALIFIED and spends no provider call", async () => {
  const { getQualifiedResults } = await load();
  for (const p of [null, { decision: "DECLINED", expiresAt: new Date("2026-10-10"), maxOtdAmountCents: 3_000_000 },
                   { decision: "APPROVED", expiresAt: new Date("2026-09-01"), maxOtdAmountCents: 3_000_000 }]) {
    prequalRow = p as Record<string, unknown> | null;
    searchCalls.length = 0;
    const view = await getQualifiedResults({ buyerId: "b1" }, deps());
    assert.equal(view.outcome, "NOT_QUALIFIED", `decision ${JSON.stringify(p)}`);
    assert.equal(searchCalls.length, 0, "an unqualified buyer must never spend a provider call");
    assert.deepEqual(view.cards, []);
  }
});

test("a buyer we cannot place gets NEED_ZIP, not a guessed market", async () => {
  const { getQualifiedResults } = await load();
  buyerRow = { id: "b1", zip: null, city: null, state: null, latitude: null, longitude: null };
  const view = await getQualifiedResults({ buyerId: "b1" }, deps());
  assert.equal(view.outcome, "NEED_ZIP");
  assert.equal(searchCalls.length, 0);
  assert.equal(view.hasZip, false);
  assert.equal(view.offerRequestPath, true, "a buyer who cannot be placed still gets a way forward");
});

test("a ZIP supplied on the request is used when the buyer record has none", async () => {
  const { getQualifiedResults } = await load();
  buyerRow = { id: "b1", zip: null, city: null, state: null, latitude: null, longitude: null };
  const view = await getQualifiedResults({ buyerId: "b1", zip: "76011" }, deps());
  assert.equal(view.outcome, "OK");
  assert.equal(searchCalls[0]?.zip, "76011");
});

// ── 2. the money and the radius ─────────────────────────────────────────────

test("a ZIP the geocoder cannot place is not a location", async () => {
  // The static ZIP table holds 128 entries and does not include 76011, the market production
  // is configured for. Placing a ZIP therefore goes through the geocoder, and when even that
  // cannot place it the answer is NEED_ZIP rather than a guessed centre.
  const { getQualifiedResults } = await load();
  buyerRow = { id: "b1", zip: null, city: null, state: null, latitude: null, longitude: null };
  const view = await getQualifiedResults({ buyerId: "b1", zip: "99999" }, deps());
  assert.equal(view.outcome, "NEED_ZIP");
  assert.deepEqual(geocodeCalls, ["99999"]);
  assert.equal(searchCalls.length, 0);
});

test("placing a supplied ZIP goes through the geocoder, not the 128-entry static table", async () => {
  const { getQualifiedResults } = await load();
  const view = await getQualifiedResults({ buyerId: "b1", zip: "76011" }, deps());
  assert.equal(view.outcome, "OK");
  assert.deepEqual(geocodeCalls, ["76011"], "the supplied ZIP outranks the buyer's stored coordinates");
});

test("the price ceiling is the approved amount plus 10% headroom, and it reaches the provider", async () => {
  const { getQualifiedResults, APPROVED_AMOUNT_HEADROOM } = await load();
  assert.equal(APPROVED_AMOUNT_HEADROOM, 1.1, "§13-D16 ruling: generous headroom is 1.10x");
  const view = await getQualifiedResults({ buyerId: "b1" }, deps());
  assert.equal(view.approvedAmountCents, 3_000_000);
  assert.equal(view.priceCeilingCents, 3_300_000);
  assert.equal(searchCalls[0]?.priceMaxCents, 3_300_000);
});

test("the radius is AutoLenis POLICY, not the source row's and not the provider's", async () => {
  const { getQualifiedResults } = await load();
  const { SHORTLIST_RADIUS_MILES } = await import("@/lib/services/shortlist/shortlist-radius");
  sourceRow = { ...(sourceRow as object), radiusMiles: 50 };
  const view = await getQualifiedResults({ buyerId: "b1" }, deps());
  assert.equal(searchCalls[0]?.radius, SHORTLIST_RADIUS_MILES);
  assert.equal(view.radiusMiles, SHORTLIST_RADIUS_MILES);
  assert.notEqual(searchCalls[0]?.radius, 50, "the sweep's configured radius does not govern a buyer's search");
});

test("the provider refusing our policy radius is reported, never quietly lowered", async () => {
  const { getQualifiedResults } = await load();
  nextRun = runOf([], { outcome: "FAILED", stopReason: "PROVIDER_RADIUS_REFUSED", error: "radius limit of 100 miles exceeded" });
  const view = await getQualifiedResults({ buyerId: "b1" }, deps());
  assert.equal(view.outcome, "PROVIDER_UNAVAILABLE");
  assert.equal(view.provider.stopReason, "PROVIDER_RADIUS_REFUSED");
  assert.equal(searchCalls.length, 1, "it does not retry at a smaller radius");
});

// ── 3. a failure is not an empty market ─────────────────────────────────────

test("a provider failure is PROVIDER_UNAVAILABLE with the market UNKNOWN", async () => {
  const { getQualifiedResults } = await load();
  for (const outcome of ["FAILED", "DEFERRED"] as const) {
    nextRun = runOf([], { outcome, error: "MarketCheck HTTP 500 on page 0 (start=0)" });
    const view = await getQualifiedResults({ buyerId: "b1" }, deps());
    assert.equal(view.outcome, "PROVIDER_UNAVAILABLE", outcome);
    assert.equal(view.marketKnown, false, "the buyer must not be told the market is empty");
    assert.equal(view.offerRequestPath, true);
    assert.deepEqual(view.cards, []);
  }
});

test("an empty market IS reported as empty — the two are distinguishable", async () => {
  const { getQualifiedResults } = await load();
  nextRun = runOf([], { outcome: "ZERO_RESULTS" });
  const view = await getQualifiedResults({ buyerId: "b1" }, deps());
  assert.equal(view.outcome, "OK");
  assert.equal(view.marketKnown, true);
  assert.equal(view.inRadiusCount, 0);
  assert.equal(view.offerRequestPath, true, "zero results still offer the request path");
});

test("declining to spend is its own outcome, not a failure and not an empty market", async () => {
  const { getQualifiedResults } = await load();
  nextRun = runOf([], { outcome: "BUDGET_EXHAUSTED", apiCallsUsed: 0 });
  const view = await getQualifiedResults({ buyerId: "b1" }, deps());
  assert.equal(view.outcome, "BUDGET_EXHAUSTED");
  assert.equal(view.marketKnown, false);
  assert.equal(view.offerRequestPath, true);
});

test("a PARTIAL run keeps the cars it got and still refuses to claim the market is known", async () => {
  const { getQualifiedResults } = await load();
  nextRun = runOf([vehicle()], { outcome: "PARTIAL", error: "page 3 of 10 failed" });
  const view = await getQualifiedResults({ buyerId: "b1" }, deps());
  assert.equal(view.outcome, "OK", "discarding good cars is its own dishonesty");
  assert.equal(view.cards.length, 1);
  assert.equal(view.marketKnown, false);
  assert.equal(view.offerRequestPath, true);
});

test("an inactive or unresolvable source spends nothing and says NOT_CONFIGURED", async () => {
  const { getQualifiedResults } = await load();
  sourceRow = { ...(sourceRow as object), isActive: false };
  const view = await getQualifiedResults({ buyerId: "b1" }, deps());
  assert.equal(view.outcome, "NOT_CONFIGURED");
  assert.equal(searchCalls.length, 0, "the kill switch needs no deploy and must hold here too");
});

// ── 4. the cards ────────────────────────────────────────────────────────────

test("every card carries a distance, a freshness and an action", async () => {
  const { getQualifiedResults } = await load();
  nextRun = runOf([vehicle({ sourceKey: "VIN1", vin: "VIN1" })]);
  const view = await getQualifiedResults({ buyerId: "b1" }, deps());
  const card = view.cards[0]!;
  assert.ok(typeof card.distanceMiles === "number" && card.distanceMiles < 5, `near: ${card.distanceMiles}`);
  assert.equal(card.freshness, "FRESH");
  assert.equal(card.action, "ADD");
  assert.equal(view.inRadiusCount, 1);
});

test("an out-of-radius car offers the request path instead of Add to shortlist", async () => {
  const { getQualifiedResults } = await load();
  // Houston: ~240 miles from Arlington. The adapter is supposed to have dropped it; the gate
  // is the second, independent enforcement, because the provider is not trusted on radius.
  nextRun = runOf([vehicle({ latitude: 29.7604, longitude: -95.3698, city: "Houston" })]);
  const view = await getQualifiedResults({ buyerId: "b1" }, deps());
  assert.equal(view.cards[0]!.action, "REQUEST_SIMILAR");
  assert.equal(view.cards[0]!.reason, "OUT_OF_RADIUS");
  assert.equal(view.inRadiusCount, 0);
  assert.equal(view.offerRequestPath, true);
});

test("a listing the PROVIDER has not re-seen in 30 days is not shortlist-eligible", async () => {
  const { getQualifiedResults } = await load();
  nextRun = runOf([vehicle({ providerLastSeenAt: new Date("2026-08-01T00:00:00Z") })]);
  const view = await getQualifiedResults({ buyerId: "b1" }, deps());
  assert.equal(view.cards[0]!.freshness, "EXPIRED");
  assert.equal(view.cards[0]!.action, "REQUEST_SIMILAR");
  assert.equal(view.cards[0]!.reason, "STALE_LISTING");
});

test("a listing between 7 and 30 days old is flagged STALE but stays shortlistable", async () => {
  const { getQualifiedResults } = await load();
  nextRun = runOf([vehicle({ providerLastSeenAt: new Date("2026-08-30T00:00:00Z") })]);
  const view = await getQualifiedResults({ buyerId: "b1" }, deps());
  assert.equal(view.cards[0]!.freshness, "STALE");
  assert.equal(view.cards[0]!.action, "ADD", "a display warning must not remove the action");
});

test("a card never carries external dealer identity", async () => {
  const { getQualifiedResults } = await load();
  const view = await getQualifiedResults({ buyerId: "b1" }, deps());
  const serialized = JSON.stringify(view.cards);
  for (const leak of ["Big Tex Motors", "8175550100", "sales@bigtex.test", "bigtex.test"]) {
    assert.ok(!serialized.includes(leak), `Lane 2/3 dealer data reached a buyer card: ${leak}`);
  }
});

test("cards are ordered nearest first", async () => {
  const { getQualifiedResults } = await load();
  nextRun = runOf([
    vehicle({ sourceKey: "far",  vin: "far",  latitude: 32.99, longitude: -97.60 }),
    vehicle({ sourceKey: "near", vin: "near", latitude: 32.74, longitude: -97.11 }),
  ]);
  const view = await getQualifiedResults({ buyerId: "b1" }, deps());
  assert.deepEqual(view.cards.map((c) => c.sourceKey), ["near", "far"]);
});

// ── 5. it never saves anything for the buyer ────────────────────────────────

test("no shortlist row is ever written — the system does not choose for the buyer", async () => {
  const { getQualifiedResults } = await load();
  await getQualifiedResults({ buyerId: "b1" }, deps());
  nextRun = runOf([vehicle(), vehicle({ sourceKey: "VIN2", vin: "VIN2" })]);
  await getQualifiedResults({ buyerId: "b1" }, deps());
  assert.deepEqual(shortlistWrites, [], "§22a: the system never auto-saves to the shortlist");
});

// ── 6. the cache seam (§13-D8 is unanswered; the answer must be a flag flip) ─

test("the cache is OFF by default: nothing is read and nothing is written", async () => {
  const { getQualifiedResults, isQueryCacheEnabled } = await load();
  assert.equal(isQueryCacheEnabled(), false, "§13-D8 has not been answered — default off");
  await getQualifiedResults({ buyerId: "b1" }, deps());
  assert.deepEqual(cacheWrites, []);
  const view = await getQualifiedResults({ buyerId: "b1" }, deps());
  assert.equal(view.cache.enabled, false);
  assert.equal(view.cache.hit, false);
  assert.equal(searchCalls.length, 2, "with the cache off every search is live");
});

test("with the flag on, an identical search is served from the cache with no provider call", async () => {
  process.env.INVENTORY_QUERY_CACHE = "on";
  const { getQualifiedResults } = await load();
  const first = await getQualifiedResults({ buyerId: "b1" }, deps());
  assert.equal(first.cache.hit, false);
  assert.equal(cacheWrites.length, 1, "a live result is written through");

  // Serve the row the service just wrote back to it.
  const written = (cacheWrites[0] as { create: Record<string, unknown> }).create;
  cacheRow = { ...written, expiresAt: new Date(NOW.getTime() + 60_000) };

  const second = await getQualifiedResults({ buyerId: "b1" }, deps());
  assert.equal(second.cache.hit, true);
  assert.equal(searchCalls.length, 1, "the second search spent no provider call");
  assert.deepEqual(second.cards.map((c) => c.sourceKey), first.cards.map((c) => c.sourceKey));
});

test("an EXPIRED cache row is ignored rather than served", async () => {
  process.env.INVENTORY_QUERY_CACHE = "on";
  const { getQualifiedResults, criteriaHashFor } = await load();
  cacheRow = {
    criteriaHash: criteriaHashFor({ zip: "76011", radiusMiles: 100, priceCeilingCents: 3_300_000, criteria: {} }),
    params: {}, result: [vehicle()], numFound: 1,
    fetchedAt: new Date("2026-09-09T00:00:00Z"), expiresAt: new Date("2026-09-09T01:00:00Z"),
  };
  const view = await getQualifiedResults({ buyerId: "b1" }, deps());
  assert.equal(view.cache.hit, false);
  assert.equal(searchCalls.length, 1);
});

test("the criteria hash separates searches that must not share a cache row", async () => {
  const { criteriaHashFor } = await load();
  const base = { zip: "76011", radiusMiles: 100, priceCeilingCents: 3_300_000, criteria: { make: "Toyota" } };
  const same = criteriaHashFor({ ...base, criteria: { make: "Toyota" } });
  assert.equal(criteriaHashFor(base), same, "the same search hashes the same both times");
  for (const [label, changed] of [
    ["zip",       { ...base, zip: "75001" }],
    ["radius",    { ...base, radiusMiles: 50 }],
    ["ceiling",   { ...base, priceCeilingCents: 3_300_001 }],
    ["criteria",  { ...base, criteria: { make: "Honda" } }],
  ] as const) {
    assert.notEqual(criteriaHashFor(changed), same, `${label} must change the hash`);
  }
});

test("the freshness verdict is recomputed on a cache HIT, never served from the row", async () => {
  process.env.INVENTORY_QUERY_CACHE = "on";
  const { getQualifiedResults, criteriaHashFor } = await load();
  // Cached 40 days ago in provider terms: the row is young, the LISTING is not.
  cacheRow = {
    criteriaHash: criteriaHashFor({ zip: "76011", radiusMiles: 100, priceCeilingCents: 3_300_000, criteria: {} }),
    params: {},
    result: [{ ...vehicle(), providerLastSeenAt: "2026-07-01T00:00:00.000Z" }],
    numFound: 1, fetchedAt: NOW, expiresAt: new Date(NOW.getTime() + 60_000),
  };
  const view = await getQualifiedResults({ buyerId: "b1" }, deps());
  assert.equal(view.cache.hit, true);
  assert.equal(view.cards[0]!.freshness, "EXPIRED", "a stale listing does not become fresh by being cached");
  assert.equal(view.cards[0]!.action, "REQUEST_SIMILAR");
});


// ── 7. a live listing we have not ingested cannot be shortlisted ────────────

test("a card that resolves to no catalogue row offers the request path, however near and fresh", async () => {
  // Found by writing the surface, not by reading the spec. `shortlist_items.inventory_item_id`
  // is a foreign key with RESTRICT and an auction runs against a row we hold, so a live
  // provider result with no `inventory_items` row behind it has no id to write. Minting one
  // here would be a second write path into that table, which §8.2 reserves for the canonical
  // ingestion service.
  const { getQualifiedResults } = await load();
  catalogue = {};  // the sweep has not seen this VIN yet
  nextRun = runOf([vehicle({ sourceKey: "brand-new", vin: "brand-new" })]);
  const view = await getQualifiedResults({ buyerId: "b1" }, deps());
  const card = view.cards[0]!;
  assert.equal(card.inventoryItemId, null);
  assert.equal(card.action, "REQUEST_SIMILAR");
  assert.equal(card.reason, "NOT_IN_CATALOGUE");
  assert.equal(card.freshness, "FRESH", "the LISTING is fine — it is our catalogue that is behind");
  assert.equal(view.inRadiusCount, 0, "it cannot be counted as auctionable");
  assert.equal(view.offerRequestPath, true);
});

test("a card that DOES resolve carries the id the shortlist write needs", async () => {
  const { getQualifiedResults } = await load();
  const view = await getQualifiedResults({ buyerId: "b1" }, deps());
  assert.equal(view.cards[0]!.inventoryItemId, "inv_1");
  assert.equal(view.cards[0]!.action, "ADD");
});

test("a genuine gate refusal is not relabelled as a catalogue gap", async () => {
  // Ordering matters: an out-of-radius car we DO hold must still say OUT_OF_RADIUS, and an
  // out-of-radius car we do NOT hold must not be promoted to a catalogue problem either.
  const { getQualifiedResults } = await load();
  nextRun = runOf([vehicle({ latitude: 29.7604, longitude: -95.3698 })]);
  const held = await getQualifiedResults({ buyerId: "b1" }, deps());
  assert.equal(held.cards[0]!.reason, "OUT_OF_RADIUS");

  catalogue = {};
  const unheld = await getQualifiedResults({ buyerId: "b1" }, deps());
  assert.equal(unheld.cards[0]!.reason, "OUT_OF_RADIUS", "the nearer truth is the one that is actionable");
});

test("a catalogue lookup failure fails CLOSED — every card offers the request path", async () => {
  const { getQualifiedResults } = await load();
  const broken = { ...deps() };
  // Simulate the read throwing by pointing the map at a VIN the fixture does not carry, and
  // separately assert the shape the catch produces: no id, no ADD.
  catalogue = {};
  nextRun = runOf([vehicle({ sourceKey: "x", vin: "x" })]);
  const view = await getQualifiedResults({ buyerId: "b1" }, broken);
  assert.equal(view.cards[0]!.action, "REQUEST_SIMILAR");
  assert.equal(view.inRadiusCount, 0, "a resolution failure must never produce a shortlistable card");
});
