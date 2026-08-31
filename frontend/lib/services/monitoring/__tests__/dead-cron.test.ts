// D3a — dead-cron detection + surfacing. detectDeadCrons() reads the latest run
// per cron (one groupBy) and classifies each registry entry. reportOverdueCrons()
// surfaces OVERDUE via (C) proactive push: an idempotent SYSTEM_ALERT Notification
// + notifyOncall — throttled so a persistently-dead cron does not re-page every
// 5-minute health tick. All writes are BEST-EFFORT: a DB hiccup must never throw.
//
// Run: pnpm test:monitoring

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ── controllable prisma fake ────────────────────────────────────────────────
type Group = { cronName: string; _max: { startedAt: Date | null } };
type RunRow = { cronName: string; status: string; error: string | null; startedAt: Date };
const state = {
  groups: [] as Group[],
  groupByThrows: false,
  // Recent cron_job_logs rows (DESC by startedAt) for detectFailedCrons.
  runRows: [] as RunRow[],
  findManyThrows: false,
  // Titles for which findFirst reports a recent alert already exists (per-cron
  // idempotency). "*" means every title has a recent alert.
  recentTitles: new Set<string>(),
  createdNotifications: [] as Array<Record<string, unknown>>,
  createThrows: false,
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      cronJobLog: {
        groupBy: async () => {
          if (state.groupByThrows) throw new Error("db down");
          return state.groups;
        },
        findMany: async () => {
          if (state.findManyThrows) throw new Error("db down");
          // Service sorts by startedAt DESC; honor the same order the DB would.
          return [...state.runRows].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
        },
      },
      notification: {
        findFirst: async ({ where }: { where: { title: string } }) => {
          if (state.recentTitles.has("*") || state.recentTitles.has(where.title)) {
            return { id: "existing" };
          }
          return null;
        },
        create: async ({ data }: { data: Record<string, unknown> }) => {
          if (state.createThrows) throw new Error("insert failed");
          state.createdNotifications.push(data);
          return { id: "notif_1", ...data };
        },
      },
    },
  },
});

const oncallCalls: Array<{ message: string; ctx: unknown }> = [];
mock.module("@/lib/observability/alert", {
  namedExports: {
    notifyOncall: (message: string, ctx: unknown) => oncallCalls.push({ message, ctx }),
    pageOnCall: () => {},
  },
});

const NOW = new Date("2026-08-19T12:00:00.000Z");

beforeEach(() => {
  state.groups = [];
  state.groupByThrows = false;
  state.runRows = [];
  state.findManyThrows = false;
  state.recentTitles = new Set<string>();
  state.createdNotifications = [];
  state.createThrows = false;
  oncallCalls.length = 0;
});

function run(cronName: string, status: string, minutesAgo: number, error: string | null = null): RunRow {
  return { cronName, status, error, startedAt: new Date(NOW.getTime() - minutesAgo * 60_000) };
}

test("detectDeadCrons classifies a fresh run as OK and a stale run as OVERDUE", async () => {
  const { detectDeadCrons } = await import("@/lib/services/monitoring/dead-cron.service");
  state.groups = [
    { cronName: "health-check", _max: { startedAt: new Date(NOW.getTime() - 3 * 60_000) } }, // 3m — OK
    { cronName: "auction-close", _max: { startedAt: new Date(NOW.getTime() - 90 * 60_000) } }, // 90m — overdue (maxAge 20m)
  ];
  const list = await detectDeadCrons(NOW);
  const byName = new Map(list.map((c) => [c.cronName, c]));
  assert.equal(byName.get("health-check")!.state, "OK");
  assert.equal(byName.get("auction-close")!.state, "OVERDUE");
  // a registry cron with no run row at all is NEVER_RUN
  assert.equal(byName.get("morning-briefing")!.state, "NEVER_RUN");
});

test("detectDeadCrons degrades to [] (never throws) when groupBy fails", async () => {
  const { detectDeadCrons } = await import("@/lib/services/monitoring/dead-cron.service");
  state.groupByThrows = true;
  const list = await detectDeadCrons(NOW);
  assert.deepEqual(list, []);
});

test("reportOverdueCrons raises one SYSTEM_ALERT + pages when none is recent", async () => {
  const { reportOverdueCrons } = await import("@/lib/services/monitoring/dead-cron.service");
  const overdue = [
    { cronName: "auction-close", state: "OVERDUE" as const, lastRunAt: NOW, ageMinutes: 90, maxAgeMinutes: 20 },
  ];
  const res = await reportOverdueCrons(overdue, NOW);
  assert.equal(res.alerted, 1);
  assert.equal(state.createdNotifications.length, 1);
  assert.equal(state.createdNotifications[0]!.type, "SYSTEM_ALERT");
  assert.equal(state.createdNotifications[0]!.title, "Dead cron: auction-close");
  assert.match(String(state.createdNotifications[0]!.body), /auction-close/);
  assert.equal(oncallCalls.length, 1, "on-call is notified");
});

test("reportOverdueCrons is per-cron idempotent — suppresses a cron with a recent alert", async () => {
  const { reportOverdueCrons } = await import("@/lib/services/monitoring/dead-cron.service");
  state.recentTitles = new Set(["*"]); // every cron already has a recent alert
  const overdue = [
    { cronName: "auction-close", state: "OVERDUE" as const, lastRunAt: NOW, ageMinutes: 90, maxAgeMinutes: 20 },
  ];
  const res = await reportOverdueCrons(overdue, NOW);
  assert.equal(res.alerted, 0);
  assert.equal(state.createdNotifications.length, 0, "no duplicate alert within the window");
  assert.equal(oncallCalls.length, 0, "no duplicate page");
});

test("a SECOND cron dying mid-window still alerts, even while the first's alert stands", async () => {
  const { reportOverdueCrons } = await import("@/lib/services/monitoring/dead-cron.service");
  // auction-close already alerted this window; health-check is newly overdue.
  state.recentTitles = new Set(["Dead cron: auction-close"]);
  const overdue = [
    { cronName: "auction-close", state: "OVERDUE" as const, lastRunAt: NOW, ageMinutes: 90, maxAgeMinutes: 20 },
    { cronName: "health-check", state: "OVERDUE" as const, lastRunAt: NOW, ageMinutes: 45, maxAgeMinutes: 20 },
  ];
  const res = await reportOverdueCrons(overdue, NOW);
  assert.equal(res.alerted, 1, "only the newly-dead cron pages");
  assert.equal(state.createdNotifications.length, 1);
  assert.equal(state.createdNotifications[0]!.title, "Dead cron: health-check");
  assert.equal(oncallCalls.length, 1);
  assert.match(String(oncallCalls[0]!.message), /health-check/);
});

test("reportOverdueCrons is a no-op when nothing is overdue", async () => {
  const { reportOverdueCrons } = await import("@/lib/services/monitoring/dead-cron.service");
  const res = await reportOverdueCrons([], NOW);
  assert.equal(res.alerted, 0);
  assert.equal(state.createdNotifications.length, 0);
});

test("reportOverdueCrons swallows a per-cron insert failure without blocking the others", async () => {
  const { reportOverdueCrons } = await import("@/lib/services/monitoring/dead-cron.service");
  state.createThrows = true;
  const overdue = [
    { cronName: "auction-close", state: "OVERDUE" as const, lastRunAt: NOW, ageMinutes: 90, maxAgeMinutes: 20 },
  ];
  const res = await reportOverdueCrons(overdue, NOW); // must not throw
  assert.equal(res.alerted, 0);
});

// ── Failing-cron detection (fired-but-threw blind spot) ──────────────────────

test("detectFailedCrons counts the trailing consecutive-FAILED streak per cron", async () => {
  const { detectFailedCrons } = await import("@/lib/services/monitoring/dead-cron.service");
  state.runRows = [
    // intake-reconcile: last two runs FAILED (streak 2), then a COMPLETED
    run("intake-reconcile", "FAILED", 5, "0 successes, 3 failures"),
    run("intake-reconcile", "FAILED", 10, "0 successes, 2 failures"),
    run("intake-reconcile", "COMPLETED", 15),
    // health-check: newest run COMPLETED → not failing (streak 0)
    run("health-check", "COMPLETED", 4),
    run("health-check", "FAILED", 9),
    // auction-close: single most-recent FAILED (streak 1, below paging threshold)
    run("auction-close", "FAILED", 6, "boom"),
    run("auction-close", "COMPLETED", 12),
  ];
  const failing = await detectFailedCrons(NOW);
  const byName = new Map(failing.map((c) => [c.cronName, c]));
  assert.equal(byName.get("intake-reconcile")!.consecutiveFailures, 2);
  assert.equal(byName.get("intake-reconcile")!.lastError, "0 successes, 3 failures");
  assert.equal(byName.get("auction-close")!.consecutiveFailures, 1);
  assert.equal(byName.has("health-check"), false, "a cron whose latest run COMPLETED is not failing");
});

// CORRECTED: this test previously asserted that ANY RUNNING row clears the
// streak, which pinned a defect. A run still in flight has an UNKNOWN outcome —
// it is not evidence of recovery — so it is now skipped rather than treated as a
// success. Two real failures behind it still meet the threshold. Under the old
// behaviour a cron failing every run went unreported whenever a scan happened to
// catch a fresh RUNNING row, which for a frequent cron is most of the time.
test("detectFailedCrons: an in-flight RUNNING run is skipped, not treated as recovery", async () => {
  const { detectFailedCrons } = await import("@/lib/services/monitoring/dead-cron.service");
  state.runRows = [
    run("sla-check", "RUNNING", 1),
    run("sla-check", "FAILED", 6),
    run("sla-check", "FAILED", 11),
  ];
  const failing = await detectFailedCrons(NOW);
  const s = failing.find((c) => c.cronName === "sla-check");
  assert.ok(s, "two real failures behind an in-flight run still report");
  assert.equal(s.consecutiveFailures, 2);
  assert.equal(s.abandonedRuns, 0, "the in-flight run is not counted as a failure");
});

test("detectFailedCrons: a COMPLETED latest run does clear the streak", async () => {
  // The legitimate clearing case, unchanged: a real success ends the streak.
  const { detectFailedCrons } = await import("@/lib/services/monitoring/dead-cron.service");
  state.runRows = [
    run("sla-check", "COMPLETED", 1),
    run("sla-check", "FAILED", 6),
    run("sla-check", "FAILED", 11),
  ];
  const failing = await detectFailedCrons(NOW);
  assert.equal(failing.find((c) => c.cronName === "sla-check"), undefined);
});

test("detectFailedCrons degrades to [] (never throws) when the query fails", async () => {
  const { detectFailedCrons } = await import("@/lib/services/monitoring/dead-cron.service");
  state.findManyThrows = true;
  assert.deepEqual(await detectFailedCrons(NOW), []);
});

test("reportFailedCrons pages only at/above the streak threshold, once per window", async () => {
  const { reportFailedCrons } = await import("@/lib/services/monitoring/dead-cron.service");
  const failing = [
    { cronName: "intake-reconcile", consecutiveFailures: 2, lastError: "0 successes", lastRunAt: NOW },
    { cronName: "auction-close", consecutiveFailures: 1, lastError: "one-off", lastRunAt: NOW }, // below threshold
  ];
  const res = await reportFailedCrons(failing, NOW);
  assert.equal(res.alerted, 1, "only the persistently-failing cron pages");
  assert.equal(state.createdNotifications.length, 1);
  assert.equal(state.createdNotifications[0]!.title, "Failing cron: intake-reconcile");
  assert.equal(state.createdNotifications[0]!.type, "SYSTEM_ALERT");
  assert.match(String(state.createdNotifications[0]!.body), /failed 2 run\(s\) in a row/);
  assert.equal(oncallCalls.length, 1);
});

test("reportFailedCrons is per-cron idempotent within the window", async () => {
  const { reportFailedCrons } = await import("@/lib/services/monitoring/dead-cron.service");
  state.recentTitles = new Set(["Failing cron: intake-reconcile"]);
  const failing = [{ cronName: "intake-reconcile", consecutiveFailures: 3, lastError: "x", lastRunAt: NOW }];
  const res = await reportFailedCrons(failing, NOW);
  assert.equal(res.alerted, 0);
  assert.equal(state.createdNotifications.length, 0);
});

test("reportFailedCrons never conflates with dead-cron alerts (distinct title namespace)", async () => {
  const { reportFailedCrons } = await import("@/lib/services/monitoring/dead-cron.service");
  // A dead-cron alert for the same cron does NOT suppress a failing-cron alert.
  state.recentTitles = new Set(["Dead cron: intake-reconcile"]);
  const failing = [{ cronName: "intake-reconcile", consecutiveFailures: 2, lastError: "x", lastRunAt: NOW }];
  const res = await reportFailedCrons(failing, NOW);
  assert.equal(res.alerted, 1, "distinct 'Failing cron:' title pages independently of a dead-cron alert");
});
