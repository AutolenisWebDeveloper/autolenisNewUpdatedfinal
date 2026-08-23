// Route contract tests for GET /api/cron/pickup-confirmation-nudge.
// Pins the cron-secret auth guard and delegation to the SLA service.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/cron/__tests__/pickup-confirmation-nudge-route.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

let runCalls = 0;

mock.module("@/lib/services/pickup/pickup-sla.service", {
  namedExports: {
    runPickupConfirmationNudges: async () => {
      runCalls += 1;
      return { dealerNudged: 3, buyerNudged: 1 };
    },
  },
});

async function loadGET() {
  const mod = await import("@/app/api/cron/pickup-confirmation-nudge/route");
  return mod.GET;
}

beforeEach(() => { runCalls = 0; process.env.CRON_SECRET = "test-secret"; });

test("rejects an unauthenticated request (no cron header, no secret)", async () => {
  const GET = await loadGET();
  const res = await GET(new NextRequest("http://localhost/api/cron/pickup-confirmation-nudge"));
  assert.equal(res.status, 401);
  assert.equal(runCalls, 0);
});

test("accepts a valid cron secret and returns the nudge counts", async () => {
  const GET = await loadGET();
  const res = await GET(
    new NextRequest("http://localhost/api/cron/pickup-confirmation-nudge", {
      headers: { authorization: "Bearer test-secret" },
    }),
  );
  assert.equal(res.status, 200);
  assert.equal(runCalls, 1);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.dealerNudged, 3);
  assert.equal(body.data.buyerNudged, 1);
});

test("rejects a spoofed x-vercel-cron header without the bearer secret", async () => {
  const GET = await loadGET();
  const res = await GET(
    new NextRequest("http://localhost/api/cron/pickup-confirmation-nudge", {
      headers: { "x-vercel-cron": "1" },
    }),
  );
  assert.equal(res.status, 401);
  assert.equal(runCalls, 0);
});
