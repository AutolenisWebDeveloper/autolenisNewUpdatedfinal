// Behavioural coverage for cadence-aware failing-cron detection: the detector and
// the reporter, against a cron_job_logs fake that HONOURS the where-clause (the
// existing dead-cron.test.ts fake returns every row regardless of filter, which
// cannot show that a weekly cron's runs were outside the old window at all).
//
// Proof case, owner-verified: `social-market-index` is weekly and has failed
// 100% of its recorded runs. Its failures are days old, so the base 180-minute
// window never contained them and the streak could never reach 2.
//
// Run: pnpm test:monitoring

import test, { mock, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import type { FailedCronSignal } from "@/lib/services/monitoring/dead-cron.service";

type RunRow = { cronName: string; status: string; error: string | null; startedAt: Date };
type Where = { startedAt?: { gte?: Date }; cronName?: { in?: string[] } };

const state = {
  runRows: [] as RunRow[],
  recentTitles: new Set<string>(),
  createdNotifications: [] as Array<Record<string, unknown>>,
  /** Every where-clause the service issued, so the query shape itself is testable. */
  queries: [] as Where[],
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      cronJobLog: {
        groupBy: async () => [],
        findMany: async ({ where }: { where: Where }) => {
          state.queries.push(where);
          return state.runRows
            .filter((r) => {
              const gte = where?.startedAt?.gte;
              if (gte && r.startedAt.getTime() < gte.getTime()) return false;
              const names = where?.cronName?.in;
              if (names && !names.includes(r.cronName)) return false;
              return true;
            })
            .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
        },
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

const oncallCalls: Array<{ message: string }> = [];
mock.module("@/lib/observability/alert", {
  namedExports: {
    notifyOncall: (message: string) => oncallCalls.push({ message }),
    pageOnCall: () => {},
  },
});

const SERVICE = "@/lib/services/monitoring/dead-cron.service";
const NOW = new Date("2026-08-31T12:00:00.000Z");
const MIN = 60_000;
const DAY = 24 * 60;

const run = (
  cronName: string,
  status: string,
  minutesAgo: number,
  error: string | null = null,
): RunRow => ({ cronName, status, error, startedAt: new Date(NOW.getTime() - minutesAgo * MIN) });

beforeEach(() => {
  state.runRows = [];
  state.recentTitles = new Set<string>();
  state.createdNotifications = [];
  state.queries = [];
  oncallCalls.length = 0;
});

describe("a weekly cron failing 100% of its runs", () => {
  test("is detected, though its runs are days outside the base window", async () => {
    const { detectFailedCrons } = await import(SERVICE);
    // Two weekly failures, 1 and 8 days ago. The old 180-minute window contained
    // neither, so the cron produced no signal at all.
    state.runRows = [
      run("social-market-index", "FAILED", 1 * DAY, "Market index publish failed"),
      run("social-market-index", "FAILED", 8 * DAY, "Market index publish failed"),
    ];
    const s = (await detectFailedCrons(NOW)).find((x: FailedCronSignal) => x.cronName === "social-market-index");
    assert.ok(s, "weekly cron must produce a signal");
    assert.ok(s.consecutiveFailures >= 1);
    assert.equal(s.lastError, "Market index publish failed");
  });

  test("alerts on a SINGLE failed run", async () => {
    const { detectFailedCrons, reportFailedCrons } = await import(SERVICE);
    state.runRows = [run("social-market-index", "FAILED", 2 * DAY, "boom")];
    const signals = await detectFailedCrons(NOW);
    assert.equal(signals.length, 1);
    assert.equal(signals[0].consecutiveFailures, 1);

    const { alerted } = await reportFailedCrons(signals, NOW);
    assert.equal(alerted, 1, "one weekly failure must page");
    assert.equal(state.createdNotifications.length, 1);
    assert.match(String(state.createdNotifications[0].title), /social-market-index/);
    assert.equal(oncallCalls.length, 1);
  });

  test("the alert body states the threshold and the cadence", async () => {
    const { detectFailedCrons, reportFailedCrons } = await import(SERVICE);
    // A "1 run in a row" alert reads as noise unless it says why one is enough.
    state.runRows = [run("social-market-index", "FAILED", 2 * DAY, "boom")];
    await reportFailedCrons(await detectFailedCrons(NOW), NOW);
    const body = String(state.createdNotifications[0].body);
    assert.match(body, /failed 1 run\(s\) in a row/);
    assert.match(body, /alert threshold 1/);
    assert.match(body, /10080-minute cadence/);
  });

  test("a successful latest run clears it", async () => {
    const { detectFailedCrons } = await import(SERVICE);
    state.runRows = [
      run("social-market-index", "COMPLETED", 1 * DAY),
      run("social-market-index", "FAILED", 8 * DAY, "old"),
    ];
    const signals = await detectFailedCrons(NOW);
    assert.equal(signals.find((x: FailedCronSignal) => x.cronName === "social-market-index"), undefined);
  });

  test("a failure older than two cadences is not resurrected", async () => {
    const { detectFailedCrons } = await import(SERVICE);
    // 20 days back is outside the weekly cron's 14-day window: that is an
    // OVERDUE cron, which dead-cron detection owns, not a failing one.
    state.runRows = [run("social-market-index", "FAILED", 20 * DAY, "ancient")];
    assert.equal((await detectFailedCrons(NOW)).length, 0);
  });
});

describe("daily crons", () => {
  test("one failed run alerts", async () => {
    const { detectFailedCrons, reportFailedCrons } = await import(SERVICE);
    state.runRows = [run("prequal-sla-escalation", "FAILED", 6 * 60, "SLA sweep threw")];
    const { alerted } = await reportFailedCrons(await detectFailedCrons(NOW), NOW);
    assert.equal(alerted, 1);
  });
});

describe("fast crons keep their existing behaviour", () => {
  test("a single failure does NOT alert", async () => {
    const { detectFailedCrons, reportFailedCrons } = await import(SERVICE);
    // Regression guard: this fix must not start paging on transient blips for
    // the 33 crons the detector already served.
    state.runRows = [
      run("esign-artifact-reconcile", "FAILED", 3, "42703"),
      run("esign-artifact-reconcile", "COMPLETED", 8),
    ];
    const signals = await detectFailedCrons(NOW);
    assert.equal(signals[0].consecutiveFailures, 1);
    const { alerted } = await reportFailedCrons(signals, NOW);
    assert.equal(alerted, 0, "one failure on a 5-minute cron must not page");
  });

  test("two consecutive failures do alert", async () => {
    const { detectFailedCrons, reportFailedCrons } = await import(SERVICE);
    state.runRows = [
      run("esign-artifact-reconcile", "FAILED", 3, "42703"),
      run("esign-artifact-reconcile", "FAILED", 8, "42703"),
    ];
    const { alerted } = await reportFailedCrons(await detectFailedCrons(NOW), NOW);
    assert.equal(alerted, 1);
  });

  test("an in-flight RUNNING row no longer masks the streak behind it", async () => {
    const { detectFailedCrons } = await import(SERVICE);
    // This test previously asserted the opposite and was marked "known,
    // unchanged". The defect is now fixed: a 3-minute-old RUNNING row is still
    // within the platform ceiling, so its outcome is unknown and it is skipped —
    // the two real failures behind it stand.
    state.runRows = [
      run("esign-artifact-reconcile", "RUNNING", 3),
      run("esign-artifact-reconcile", "FAILED", 8, "42703"),
      run("esign-artifact-reconcile", "FAILED", 13, "42703"),
    ];
    const signals = await detectFailedCrons(NOW);
    assert.equal(signals.length, 1);
    assert.equal(signals[0].consecutiveFailures, 2);
    assert.equal(signals[0].lastError, "42703", "reports the newest COUNTED run");
  });
});

describe("query shape", () => {
  test("two bounded queries, not a per-cron fan-out", async () => {
    const { detectFailedCrons } = await import(SERVICE);
    // ~34 slow crons would otherwise mean ~34 round trips every 5-minute cycle.
    state.runRows = [run("social-market-index", "FAILED", 60)];
    await detectFailedCrons(NOW);
    assert.equal(state.queries.length, 2);
  });

  test("the second query is scoped to slow crons and reaches back further", async () => {
    const { detectFailedCrons } = await import(SERVICE);
    await detectFailedCrons(NOW);
    const [fast, slow] = state.queries;
    assert.equal(fast.cronName, undefined, "base query covers every cron");
    assert.ok(Array.isArray(slow.cronName?.in), "slow query is name-scoped");
    assert.ok(slow.cronName!.in!.includes("social-market-index"));
    assert.ok(!slow.cronName!.in!.includes("health-check"), "fast crons excluded");
    assert.ok(
      (slow.startedAt!.gte as Date).getTime() < (fast.startedAt!.gte as Date).getTime(),
      "slow window must reach further back than the base window",
    );
  });

  test("a run returned by both queries is counted once", async () => {
    const { detectFailedCrons } = await import(SERVICE);
    // A slow cron that happens to have run in the last 180 minutes appears in
    // both result sets; double-counting would inflate its streak.
    state.runRows = [run("social-market-index", "FAILED", 30, "boom")];
    const signals = await detectFailedCrons(NOW);
    assert.equal(signals[0].consecutiveFailures, 1, "must not be counted twice");
  });
});
