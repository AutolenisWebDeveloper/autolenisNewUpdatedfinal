// A cron that RESOLVES with a failure inside it must not be logged COMPLETED.
//
// THE DEFECT WAS LIVE WHEN THIS WAS WRITTEN. `withCronRun` wrote COMPLETED whenever
// `work()` resolved, and the inventory sweep reports its own failure inside the resolved
// result. Production, read-only 2026-09-10: `inventory_sources.last_run_status = FAILED`,
// `vehicles_last_count = 0`, `last_run_at 2026-09-10T08:00:07`, `calls_used_this_cycle 9`
// — the sweep failing every morning, while `cron_job_logs` said COMPLETED and
// `detectFailedCrons`, which filters on `CronJobLog.status`, saw nothing to report.
//
// It is the same defect class as the 191-run silent freeze the yield gate was built for,
// one layer up: `classifyYield` correctly downgrades the run to FAILED, and the log then
// throws the verdict away.
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/monitoring/__tests__/cron-run-assessment.test.ts

import test, { beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

interface LogRow {
  id: string;
  cronName: string;
  status: string;
  error?: string | null;
  result?: Record<string, unknown> | null;
  startedAt: Date;
  completedAt?: Date | null;
  duration?: number;
}

let rows: LogRow[] = [];
let seq = 0;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      cronJobLog: {
        create: async ({ data }: { data: { cronName: string; status: string } }) => {
          const row: LogRow = { id: `log_${++seq}`, cronName: data.cronName, status: data.status, startedAt: new Date() };
          rows.push(row);
          return row;
        },
        findUnique: async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null,
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = rows.find((r) => r.id === where.id);
          if (row) Object.assign(row, data);
          return row;
        },
      },
    },
  },
});

async function load() {
  return import("../cron-monitor.service");
}

beforeEach(() => {
  rows = [];
  seq = 0;
});

const only = () => {
  assert.equal(rows.length, 1, "exactly one log row per run");
  return rows[0]!;
};

test("with NO assessor the behaviour is unchanged — a resolved run is COMPLETED", async () => {
  // 138 call sites rely on this. The fix is opt-in precisely so none of them moves.
  const { withCronRun } = await load();
  const run = await withCronRun("legacy-cron", async () => ({ outcome: "FAILED", n: 3 }));
  assert.equal(run.ok, true);
  assert.equal(only().status, "COMPLETED");
});

test("an assessor reporting failure records FAILED", async () => {
  const { withCronRun } = await load();
  const run = await withCronRun(
    "inventory-sync-full",
    async () => ({ outcome: "FAILED" as const }),
    { assess: (r) => ({ failed: r.outcome === "FAILED", error: "sweep returned nothing" }) },
  );
  const row = only();
  assert.equal(row.status, "FAILED");
  assert.equal(row.error, "sweep returned nothing");
  assert.equal(run.ok, true, "the CONTROL FLOW is unchanged — `ok` means work() did not throw");
  assert.deepEqual(run.result, { outcome: "FAILED" }, "and the caller still receives its result");
});

test("a failed-by-assessment run KEEPS its payload — the diagnostic is the point", async () => {
  // failCronRun used to overwrite `result` with the build stamp or leave it null. On the
  // thrown path there is no payload to lose; on this path there is, and it is exactly what
  // an operator needs at 2am.
  const { withCronRun } = await load();
  await withCronRun(
    "inventory-sync-full",
    async () => ({ outcome: "FAILED" as const, numFound: 83_223, rawListings: 20, stopReason: "SHORT_PAGE" }),
    { assess: () => ({ failed: true, error: "short run" }) },
  );
  const row = only();
  assert.equal(row.status, "FAILED");
  assert.equal((row.result as Record<string, unknown>).numFound, 83_223);
  assert.equal((row.result as Record<string, unknown>).stopReason, "SHORT_PAGE");
});

test("an assessor reporting success records COMPLETED with its payload", async () => {
  const { withCronRun } = await load();
  await withCronRun("inventory-sync-full", async () => ({ outcome: "SUCCESS" as const, upserted: 412 }), {
    assess: () => ({ failed: false }),
  });
  const row = only();
  assert.equal(row.status, "COMPLETED");
  assert.equal((row.result as Record<string, unknown>).upserted, 412);
});

test("an assessor that THROWS does not turn a good run into a crash", async () => {
  const { withCronRun } = await load();
  const run = await withCronRun("inventory-sync-full", async () => ({ ok: 1 }), {
    assess: () => { throw new Error("assessor bug"); },
  });
  assert.equal(run.ok, true);
  assert.equal(only().status, "COMPLETED", "an assessor defect must not invent a failure either");
});

test("a THROWN run is still FAILED, unchanged", async () => {
  const { withCronRun } = await load();
  const run = await withCronRun("inventory-sync-full", async () => { throw new Error("boom"); }, {
    assess: () => ({ failed: false }),
  });
  assert.equal(run.ok, false);
  assert.equal(only().status, "FAILED", "the assessor never rescues a throw");
});

// ── assessSyncRun: which inventory outcomes are failures, and which are not ──

test("assessSyncRun classifies every outcome deliberately", async () => {
  const { assessSyncRun } = await import("@/lib/services/inventory/orchestrator");
  const base = {
    totalFetched: 0, totalAfterDedup: 0, upserted: 0, apiCallsUsed: 0,
    rooftopResolution: null, configSource: "row" as const, market: null,
    configuredSources: 1, attemptedSources: 1, adapterResults: [], healthScore: null,
    startedAt: new Date(0), completedAt: new Date(0),
  };
  const cases: Array<[string, boolean, string]> = [
    ["FAILED", true, "including a yield downgrade — the §26 E26-18 case"],
    ["PARTIAL", true, "a run that half-worked is not a green run"],
    ["DEFERRED", true, "recorded as failure BECAUSE it is transient: 191 individually excusable runs is what seven days of silence looked like"],
    ["BUDGET_EXHAUSTED", false, "we declined to spend; the cap did its job"],
    ["ZERO_RESULTS", false, "the provider answered and the market was empty"],
    ["NOT_CONFIGURED", false, "an ops config gap, not a health incident"],
    ["SUCCESS", false, ""],
  ];
  for (const [outcome, failed, why] of cases) {
    const v = assessSyncRun({ ...base, outcome } as never);
    assert.equal(v.failed, failed, `${outcome} should be failed=${failed}${why ? ` — ${why}` : ""}`);
  }
});

test("assessSyncRun names which adapter failed and why", async () => {
  const { assessSyncRun } = await import("@/lib/services/inventory/orchestrator");
  const v = assessSyncRun({
    outcome: "FAILED",
    adapterResults: [
      { adapter: "marketcheck", outcome: "FAILED", error: "short run: received 20 of 500 expected" },
      { adapter: "custom", outcome: "SUCCESS" },
    ],
  } as never);
  assert.equal(v.failed, true);
  assert.match(String(v.error), /marketcheck/);
  assert.match(String(v.error), /short run/);
  assert.doesNotMatch(String(v.error), /custom/, "a healthy source is not named as a cause");
});
