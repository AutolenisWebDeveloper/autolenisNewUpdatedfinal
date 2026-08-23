// Buyer-intake processor cron (/api/cron/intake-reconcile) — the authoritative,
// Inngest-FREE execution path.
//
// Pins: cron auth via the shared authorizeCronRequest helper (Bearer <CRON_SECRET>
// only; a spoofed x-vercel-cron header is rejected — Phase 4 posture); delegation
// to the shared processEligibleBuyerIntakes service (no inngest.send anywhere); the
// structured summary is returned; and a business-dead run (work attempted, zero
// successes) is escalated to a FAILED cron / HTTP 500 rather than a misleading green.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks "app/api/cron/__tests__/intake-reconcile-route.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

let summary: Record<string, unknown> = {};
let processCalls = 0;

mock.module("@/lib/services/acquisition/intake-processor.service", {
  namedExports: {
    processEligibleBuyerIntakes: async () => {
      processCalls += 1;
      return summary;
    },
  },
});

// Replicate withCronRun's real contract: run the work; a throw → { ok:false };
// otherwise { ok:true, result }. Monitoring is best-effort and irrelevant here.
mock.module("@/lib/services/monitoring/cron-monitor.service", {
  namedExports: {
    withCronRun: async (_name: string, work: () => Promise<unknown>) => {
      try {
        return { ok: true, result: await work() };
      } catch (error) {
        return { ok: false, error };
      }
    },
  },
});

async function loadGET() {
  return (await import("@/app/api/cron/intake-reconcile/route")).GET;
}

function req(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/cron/intake-reconcile", { headers });
}

// The authorized request header the shared cron authorizer accepts.
const AUTH = { authorization: "Bearer test-secret" };

function okSummary(over: Record<string, unknown> = {}) {
  return {
    eligible: 0,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    duplicateBlocked: 0,
    alreadyProcessed: 0,
    notFound: 0,
    totalDealersContacted: 0,
    failures: [],
    allAttemptedFailed: false,
    windowHours: 48,
    eligibilityFloor: "2026-08-21T00:00:00.000Z",
    timestamp: "2026-08-23T00:00:00.000Z",
    ...over,
  };
}

beforeEach(() => {
  processCalls = 0;
  summary = okSummary();
  process.env.CRON_SECRET = "test-secret";
});

test("rejects unauthorized requests without doing any work", async () => {
  const GET = await loadGET();
  const res = await GET(req());
  assert.equal(res.status, 401);
  assert.equal(processCalls, 0, "no work on an unauthorized request");
});

test("rejects a spoofed x-vercel-cron header; accepts the bearer secret", async () => {
  const GET = await loadGET();
  // Phase 4: the header-only bypass is gone — a spoofed x-vercel-cron is rejected.
  assert.equal((await GET(req({ "x-vercel-cron": "1" }))).status, 401);
  assert.equal((await GET(req(AUTH))).status, 200);
});

test("fails closed (500) when CRON_SECRET is unconfigured", async () => {
  process.env.CRON_SECRET = ""; // helper treats empty as unconfigured → fail closed
  const GET = await loadGET();
  const res = await GET(req(AUTH));
  assert.equal(res.status, 500);
  assert.equal(processCalls, 0);
});

test("delegates to processEligibleBuyerIntakes and returns the structured summary", async () => {
  summary = okSummary({ eligible: 3, attempted: 3, succeeded: 3, totalDealersContacted: 7 });
  const GET = await loadGET();
  const res = await GET(req(AUTH));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(processCalls, 1);
  assert.equal(body.success, true);
  assert.equal(body.data.succeeded, 3);
  assert.equal(body.data.totalDealersContacted, 7);
});

test("partial failure stays green but surfaces the failures in the result", async () => {
  summary = okSummary({
    eligible: 2,
    attempted: 2,
    succeeded: 1,
    failed: 1,
    failures: [{ opportunityId: "opp_b", category: "PIPELINE_ERROR", error: "boom" }],
  });
  const GET = await loadGET();
  const res = await GET(req(AUTH));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.failed, 1);
  assert.equal(body.data.failures[0].opportunityId, "opp_b");
});

test("business-dead run (attempted > 0, succeeded == 0) → FAILED cron / HTTP 500", async () => {
  summary = okSummary({
    eligible: 2,
    attempted: 2,
    succeeded: 0,
    failed: 2,
    allAttemptedFailed: true,
    failures: [{ opportunityId: "a", category: "PIPELINE_ERROR", error: "down" }],
  });
  const GET = await loadGET();
  const res = await GET(req(AUTH));
  assert.equal(res.status, 500, "a dead workload must not be reported as green");
  const body = await res.json();
  assert.equal(body.success, false);
});
