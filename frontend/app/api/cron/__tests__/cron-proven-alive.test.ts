// D3a MUST-HAVE #1 — "proven alive". The Phase-3 self-healing crons were
// "configured but unverified". Now that they route through withCronRun, invoking
// each cron must WRITE a CronJobLog run (RUNNING → COMPLETED) with the right
// cronName. This test exercises the REAL withCronRun → startCronRun/
// completeCronRun path against a mocked prisma, so a regression that unwires the
// monitoring (or drops the cronName) fails here.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/cron/__tests__/cron-proven-alive.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

const cronLog = { create: [] as Array<Record<string, unknown>>, update: [] as Array<Record<string, unknown>> };

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      cronJobLog: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          cronLog.create.push(data);
          return { id: "log_1", startedAt: new Date() };
        },
        findUnique: async () => ({ id: "log_1", startedAt: new Date(Date.now() - 500) }),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          cronLog.update.push(data);
          return { id: "log_1" };
        },
      },
    },
  },
});

// Stub the actual work so the route's only DB touch is the CronJobLog run.
mock.module("@/lib/services/acquisition/request-coverage-gate.service", {
  namedExports: { reconcileCoverageHolds: async () => ({ released: 0, recruited: 0 }) },
});
mock.module("@/lib/services/vehicle-request/request-progression.service", {
  namedExports: { reconcileRequestProgression: async () => ({ found: 0, advanced: 0, incomplete: 0, failed: 0 }) },
});
mock.module("@/lib/services/dealer-recruitment/apollo-credit-ledger.service", {
  namedExports: {
    ensureCurrentCycleLedger: async () => ({ cycleKey: "2026-03", capCredits: 2000, spentCredits: 0 }),
  },
});

function cronReq(path: string) {
  return new NextRequest(`http://localhost${path}`, { headers: { authorization: "Bearer test-secret" } });
}

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  cronLog.create = [];
  cronLog.update = [];
});

test("coverage-hold-reconcile writes a CronJobLog run (proven alive)", async () => {
  const { GET } = await import("@/app/api/cron/coverage-hold-reconcile/route");
  const res = await GET(cronReq("/api/cron/coverage-hold-reconcile"));
  assert.equal(res.status, 200);
  assert.equal(cronLog.create.length, 1, "a RUNNING record is written");
  assert.equal(cronLog.create[0]!.cronName, "coverage-hold-reconcile");
  assert.equal(cronLog.create[0]!.status, "RUNNING");
  assert.equal(cronLog.update.at(-1)!.status, "COMPLETED", "and completed");
});

test("apollo-ledger-rollover writes a CronJobLog run (proven alive)", async () => {
  const { GET } = await import("@/app/api/cron/apollo-ledger-rollover/route");
  const res = await GET(cronReq("/api/cron/apollo-ledger-rollover"));
  assert.equal(res.status, 200);
  assert.equal(cronLog.create.length, 1);
  assert.equal(cronLog.create[0]!.cronName, "apollo-ledger-rollover");
  assert.equal(cronLog.create[0]!.status, "RUNNING");
  assert.equal(cronLog.update.at(-1)!.status, "COMPLETED");
});

test("an unauthenticated cron call writes NO run record", async () => {
  const { GET } = await import("@/app/api/cron/coverage-hold-reconcile/route");
  const res = await GET(new NextRequest("http://localhost/api/cron/coverage-hold-reconcile"));
  assert.equal(res.status, 401);
  assert.equal(cronLog.create.length, 0, "auth is checked before any run is recorded");
});
