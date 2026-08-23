// Route contract tests for GET /api/cron/refinance-outreach-drain.
// Pins the cron-secret auth guard, delegation to the drain service, and the
// FAILED→500 posture. (Internal parity for the QStash refinance-outreach job;
// DORMANT until the owner-gated cutover — the drain no-ops NO_DUE/NO_TABLE.)
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/cron/__tests__/refinance-outreach-drain-route.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

let runCalls = 0;
let shouldThrow = false;

mock.module("@/lib/services/refinance/refinance-outreach-drain.service", {
  namedExports: {
    drainDueRefinanceOutreach: async () => {
      runCalls += 1;
      if (shouldThrow) throw new Error("drain boom");
      return { status: "NO_DUE", due: 0, sent: 0, skipped: 0, retried: 0, failed: 0 };
    },
  },
});

async function loadGET() {
  const mod = await import("@/app/api/cron/refinance-outreach-drain/route");
  return mod.GET;
}

beforeEach(() => {
  runCalls = 0;
  shouldThrow = false;
  process.env.CRON_SECRET = "test-secret";
});

test("rejects an unauthenticated request", async () => {
  const GET = await loadGET();
  const res = await GET(new NextRequest("http://localhost/api/cron/refinance-outreach-drain"));
  assert.equal(res.status, 401);
  assert.equal(runCalls, 0);
});

test("accepts a valid cron secret and returns the drain summary", async () => {
  const GET = await loadGET();
  const res = await GET(
    new NextRequest("http://localhost/api/cron/refinance-outreach-drain", {
      headers: { authorization: "Bearer test-secret" },
    }),
  );
  assert.equal(res.status, 200);
  assert.equal(runCalls, 1);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.status, "NO_DUE");
});

test("returns 500 when the drain throws", async () => {
  shouldThrow = true;
  const GET = await loadGET();
  const res = await GET(
    new NextRequest("http://localhost/api/cron/refinance-outreach-drain", {
      headers: { authorization: "Bearer test-secret" },
    }),
  );
  assert.equal(res.status, 500);
});
