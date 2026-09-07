// Route contract tests for GET /api/cron/comms-outbox-drain.
//
// The route now drains BOTH rails that share `comms_outbox` — the §27
// transactional rail (rows carrying a template_key, claimed with FOR UPDATE SKIP
// LOCKED) and the CRM rail (rows with none, claimed with a PostgREST CAS). One
// cron, one schedule, per §8.2 Phase 2.
//
// What this pins, beyond the original auth guard and FAILED→500 posture: A
// FAILURE IN ONE RAIL MUST NOT HIDE THE OTHER. If a transactional-rail failure
// could be masked by a healthy CRM drain, the cron would report success while
// every transaction communication silently stopped — which is the exact §27
// failure mode the rail exists to prevent.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/cron/__tests__/comms-outbox-drain-route.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

let crmCalls = 0;
let txCalls = 0;
let crmThrows = false;
let txThrows = false;

mock.module("@/lib/services/comms/comms-outbox.service", {
  namedExports: {
    drainCommsOutbox: async () => {
      crmCalls += 1;
      if (crmThrows) throw new Error("crm drain boom");
      return { status: "OK", claimed: 3, sent: 2, gated: 1, retried: 0, failed: 0, skipped: 0 };
    },
  },
});

mock.module("@/lib/services/comms/transactional-dispatcher.service", {
  namedExports: {
    drainTransactionalOutbox: async () => {
      txCalls += 1;
      if (txThrows) throw new Error("transactional drain boom");
      return { status: "OK", claimed: 5, sent: 4, gated: 0, skippedByRecheck: 1, retried: 0, failed: 0, errored: 0 };
    },
  },
});

async function loadGET() {
  const mod = await import("@/app/api/cron/comms-outbox-drain/route");
  return mod.GET;
}

function authed() {
  return new NextRequest("http://localhost/api/cron/comms-outbox-drain", {
    headers: { authorization: "Bearer test-secret" },
  });
}

beforeEach(() => {
  crmCalls = 0;
  txCalls = 0;
  crmThrows = false;
  txThrows = false;
  process.env.CRON_SECRET = "test-secret";
});

test("rejects an unauthenticated request, and drains nothing", async () => {
  const GET = await loadGET();
  const res = await GET(new NextRequest("http://localhost/api/cron/comms-outbox-drain"));
  assert.equal(res.status, 401);
  assert.equal(crmCalls, 0);
  assert.equal(txCalls, 0);
});

test("a valid cron secret drains both rails and returns both summaries", async () => {
  const GET = await loadGET();
  const res = await GET(authed());
  assert.equal(res.status, 200);
  assert.equal(txCalls, 1, "the transactional rail must be drained");
  assert.equal(crmCalls, 1, "the CRM rail must be drained");
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.crm.sent, 2);
  assert.equal(body.data.transactional.sent, 4);
  assert.equal(body.data.transactional.skippedByRecheck, 1);
});

test("a transactional-rail failure is a 500, and names the rail", async () => {
  txThrows = true;
  const GET = await loadGET();
  const res = await GET(authed());
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.deepEqual(body.failedRails, ["transactional"]);
  assert.equal(crmCalls, 1, "the healthy rail must still be drained — one rail's failure does not strand the other");
});

test("a CRM-rail failure is a 500 and does not hide a healthy transactional drain", async () => {
  crmThrows = true;
  const GET = await loadGET();
  const res = await GET(authed());
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.deepEqual(body.failedRails, ["crm"]);
  assert.equal(body.data.transactional.sent, 4, "the healthy rail's result must still be reported");
});

test("both rails failing reports both", async () => {
  txThrows = true;
  crmThrows = true;
  const GET = await loadGET();
  const res = await GET(authed());
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.deepEqual(body.failedRails, ["transactional", "crm"]);
});
