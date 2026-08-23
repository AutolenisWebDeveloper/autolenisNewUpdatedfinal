// Route contract tests for GET /api/cron/lead-nurture-drain.
// Pins the cron-secret auth guard, delegation to the drain service, and the
// FAILED→500 posture. (The LP form-abandonment / exit-intent Inngest workers
// were retired onto this cron.)
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/cron/__tests__/lead-nurture-drain-route.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

let runCalls = 0;
let shouldThrow = false;

mock.module("@/lib/services/crm/lead-nurture.service", {
  namedExports: {
    drainDueLeadNurture: async () => {
      runCalls += 1;
      if (shouldThrow) throw new Error("drain boom");
      return { status: "OK", due: 2, sent: 1, canceled: 0, skipped: 1, retried: 0, failed: 0 };
    },
  },
});

async function loadGET() {
  const mod = await import("@/app/api/cron/lead-nurture-drain/route");
  return mod.GET;
}

beforeEach(() => {
  runCalls = 0;
  shouldThrow = false;
  process.env.CRON_SECRET = "test-secret";
});

test("rejects an unauthenticated request", async () => {
  const GET = await loadGET();
  const res = await GET(new NextRequest("http://localhost/api/cron/lead-nurture-drain"));
  assert.equal(res.status, 401);
  assert.equal(runCalls, 0);
});

test("accepts a valid cron secret and returns the drain summary", async () => {
  const GET = await loadGET();
  const res = await GET(
    new NextRequest("http://localhost/api/cron/lead-nurture-drain", {
      headers: { authorization: "Bearer test-secret" },
    }),
  );
  assert.equal(res.status, 200);
  assert.equal(runCalls, 1);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.sent, 1);
});

test("returns 500 when the drain throws", async () => {
  shouldThrow = true;
  const GET = await loadGET();
  const res = await GET(
    new NextRequest("http://localhost/api/cron/lead-nurture-drain", {
      headers: { authorization: "Bearer test-secret" },
    }),
  );
  assert.equal(res.status, 500);
});
