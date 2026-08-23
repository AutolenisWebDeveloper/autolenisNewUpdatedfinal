// Route contract tests for GET /api/cron/saved-search-match.
// Pins the cron-secret auth guard, delegation to the saved-search-matcher
// service, and the FAILED→500 posture when the matcher throws.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/cron/__tests__/saved-search-match-route.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

let runCalls = 0;
let shouldThrow = false;

mock.module("@/lib/services/crm/saved-search-matcher.service", {
  namedExports: {
    matchSavedSearches: async () => {
      runCalls += 1;
      if (shouldThrow) throw new Error("boom");
      return { status: "OK", scanned: 30, alerted: 4 };
    },
  },
});

async function loadGET() {
  const mod = await import("@/app/api/cron/saved-search-match/route");
  return mod.GET;
}

beforeEach(() => {
  runCalls = 0;
  shouldThrow = false;
  process.env.CRON_SECRET = "test-secret";
});

test("rejects an unauthenticated request", async () => {
  const GET = await loadGET();
  const res = await GET(new NextRequest("http://localhost/api/cron/saved-search-match"));
  assert.equal(res.status, 401);
  assert.equal(runCalls, 0);
});

test("rejects a spoofed x-vercel-cron header without the bearer secret", async () => {
  const GET = await loadGET();
  const res = await GET(
    new NextRequest("http://localhost/api/cron/saved-search-match", {
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
    new NextRequest("http://localhost/api/cron/saved-search-match", {
      headers: { authorization: "Bearer anything" },
    }),
  );
  assert.equal(res.status, 500);
  assert.equal(runCalls, 0);
});

test("accepts a valid cron secret and returns the match counts", async () => {
  const GET = await loadGET();
  const res = await GET(
    new NextRequest("http://localhost/api/cron/saved-search-match", {
      headers: { authorization: "Bearer test-secret" },
    }),
  );
  assert.equal(res.status, 200);
  assert.equal(runCalls, 1);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.scanned, 30);
  assert.equal(body.data.alerted, 4);
});

test("returns 500 when the matcher throws", async () => {
  shouldThrow = true;
  const GET = await loadGET();
  const res = await GET(
    new NextRequest("http://localhost/api/cron/saved-search-match", {
      headers: { authorization: "Bearer test-secret" },
    }),
  );
  assert.equal(res.status, 500);
  assert.equal(runCalls, 1);
});
