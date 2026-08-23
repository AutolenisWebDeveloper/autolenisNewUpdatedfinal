// Route contract tests for GET /api/cron/inactivity-scan.
// Pins the cron-secret auth guard, delegation to the inactivity-scanner service,
// and the FAILED→500 posture when the scan throws.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/cron/__tests__/inactivity-scan-route.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

let runCalls = 0;
let shouldThrow = false;

mock.module("@/lib/services/crm/inactivity-scanner.service", {
  namedExports: {
    scanInactiveContacts: async () => {
      runCalls += 1;
      if (shouldThrow) throw new Error("inactivity_scan_query_failed: boom");
      return { status: "OK", scanned: 12, emitted: 9 };
    },
  },
});

async function loadGET() {
  const mod = await import("@/app/api/cron/inactivity-scan/route");
  return mod.GET;
}

beforeEach(() => {
  runCalls = 0;
  shouldThrow = false;
  process.env.CRON_SECRET = "test-secret";
});

test("rejects an unauthenticated request", async () => {
  const GET = await loadGET();
  const res = await GET(new NextRequest("http://localhost/api/cron/inactivity-scan"));
  assert.equal(res.status, 401);
  assert.equal(runCalls, 0);
});

test("rejects a spoofed x-vercel-cron header without the bearer secret", async () => {
  const GET = await loadGET();
  const res = await GET(
    new NextRequest("http://localhost/api/cron/inactivity-scan", {
      headers: { "x-vercel-cron": "1" },
    }),
  );
  assert.equal(res.status, 401);
  assert.equal(runCalls, 0);
});

test("fails closed (500) when CRON_SECRET is unconfigured", async () => {
  process.env.CRON_SECRET = "";
  const GET = await loadGET();
  const res = await GET(
    new NextRequest("http://localhost/api/cron/inactivity-scan", {
      headers: { authorization: "Bearer anything" },
    }),
  );
  assert.equal(res.status, 500);
  assert.equal(runCalls, 0);
});

test("accepts a valid cron secret and returns the scan counts", async () => {
  const GET = await loadGET();
  const res = await GET(
    new NextRequest("http://localhost/api/cron/inactivity-scan", {
      headers: { authorization: "Bearer test-secret" },
    }),
  );
  assert.equal(res.status, 200);
  assert.equal(runCalls, 1);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.scanned, 12);
  assert.equal(body.data.emitted, 9);
});

test("returns 500 when the scan throws", async () => {
  shouldThrow = true;
  const GET = await loadGET();
  const res = await GET(
    new NextRequest("http://localhost/api/cron/inactivity-scan", {
      headers: { authorization: "Bearer test-secret" },
    }),
  );
  assert.equal(res.status, 500);
  assert.equal(runCalls, 1);
});
