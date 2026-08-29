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

const BUILD_ENV_KEYS = ["VERCEL_GIT_COMMIT_SHA", "VERCEL_DEPLOYMENT_ID", "VERCEL_ENV"] as const;

/** Assigning undefined stores the STRING "undefined" — always delete. */
function clearBuildEnv() {
  for (const k of BUILD_ENV_KEYS) delete process.env[k];
}

const SHA = "d16cd084f0e2b1a7c3d9e5f4a6b8c0d2e4f6a8b0";

function persistedBuild(call: Record<string, unknown>) {
  return (call.result as Record<string, unknown> | undefined)?.build as
    | Record<string, unknown>
    | undefined;
}

beforeEach(() => {
  createBehavior = "ok";
  updateBehavior = "ok";
  calls.create = [];
  calls.update = [];
  // Every test states its own build environment. Clearing here keeps the
  // pre-existing result-shape assertions deterministic on a runner that happens
  // to define VERCEL_* in the ambient environment.
  clearBuildEnv();
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

// ---------------------------------------------------------------------------
// Build identity — making a stale-build incident self-evident
//
// On 2026-08-28 production served a build predating the e-sign schema gate for
// ~25 minutes. Establishing that took cross-referencing two unrelated crons:
// esign-artifact-reconcile failing with a pre-gate error, and
// dealer-invitation-reminder missing a result key a 20:00 PR had added. The
// serving build's identity was never determined at all.
//
// cron_job_logs is already the oracle every cron writes to, so the build that
// served each run belongs in the row itself. Recorded under a single `build`
// key so it cannot collide with any of the 32 crons' own result shapes, and so
// `result->'build'->>'commitSha'` answers the question in one query.
// ---------------------------------------------------------------------------

test("build identity: the serving commit SHA is recorded on a successful run", async () => {
  process.env.VERCEL_GIT_COMMIT_SHA = SHA;
  process.env.VERCEL_DEPLOYMENT_ID = "dpl_abc123";
  process.env.VERCEL_ENV = "production";

  const { withCronRun } = await load();
  await withCronRun("demo-cron", async () => ({ released: 3 }));

  const build = persistedBuild(calls.update[0]!);
  assert.ok(build, "without this the row cannot say which build produced it");
  assert.equal(build.commitSha, SHA);
  assert.equal(build.deploymentId, "dpl_abc123");
  assert.equal(build.vercelEnv, "production");
  assert.match(String(build.bootedAt), /^\d{4}-\d{2}-\d{2}T/);

  // The cron's own keys must survive alongside it.
  assert.equal((calls.update[0]!.result as Record<string, unknown>).released, 3);
});

test("build identity: recorded on a FAILED run too — that is where the forensics were needed", async () => {
  process.env.VERCEL_GIT_COMMIT_SHA = SHA;

  const { withCronRun } = await load();
  const res = await withCronRun("demo-cron", async () => { throw new Error("42703"); });

  assert.equal(res.ok, false);
  const failure = calls.update.at(-1)!;
  assert.equal(failure.status, "FAILED");
  assert.equal(
    persistedBuild(failure)?.commitSha,
    SHA,
    "the six runs that motivated this all FAILED; stamping only successes leaves exactly the rows you need unstamped",
  );
  assert.equal(failure.error, "Error: 42703", "the error must still be recorded");
});

test("build identity: absent env vars are omitted, never written as the string \"undefined\"", async () => {
  const { withCronRun } = await load();
  const res = await withCronRun("demo-cron", async () => ({ released: 1 }));

  assert.deepEqual(res, { ok: true, result: { released: 1 } }, "a local run must still succeed");
  const stored = calls.update[0]!.result as Record<string, unknown>;
  assert.equal(stored.build, undefined, "no Vercel identity to record → no build key at all");
  assert.deepEqual(stored, { released: 1 }, "existing result shapes stay byte-identical off Vercel");
});

test("build identity: a literal \"undefined\"/blank env value is treated as absent", async () => {
  // Exactly what `process.env.X = undefined` leaves behind — the bug that
  // already bit the terms resolver once.
  process.env.VERCEL_GIT_COMMIT_SHA = "undefined";
  process.env.VERCEL_DEPLOYMENT_ID = "   ";
  process.env.VERCEL_ENV = "production";

  const { withCronRun } = await load();
  await withCronRun("demo-cron", async () => ({ released: 1 }));

  const build = persistedBuild(calls.update[0]!);
  assert.equal(build?.commitSha, undefined, "\"undefined\" is not a commit SHA");
  assert.equal(build?.deploymentId, undefined, "a blank value is not a deployment id");
  assert.equal(build?.vercelEnv, "production", "the real value alongside them still records");
});

test("build identity: the value returned to the cron route is NOT augmented", async () => {
  process.env.VERCEL_GIT_COMMIT_SHA = SHA;

  const { withCronRun } = await load();
  const res = await withCronRun("demo-cron", async () => ({ released: 3 }));

  // Routes spread run.result straight into their HTTP body (e.g.
  // esign-artifact-reconcile does `{ success: true, ...run.result }`), so
  // augmenting the returned object would change 32 public response shapes.
  assert.deepEqual(res, { ok: true, result: { released: 3 } });
});

test("build identity: a non-object work result still gets stamped", async () => {
  process.env.VERCEL_GIT_COMMIT_SHA = SHA;

  const { withCronRun } = await load();
  await withCronRun("demo-cron", async () => "hello");

  const stored = calls.update[0]!.result as Record<string, unknown>;
  assert.equal(stored.value, "hello", "the existing { value } wrapper is preserved");
  assert.equal(persistedBuild(calls.update[0]!)?.commitSha, SHA);
});
