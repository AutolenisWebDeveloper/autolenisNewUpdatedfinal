// Route contract tests for GET /api/cron/content-generation-drain.
// Pins the cron-secret auth guard, delegation to the drain service, and the
// FAILED→500 posture.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/cron/__tests__/content-generation-drain-route.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

let runCalls = 0;
let shouldThrow = false;

mock.module("@/lib/services/content/content-generation-processor.service", {
  namedExports: {
    drainContentGenerationQueue: async () => {
      runCalls += 1;
      if (shouldThrow) throw new Error("drain boom");
      return { status: "OK", claimed: 2, succeeded: 2, retried: 0, deadLettered: 0, skipped: 0 };
    },
  },
});

async function loadGET() {
  const mod = await import("@/app/api/cron/content-generation-drain/route");
  return mod.GET;
}

beforeEach(() => {
  runCalls = 0;
  shouldThrow = false;
  process.env.CRON_SECRET = "test-secret";
});

test("rejects an unauthenticated request", async () => {
  const GET = await loadGET();
  const res = await GET(new NextRequest("http://localhost/api/cron/content-generation-drain"));
  assert.equal(res.status, 401);
  assert.equal(runCalls, 0);
});

test("accepts a valid cron secret and returns the drain summary", async () => {
  const GET = await loadGET();
  const res = await GET(
    new NextRequest("http://localhost/api/cron/content-generation-drain", {
      headers: { authorization: "Bearer test-secret" },
    }),
  );
  assert.equal(res.status, 200);
  assert.equal(runCalls, 1);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.succeeded, 2);
});

test("returns 500 when the drain throws", async () => {
  shouldThrow = true;
  const GET = await loadGET();
  const res = await GET(
    new NextRequest("http://localhost/api/cron/content-generation-drain", {
      headers: { authorization: "Bearer test-secret" },
    }),
  );
  assert.equal(res.status, 500);
});
