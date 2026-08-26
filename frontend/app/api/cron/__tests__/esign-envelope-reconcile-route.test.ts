// Proven-alive test for the esign-envelope-reconcile cron (Program 4). Invoking
// it must (a) enforce cron auth before any work, and (b) route through
// withCronRun so a CronJobLog run is written (RUNNING → COMPLETED) with the right
// cronName — matching the staleness registry entry that monitors it.
//
// Run: npx tsx --test --experimental-test-module-mocks \
//   "app/api/cron/__tests__/esign-envelope-reconcile-route.test.ts"

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

// Stub the actual reconciliation so the route's only DB touch is the CronJobLog run.
mock.module("@/lib/services/esign/esign-reconcile.service", {
  namedExports: {
    reconcileEsignEnvelopes: async () => ({
      scanned: 0, completed: 0, declined: 0, voided: 0, stillPending: 0, failed: 0, skippedUnconfigured: true,
    }),
  },
});

function cronReq(withAuth: boolean) {
  return new NextRequest("http://localhost/api/cron/esign-envelope-reconcile", {
    headers: withAuth ? { authorization: "Bearer test-secret" } : {},
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  cronLog.create = [];
  cronLog.update = [];
});

test("writes a CronJobLog run with the right cronName (proven alive)", async () => {
  const { GET } = await import("@/app/api/cron/esign-envelope-reconcile/route");
  const res = await GET(cronReq(true));
  assert.equal(res.status, 200);
  assert.equal(cronLog.create.length, 1);
  assert.equal(cronLog.create[0]!.cronName, "esign-envelope-reconcile");
  assert.equal(cronLog.create[0]!.status, "RUNNING");
  assert.equal(cronLog.update.at(-1)!.status, "COMPLETED");
});

test("an unauthenticated call is rejected before any run is recorded", async () => {
  const { GET } = await import("@/app/api/cron/esign-envelope-reconcile/route");
  const res = await GET(cronReq(false));
  assert.equal(res.status, 401);
  assert.equal(cronLog.create.length, 0);
});
