// Unit tests for scanInactiveContacts — the inactivity scanner migrated off the
// Inngest `inactivityScannerFn` onto the internal Vercel-Cron substrate. Pins:
//   • emits buyer_inactive once per addressable stale contact;
//   • skips a contact with neither email nor phone (can't be re-resolved/messaged);
//   • one contact's emit failure does NOT abort the batch (per-item isolation);
//   • NO_STALE_CONTACTS when the query returns none;
//   • a query error throws (→ cron FAILED, HTTP 500).
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/crm/__tests__/inactivity-scanner.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

let queryResult: { data: unknown[] | null; error: { message: string } | null } = {
  data: [],
  error: null,
};
let emitCalls: Array<{ event: string; domainEntityId: string }> = [];
let emitThrowForId: string | null = null;

// Chainable, thenable Supabase query-builder mock: every filter returns `this`,
// and awaiting the chain resolves to queryResult.
function makeBuilder() {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "in", "lt", "is", "eq", "limit"]) {
    builder[m] = () => builder;
  }
  builder.then = (resolve: (v: unknown) => unknown) => resolve(queryResult);
  return builder;
}

mock.module("@/lib/supabase-service", {
  namedExports: {
    getServiceSupabase: () => ({ from: () => makeBuilder() }),
  },
});

mock.module("@/lib/events/emit", {
  namedExports: {
    emitDomainEvent: async (event: string, input: { domainEntityId: string }) => {
      if (emitThrowForId && input.domainEntityId === emitThrowForId) {
        throw new Error("emit failed");
      }
      emitCalls.push({ event, domainEntityId: input.domainEntityId });
      return { contactId: input.domainEntityId, idempotencyKey: `${event}:${input.domainEntityId}`, fired: {} };
    },
  },
});

mock.module("@/lib/logger", {
  namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } },
});

async function loadService() {
  return import("@/lib/services/crm/inactivity-scanner.service");
}

beforeEach(() => {
  queryResult = { data: [], error: null };
  emitCalls = [];
  emitThrowForId = null;
});

test("returns NO_STALE_CONTACTS when the query yields none", async () => {
  const { scanInactiveContacts } = await loadService();
  const r = await scanInactiveContacts();
  assert.equal(r.status, "NO_STALE_CONTACTS");
  assert.equal(r.scanned, 0);
  assert.equal(r.emitted, 0);
  assert.equal(emitCalls.length, 0);
});

test("emits buyer_inactive once per addressable contact and skips no-identity rows", async () => {
  queryResult = {
    data: [
      { id: "c1", email: "a@x.com", phone: null, first_name: "A", last_name: null, source: "import" },
      { id: "c2", email: null, phone: "+15550001111", first_name: null, last_name: null, source: "import" },
      { id: "c3", email: null, phone: null, first_name: null, last_name: null, source: "import" }, // skipped
    ],
    error: null,
  };
  const { scanInactiveContacts } = await loadService();
  const r = await scanInactiveContacts();
  assert.equal(r.status, "OK");
  assert.equal(r.scanned, 3);
  assert.equal(r.emitted, 2);
  assert.deepEqual(emitCalls.map((c) => c.domainEntityId).sort(), ["c1", "c2"]);
  assert.ok(emitCalls.every((c) => c.event === "buyer_inactive"));
});

test("one contact's emit failure does not abort the batch", async () => {
  emitThrowForId = "c1";
  queryResult = {
    data: [
      { id: "c1", email: "a@x.com", phone: null, first_name: null, last_name: null, source: "import" },
      { id: "c2", email: "b@x.com", phone: null, first_name: null, last_name: null, source: "import" },
    ],
    error: null,
  };
  const { scanInactiveContacts } = await loadService();
  const r = await scanInactiveContacts();
  assert.equal(r.status, "OK");
  assert.equal(r.scanned, 2);
  assert.equal(r.emitted, 1); // c2 succeeded despite c1 throwing
  assert.deepEqual(emitCalls.map((c) => c.domainEntityId), ["c2"]);
});

test("throws when the contacts query errors", async () => {
  queryResult = { data: null, error: { message: "connection reset" } };
  const { scanInactiveContacts } = await loadService();
  await assert.rejects(() => scanInactiveContacts(), /inactivity_scan_query_failed: connection reset/);
});
