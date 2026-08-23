// Route contract tests for GET /api/cron/analytics-refresh.
// Pins the cron-secret auth guard, delegation to the analytics-refresh service,
// and the FAILED→500 posture when the refresh throws.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/cron/__tests__/analytics-refresh-route.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

let runCalls = 0;
let shouldThrow = false;

mock.module("@/lib/services/analytics/analytics-refresh.service", {
  namedExports: {
    refreshAnalyticsViews: async () => {
      runCalls += 1;
      if (shouldThrow) throw new Error("analytics_refresh_failed: boom");
      return { status: "OK", refreshed_at: "2026-01-01T00:00:00.000Z" };
    },
  },
});

async function loadGET() {
  const mod = await import("@/app/api/cron/analytics-refresh/route");
  return mod.GET;
}

beforeEach(() => {
  runCalls = 0;
  shouldThrow = false;
  process.env.CRON_SECRET = "test-secret";
});

test("rejects an unauthenticated request (no secret header)", async () => {
  const GET = await loadGET();
  const res = await GET(new NextRequest("http://localhost/api/cron/analytics-refresh"));
  assert.equal(res.status, 401);
  assert.equal(runCalls, 0);
});

test("rejects a spoofed x-vercel-cron header without the bearer secret", async () => {
  const GET = await loadGET();
  const res = await GET(
    new NextRequest("http://localhost/api/cron/analytics-refresh", {
      headers: { "x-vercel-cron": "1" },
    }),
  );
  assert.equal(res.status, 401);
  assert.equal(runCalls, 0);
});

test("accepts a valid cron secret and returns the refresh result", async () => {
  const GET = await loadGET();
  const res = await GET(
    new NextRequest("http://localhost/api/cron/analytics-refresh", {
      headers: { authorization: "Bearer test-secret" },
    }),
  );
  assert.equal(res.status, 200);
  assert.equal(runCalls, 1);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.status, "OK");
});

test("returns 500 when the refresh throws (cron recorded FAILED)", async () => {
  shouldThrow = true;
  const GET = await loadGET();
  const res = await GET(
    new NextRequest("http://localhost/api/cron/analytics-refresh", {
      headers: { authorization: "Bearer test-secret" },
    }),
  );
  assert.equal(res.status, 500);
  assert.equal(runCalls, 1);
  const body = await res.json();
  assert.equal(body.success, false);
});
