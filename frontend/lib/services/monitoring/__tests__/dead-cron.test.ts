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
const state = {
  groups: [] as Group[],
  groupByThrows: false,
  recentNotification: null as { id: string } | null,
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
      },
      notification: {
        findFirst: async () => state.recentNotification,
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
  state.recentNotification = null;
  state.createdNotifications = [];
  state.createThrows = false;
  oncallCalls.length = 0;
});

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
  assert.equal(res.alerted, true);
  assert.equal(state.createdNotifications.length, 1);
  assert.equal(state.createdNotifications[0]!.type, "SYSTEM_ALERT");
  assert.match(String(state.createdNotifications[0]!.body), /auction-close/);
  assert.equal(oncallCalls.length, 1, "on-call is notified");
});

test("reportOverdueCrons is idempotent — suppresses when a recent alert exists", async () => {
  const { reportOverdueCrons } = await import("@/lib/services/monitoring/dead-cron.service");
  state.recentNotification = { id: "existing" };
  const overdue = [
    { cronName: "auction-close", state: "OVERDUE" as const, lastRunAt: NOW, ageMinutes: 90, maxAgeMinutes: 20 },
  ];
  const res = await reportOverdueCrons(overdue, NOW);
  assert.equal(res.alerted, false);
  assert.equal(state.createdNotifications.length, 0, "no duplicate alert within the window");
  assert.equal(oncallCalls.length, 0, "no duplicate page");
});

test("reportOverdueCrons is a no-op when nothing is overdue", async () => {
  const { reportOverdueCrons } = await import("@/lib/services/monitoring/dead-cron.service");
  const res = await reportOverdueCrons([], NOW);
  assert.equal(res.alerted, false);
  assert.equal(state.createdNotifications.length, 0);
});

test("reportOverdueCrons swallows a notification insert failure (best-effort)", async () => {
  const { reportOverdueCrons } = await import("@/lib/services/monitoring/dead-cron.service");
  state.createThrows = true;
  const overdue = [
    { cronName: "auction-close", state: "OVERDUE" as const, lastRunAt: NOW, ageMinutes: 90, maxAgeMinutes: 20 },
  ];
  const res = await reportOverdueCrons(overdue, NOW); // must not throw
  assert.equal(res.alerted, false);
});
