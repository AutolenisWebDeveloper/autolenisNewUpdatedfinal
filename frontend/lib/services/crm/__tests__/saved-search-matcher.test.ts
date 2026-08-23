// Unit tests for matchSavedSearches — the saved-search matcher migrated off the
// Inngest `savedSearchMatcherFn` onto the internal Vercel-Cron substrate. Pins:
//   • emits saved_search_matched AND advances the lastMatchAt cursor when a
//     search has new matching inventory (cursor advance = the re-alert dedup);
//   • a search with no matches neither emits nor advances the cursor;
//   • a search with no addressable buyer identity is skipped;
//   • one search's failure does NOT abort the batch (per-search isolation);
//   • NO_SAVED_SEARCHES when there are none.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/crm/__tests__/saved-search-matcher.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface SavedSearchRow {
  id: string;
  buyerId: string;
  name: string;
  filters: Record<string, unknown>;
  lastMatchAt: Date | null;
  createdAt: Date;
  buyer: {
    phone: string | null;
    firstName: string | null;
    lastName: string | null;
    zip: string | null;
    state: string | null;
    user: { email: string | null } | null;
  } | null;
}

let searches: SavedSearchRow[] = [];
let countBySearchId: Record<string, number> = {};
let countThrowForId: string | null = null;
let updateCalls: Array<{ id: string; lastMatchAt: unknown }> = [];
let emitCalls: Array<{ event: string; domainEntityId: string; data: Record<string, unknown> }> = [];

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      savedSearch: {
        findMany: async () => searches,
        update: async ({ where, data }: { where: { id: string }; data: { lastMatchAt: unknown } }) => {
          updateCalls.push({ id: where.id, lastMatchAt: data.lastMatchAt });
          return {};
        },
      },
      inventoryItem: {
        count: async ({ where }: { where: Record<string, unknown> }) => {
          // The service builds `where` including the search's own filters; we key
          // the mocked count on a marker filter the test sets per search.
          const id = (where as { __searchId?: string }).__searchId as string | undefined;
          if (countThrowForId && id === countThrowForId) throw new Error("count failed");
          return id ? (countBySearchId[id] ?? 0) : 0;
        },
        findMany: async () => [{ id: "inv1", year: 2022, make: "Toyota", model: "Camry", priceCents: 2500000 }],
      },
    },
  },
});

// Make buildInventoryWhereFromFilters stamp a marker so the count mock can tell
// which search it is counting for (the real mapping is unit-tested separately).
mock.module("@/lib/crm/saved-search-filters", {
  namedExports: {
    buildInventoryWhereFromFilters: (filters: Record<string, unknown>) => ({
      __searchId: filters.__searchId,
    }),
  },
});

mock.module("@/lib/supabase-service", {
  namedExports: { getServiceSupabase: () => ({}) },
});

mock.module("@/lib/events/emit", {
  namedExports: {
    emitDomainEvent: async (
      event: string,
      input: { domainEntityId: string; data: Record<string, unknown> },
    ) => {
      emitCalls.push({ event, domainEntityId: input.domainEntityId, data: input.data });
      return { contactId: "c", idempotencyKey: "k", fired: {} };
    },
  },
});

mock.module("@/lib/logger", {
  namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } },
});

async function loadService() {
  return import("@/lib/services/crm/saved-search-matcher.service");
}

function buyer(email: string | null, phone: string | null = null) {
  return { phone, firstName: "B", lastName: null, zip: "90210", state: "CA", user: email ? { email } : null };
}

beforeEach(() => {
  searches = [];
  countBySearchId = {};
  countThrowForId = null;
  updateCalls = [];
  emitCalls = [];
});

test("returns NO_SAVED_SEARCHES when there are none", async () => {
  const { matchSavedSearches } = await loadService();
  const r = await matchSavedSearches();
  assert.equal(r.status, "NO_SAVED_SEARCHES");
  assert.equal(r.scanned, 0);
  assert.equal(r.alerted, 0);
});

test("emits and advances the cursor for a search with new matches", async () => {
  searches = [
    {
      id: "s1",
      buyerId: "b1",
      name: "Toyotas",
      filters: { __searchId: "s1" },
      lastMatchAt: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      buyer: buyer("a@x.com"),
    },
  ];
  countBySearchId = { s1: 5 };
  const { matchSavedSearches } = await loadService();
  const r = await matchSavedSearches();
  assert.equal(r.status, "OK");
  assert.equal(r.scanned, 1);
  assert.equal(r.alerted, 1);
  assert.equal(emitCalls.length, 1);
  assert.equal(emitCalls[0].event, "saved_search_matched");
  assert.equal(emitCalls[0].data.match_count, 5);
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].id, "s1");
  assert.ok(updateCalls[0].lastMatchAt instanceof Date); // cursor advanced
});

test("does not emit or advance the cursor when there are no matches", async () => {
  searches = [
    {
      id: "s1",
      buyerId: "b1",
      name: "None",
      filters: { __searchId: "s1" },
      lastMatchAt: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      buyer: buyer("a@x.com"),
    },
  ];
  countBySearchId = { s1: 0 };
  const { matchSavedSearches } = await loadService();
  const r = await matchSavedSearches();
  assert.equal(r.alerted, 0);
  assert.equal(emitCalls.length, 0);
  assert.equal(updateCalls.length, 0);
});

test("skips a search whose buyer has no addressable identity", async () => {
  searches = [
    {
      id: "s1",
      buyerId: "b1",
      name: "NoIdentity",
      filters: { __searchId: "s1" },
      lastMatchAt: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      buyer: buyer(null, null),
    },
  ];
  countBySearchId = { s1: 5 };
  const { matchSavedSearches } = await loadService();
  const r = await matchSavedSearches();
  assert.equal(r.scanned, 1);
  assert.equal(r.alerted, 0);
  assert.equal(emitCalls.length, 0);
});

test("one search's failure does not abort the batch", async () => {
  countThrowForId = "s1";
  searches = [
    {
      id: "s1",
      buyerId: "b1",
      name: "Throws",
      filters: { __searchId: "s1" },
      lastMatchAt: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      buyer: buyer("a@x.com"),
    },
    {
      id: "s2",
      buyerId: "b2",
      name: "Works",
      filters: { __searchId: "s2" },
      lastMatchAt: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      buyer: buyer("b@x.com"),
    },
  ];
  countBySearchId = { s2: 3 };
  const { matchSavedSearches } = await loadService();
  const r = await matchSavedSearches();
  assert.equal(r.scanned, 2);
  assert.equal(r.alerted, 1); // s2 still processed
  assert.equal(emitCalls.length, 1);
  assert.equal(emitCalls[0].data.saved_search_id, "s2");
});
