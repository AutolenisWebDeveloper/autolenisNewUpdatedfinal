// Orphaned RUNNING rows.
//
// THE DEFECT
// startCronRun writes RUNNING and only completeCronRun/failCronRun move it, so a
// run killed mid-flight (maxDuration timeout, OOM, deploy) leaves RUNNING behind
// forever and nothing reaps it. The detector then read that row as "not a
// failure" and CLEARED the streak, exactly as a COMPLETED run does.
//
// Two silent consequences:
//   - a cron alternating FAILED / killed never reached a streak of 2;
//   - a cron killed on EVERY run has no FAILED rows at all, so it was invisible
//     here, while dead-cron detection read its fresh RUNNING row as proof of
//     life. Neither detector saw it.
//
// THE RULE
// RUNNING means "outcome unknown", never "succeeded". Past the platform's
// execution ceiling it means "this run died".
//
// Run: pnpm test:monitoring

import test, { mock, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

type RunRow = { cronName: string; status: string; error: string | null; startedAt: Date };
type Where = { startedAt?: { gte?: Date }; cronName?: { in?: string[] } };

const state = {
  runRows: [] as RunRow[],
  recentTitles: new Set<string>(),
  createdNotifications: [] as Array<Record<string, unknown>>,
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      cronJobLog: {
        groupBy: async () => [],
        findMany: async ({ where }: { where: Where }) =>
          state.runRows
            .filter((r) => {
              const gte = where?.startedAt?.gte;
              if (gte && r.startedAt.getTime() < gte.getTime()) return false;
              const names = where?.cronName?.in;
              if (names && !names.includes(r.cronName)) return false;
              return true;
            })
            .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime()),
      },
      notification: {
        findFirst: async ({ where }: { where: { title: string } }) =>
          state.recentTitles.has(where.title) ? { id: "existing" } : null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          state.createdNotifications.push(data);
          return { id: "notif_1", ...data };
        },
      },
    },
  },
});

mock.module("@/lib/observability/alert", {
  namedExports: { notifyOncall: () => {}, pageOnCall: () => {} },
});

const SERVICE = "@/lib/services/monitoring/dead-cron.service";
const NOW = new Date("2026-08-31T12:00:00.000Z");
const run = (
  cronName: string,
  status: string,
  minutesAgo: number,
  error: string | null = null,
): RunRow => ({ cronName, status, error, startedAt: new Date(NOW.getTime() - minutesAgo * 60_000) });

beforeEach(() => {
  state.runRows = [];
  state.recentTitles = new Set<string>();
  state.createdNotifications = [];
});

describe("the orphan bound", () => {
  test("is anchored to the platform execution ceiling, not a guess", async () => {
    const { ORPHANED_RUNNING_AFTER_MINUTES } = await import(SERVICE);
    // 300s is Vercel's maximum function duration and the highest maxDuration any
    // route in this repo declares; the bound is double it, for clock skew.
    assert.equal(ORPHANED_RUNNING_AFTER_MINUTES, 10);
    assert.ok(ORPHANED_RUNNING_AFTER_MINUTES >= (300 / 60) * 2);
  });

  test("classifies by age, and only RUNNING rows", async () => {
    const { isOrphanedRunning } = await import(SERVICE);
    assert.equal(isOrphanedRunning(run("x", "RUNNING", 11), NOW), true);
    assert.equal(isOrphanedRunning(run("x", "RUNNING", 9), NOW), false);
    assert.equal(isOrphanedRunning(run("x", "RUNNING", 10), NOW), false, "boundary is strict >");
    assert.equal(isOrphanedRunning(run("x", "FAILED", 999), NOW), false);
    assert.equal(isOrphanedRunning(run("x", "COMPLETED", 999), NOW), false);
  });
});

describe("a cron killed on every run", () => {
  test("is now detected — it has no FAILED rows at all", async () => {
    const { detectFailedCrons } = await import(SERVICE);
    // The worst case: every run times out. Pre-fix this produced NO signal here
    // (no FAILED rows) and read as alive to dead-cron detection.
    state.runRows = [
      run("esign-artifact-reconcile", "RUNNING", 12),
      run("esign-artifact-reconcile", "RUNNING", 17),
      run("esign-artifact-reconcile", "RUNNING", 22),
    ];
    const signals = await detectFailedCrons(NOW);
    assert.equal(signals.length, 1);
    assert.equal(signals[0].consecutiveFailures, 3);
    assert.equal(signals[0].abandonedRuns, 3);
  });

  test("alerts, and the body says the runs were killed rather than thrown", async () => {
    const { detectFailedCrons, reportFailedCrons } = await import(SERVICE);
    state.runRows = [
      run("esign-artifact-reconcile", "RUNNING", 12),
      run("esign-artifact-reconcile", "RUNNING", 17),
    ];
    const { alerted } = await reportFailedCrons(await detectFailedCrons(NOW), NOW);
    assert.equal(alerted, 1);
    const body = String(state.createdNotifications[0].body);
    // A timeout and a throwing handler need different debugging; the alert must
    // not present one as the other.
    assert.match(body, /started and never finished/);
    assert.match(body, /killed mid-flight/);
    assert.doesNotMatch(body, /failed 2 run\(s\) in a row \(/);
  });
});

describe("alternating failure and death", () => {
  test("no longer sits permanently below the threshold", async () => {
    const { detectFailedCrons, reportFailedCrons } = await import(SERVICE);
    // Pre-fix the orphaned RUNNING row cleared the streak on every scan, so this
    // cron never reached 2 and never alerted despite failing continuously.
    state.runRows = [
      run("esign-artifact-reconcile", "FAILED", 12, "boom"),
      run("esign-artifact-reconcile", "RUNNING", 17),
      run("esign-artifact-reconcile", "FAILED", 22, "boom"),
    ];
    const signals = await detectFailedCrons(NOW);
    assert.equal(signals[0].consecutiveFailures, 3);
    assert.equal(signals[0].abandonedRuns, 1);
    const { alerted } = await reportFailedCrons(signals, NOW);
    assert.equal(alerted, 1);
  });

  test("the mixed body names both causes", async () => {
    const { detectFailedCrons, reportFailedCrons } = await import(SERVICE);
    state.runRows = [
      run("esign-artifact-reconcile", "FAILED", 12, "boom"),
      run("esign-artifact-reconcile", "RUNNING", 17),
    ];
    await reportFailedCrons(await detectFailedCrons(NOW), NOW);
    assert.match(String(state.createdNotifications[0].body), /1 of which died mid-flight/);
  });
});

describe("what must NOT change", () => {
  test("a real success still clears the streak", async () => {
    const { detectFailedCrons } = await import(SERVICE);
    state.runRows = [
      run("esign-artifact-reconcile", "COMPLETED", 3),
      run("esign-artifact-reconcile", "FAILED", 8, "boom"),
      run("esign-artifact-reconcile", "FAILED", 13, "boom"),
    ];
    assert.equal((await detectFailedCrons(NOW)).length, 0);
  });

  test("an in-flight run does not by itself create a signal", async () => {
    const { detectFailedCrons } = await import(SERVICE);
    // A healthy cron mid-execution must stay silent. Skipping must not mean
    // inventing a failure.
    state.runRows = [
      run("esign-artifact-reconcile", "RUNNING", 2),
      run("esign-artifact-reconcile", "COMPLETED", 7),
    ];
    assert.equal((await detectFailedCrons(NOW)).length, 0);
  });

  test("a lone in-flight run is silent", async () => {
    const { detectFailedCrons } = await import(SERVICE);
    state.runRows = [run("esign-artifact-reconcile", "RUNNING", 2)];
    assert.equal((await detectFailedCrons(NOW)).length, 0);
  });

  test("lastError comes from the newest COUNTED run, not a skipped one", async () => {
    const { detectFailedCrons } = await import(SERVICE);
    state.runRows = [
      run("esign-artifact-reconcile", "RUNNING", 2),
      run("esign-artifact-reconcile", "FAILED", 8, "the real error"),
    ];
    const signals = await detectFailedCrons(NOW);
    assert.equal(signals[0].lastError, "the real error");
    assert.equal(signals[0].lastRunAt?.getTime(), run("x", "FAILED", 8).startedAt.getTime());
  });

  test("health-check can now report itself — its own row is RUNNING during the scan", async () => {
    const { detectFailedCrons } = await import(SERVICE);
    // detectFailedCrons executes inside the health cycle, so health-check's own
    // run is always RUNNING at scan time. Breaking on it meant health-check
    // could never be reported as failing, however many times it had failed.
    state.runRows = [
      run("health-check", "RUNNING", 0),
      run("health-check", "FAILED", 5, "boom"),
      run("health-check", "FAILED", 10, "boom"),
    ];
    const signals = await detectFailedCrons(NOW);
    assert.equal(signals[0]?.cronName, "health-check");
    assert.equal(signals[0].consecutiveFailures, 2);
  });
});

// The two operator-facing message forms — the compact one in the health report's
// alert list and the verbose one in the out-of-band notification body — describe
// the same three cases for two audiences. They are separate strings, so nothing
// but a test stops one from drifting into calling a mid-flight death a "failure"
// and sending the reader hunting for a FAILED row that was never written.
describe("the compact and verbose summaries agree", () => {
  const cases = [
    { name: "no abandoned runs", consecutiveFailures: 3, abandonedRuns: 0, mentionsDeath: false },
    { name: "every run abandoned", consecutiveFailures: 3, abandonedRuns: 3, mentionsDeath: true },
    { name: "some runs abandoned", consecutiveFailures: 3, abandonedRuns: 1, mentionsDeath: true },
    { name: "abandonedRuns absent", consecutiveFailures: 3, abandonedRuns: undefined, mentionsDeath: false },
  ];

  for (const c of cases) {
    test(`${c.name}: the compact summary ${c.mentionsDeath ? "names" : "does not name"} mid-flight death`, async () => {
      const { unsuccessfulRunSummary } = await import(SERVICE);
      const text = unsuccessfulRunSummary({
        cronName: "x",
        consecutiveFailures: c.consecutiveFailures,
        lastError: null,
        lastRunAt: null,
        abandonedRuns: c.abandonedRuns,
      });
      assert.equal(/mid-flight/.test(text), c.mentionsDeath, text);
      // Whatever the wording, the count an operator acts on is always present.
      assert.ok(text.includes(String(c.consecutiveFailures)), text);
      // "failed" may only be claimed when a run actually recorded a failure.
      if (c.abandonedRuns === c.consecutiveFailures) {
        assert.ok(!/failed/.test(text), `must not call a mid-flight death a failure: ${text}`);
      }
    });
  }
});
