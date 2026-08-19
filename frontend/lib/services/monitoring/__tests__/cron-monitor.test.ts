// D3a — withCronRun: the shared cron monitoring wrapper.
//
// MUST-HAVE #2 (best-effort): a CronJobLog DB error must NEVER fail the actual
// cron. If startCronRun/completeCronRun/failCronRun throw, the wrapped work still
// runs and its result/throw is returned unchanged.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/monitoring/__tests__/cron-monitor.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

let createBehavior: "ok" | "throw" = "ok";
let updateBehavior: "ok" | "throw" = "ok";
const calls = { create: [] as Array<Record<string, unknown>>, update: [] as Array<Record<string, unknown>> };

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      cronJobLog: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          calls.create.push(data);
          if (createBehavior === "throw") throw new Error("cron_job_logs insert failed");
          return { id: "log_1", startedAt: new Date(), ...data };
        },
        findUnique: async () => ({ id: "log_1", startedAt: new Date(Date.now() - 1000) }),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          calls.update.push(data);
          if (updateBehavior === "throw") throw new Error("cron_job_logs update failed");
          return { id: "log_1", ...data };
        },
      },
    },
  },
});

async function load() {
  return import("@/lib/services/monitoring/cron-monitor.service");
}

beforeEach(() => {
  createBehavior = "ok";
  updateBehavior = "ok";
  calls.create = [];
  calls.update = [];
});

test("happy path: records RUNNING then COMPLETED and returns the work result", async () => {
  const { withCronRun } = await load();
  let ran = 0;
  const res = await withCronRun("demo-cron", async () => { ran += 1; return { released: 3 }; });
  assert.deepEqual(res, { ok: true, result: { released: 3 } });
  assert.equal(ran, 1);
  assert.equal(calls.create[0]!.cronName, "demo-cron");
  assert.equal(calls.create[0]!.status, "RUNNING");
  assert.equal(calls.update[0]!.status, "COMPLETED");
});

test("BEST-EFFORT: startCronRun throwing does NOT stop the work or fail the run", async () => {
  createBehavior = "throw";
  const { withCronRun } = await load();
  let ran = 0;
  const res = await withCronRun("demo-cron", async () => { ran += 1; return 42; });
  assert.deepEqual(res, { ok: true, result: 42 }, "work still runs and result returns");
  assert.equal(ran, 1);
  assert.equal(calls.update.length, 0, "no completeCronRun since there is no log id");
});

test("BEST-EFFORT: completeCronRun throwing still returns the work result", async () => {
  updateBehavior = "throw";
  const { withCronRun } = await load();
  const res = await withCronRun("demo-cron", async () => ({ ok: 1 }));
  assert.deepEqual(res, { ok: true, result: { ok: 1 } });
});

test("work throwing → { ok:false, error } and a FAILED record is attempted", async () => {
  const { withCronRun } = await load();
  const boom = new Error("work blew up");
  const res = await withCronRun("demo-cron", async () => { throw boom; });
  assert.equal(res.ok, false);
  assert.equal((res as { error: unknown }).error, boom);
  assert.equal(calls.update.at(-1)!.status, "FAILED");
});

test("a non-object work result is stored under a stable key (Json-safe)", async () => {
  const { withCronRun } = await load();
  await withCronRun("demo-cron", async () => "hello");
  assert.deepEqual(calls.update[0]!.result, { value: "hello" });
});
