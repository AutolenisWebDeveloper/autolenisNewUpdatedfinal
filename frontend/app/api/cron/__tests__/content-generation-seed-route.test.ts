// Route contract tests for GET /api/cron/content-generation-seed.
// Pins the cron-secret auth guard, delegation to the seeder, the FAILED→500
// posture, and the kill switch's success-but-inert response.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/cron/__tests__/content-generation-seed-route.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

let seedCalls: Array<number | undefined> = [];
let shouldThrow = false;
let enabled = true;

mock.module("@/lib/services/content/content-generation.service", {
  namedExports: {
    CONTENT_SEED_MAX_PER_RUN: 25,
    CONTENT_SEED_SCHEDULE: "0 8 * * *",
    CONTENT_AUTOPILOT_FLAG: "CONTENT_AUTOPILOT_ENABLED",
    seedScheduledGeneration: async (maxPerRun?: number) => {
      seedCalls.push(maxPerRun);
      if (shouldThrow) throw new Error("seed boom");
      return enabled
        ? {
            enabled: true,
            considered: 900,
            skippedExisting: 870,
            skippedInFlight: 5,
            enqueued: 25,
            enqueuedNew: 20,
            enqueuedRetry: 5,
            jobId: "job-1",
          }
        : {
            enabled: false,
            considered: 0,
            skippedExisting: 0,
            skippedInFlight: 0,
            enqueued: 0,
            enqueuedNew: 0,
            enqueuedRetry: 0,
            jobId: null,
          };
    },
  },
});

async function loadGET() {
  const mod = await import("@/app/api/cron/content-generation-seed/route");
  return mod.GET;
}

function cronReq(auth = true) {
  return new NextRequest("http://localhost/api/cron/content-generation-seed", {
    headers: auth ? { authorization: "Bearer test-secret" } : {},
  });
}

beforeEach(() => {
  seedCalls = [];
  shouldThrow = false;
  enabled = true;
  process.env.CRON_SECRET = "test-secret";
});

test("rejects an unauthenticated request and never seeds", async () => {
  const GET = await loadGET();
  const res = await GET(cronReq(false));
  assert.equal(res.status, 401);
  assert.equal(seedCalls.length, 0);
});

test("rejects a wrong cron secret", async () => {
  const GET = await loadGET();
  const res = await GET(
    new NextRequest("http://localhost/api/cron/content-generation-seed", {
      headers: { authorization: "Bearer not-the-secret" },
    }),
  );
  assert.equal(res.status, 401);
  assert.equal(seedCalls.length, 0);
});

test("fails closed with 500 when CRON_SECRET is not configured", async () => {
  process.env.CRON_SECRET = ""; // the helper treats empty as unconfigured → fail closed
  const GET = await loadGET();
  const res = await GET(cronReq());
  assert.equal(res.status, 500);
  assert.equal(seedCalls.length, 0);
});

test("accepts a valid cron secret and returns the seed summary", async () => {
  const GET = await loadGET();
  const res = await GET(cronReq());
  assert.equal(res.status, 200);
  assert.equal(seedCalls.length, 1);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.enabled, true);
  assert.equal(body.data.enqueued, 25);
  assert.equal(body.data.jobId, "job-1");
  assert.equal(body.data.skippedExisting, 870);
  assert.equal(body.data.skippedInFlight, 5);
  assert.equal(body.data.enqueuedNew, 20, "forward progress is visible in the run record");
  assert.equal(body.data.enqueuedRetry, 5);
});

test("passes the 25-item per-run cap to the seeder", async () => {
  const GET = await loadGET();
  await GET(cronReq());
  assert.equal(seedCalls[0], 25);
});

test("the kill switch returns success with enabled:false and enqueued:0", async () => {
  enabled = false;
  const GET = await loadGET();
  const res = await GET(cronReq());
  assert.equal(res.status, 200, "a disabled autopilot is a healthy run, not a failure");
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.enabled, false);
  assert.equal(body.data.enqueued, 0);
  assert.equal(body.data.jobId, null);
});

test("returns 500 when the seeder throws", async () => {
  shouldThrow = true;
  const GET = await loadGET();
  const res = await GET(cronReq());
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.success, false);
});
