// D3a — runHealthCheckCycle orchestration. Pins the order-sensitive contract that
// the isolated persist/purge tests can't: OVERDUE cron alerts are folded into
// report.alerts BEFORE the report is persisted, and a throwing dead-cron detection
// stays best-effort (the cycle still computes + persists the health report).
//
// Run: pnpm test:monitoring

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const persisted: Array<Record<string, unknown>> = [];

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      $queryRaw: async () => [{ ok: 1 }],
      auction: { count: async () => 0 },
      preQualification: { count: async () => 0 },
      contractScan: { count: async () => 0 },
      inventoryItem: { count: async () => 0 },
      healthCheckLog: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          persisted.push(data);
          return { id: "hc_1", ...data };
        },
        deleteMany: async () => ({ count: 0 }),
      },
      cronJobLog: { deleteMany: async () => ({ count: 0 }) },
    },
  },
});

mock.module("@/lib/stripe", {
  namedExports: { getStripe: () => ({ balance: { retrieve: async () => ({}) } }) },
});

const deadCronState = {
  detect: [] as unknown[],
  detectThrows: false,
  reportCalls: [] as unknown[],
};

mock.module("@/lib/services/monitoring/dead-cron.service", {
  namedExports: {
    detectDeadCrons: async () => {
      if (deadCronState.detectThrows) throw new Error("groupBy exploded");
      return deadCronState.detect;
    },
    overdueCrons: (list: Array<{ state: string }>) => list.filter((c) => c.state === "OVERDUE"),
    reportOverdueCrons: async (overdue: unknown) => {
      deadCronState.reportCalls.push(overdue);
      return { alerted: 0 };
    },
  },
});

// Noon UTC → the retention purge is throttled out, so this exercises only the
// detect → fold → persist path.
const NOON = new Date("2026-08-19T12:00:00.000Z");

beforeEach(() => {
  persisted.length = 0;
  deadCronState.detect = [];
  deadCronState.detectThrows = false;
  deadCronState.reportCalls = [];
});

test("folds OVERDUE cron alerts into the report BEFORE persisting it", async () => {
  const { runHealthCheckCycle } = await import("@/lib/services/monitoring/health.service");
  deadCronState.detect = [
    { cronName: "health-check", state: "OVERDUE", lastRunAt: NOON, ageMinutes: 45, maxAgeMinutes: 20 },
  ];
  const { report, deadCrons } = await runHealthCheckCycle(NOON);

  // The overdue string is in the returned report AND in the single persisted row.
  const overdueAlert = report.alerts.find((a) => a.includes("health-check") && a.includes("overdue"));
  assert.ok(overdueAlert, "overdue alert folded into report.alerts");
  assert.equal(persisted.length, 1, "persisted exactly once");
  const persistedAlerts = persisted[0]!.alerts as string[];
  assert.ok(
    persistedAlerts.some((a) => a.includes("health-check") && a.includes("overdue")),
    "the persisted alerts include the overdue cron (fold happened before persist)",
  );
  assert.equal(deadCrons.length, 1);
  assert.equal(deadCronState.reportCalls.length, 1, "proactive push invoked once");
});

test("a throwing dead-cron detection stays best-effort — the cycle still persists", async () => {
  const { runHealthCheckCycle } = await import("@/lib/services/monitoring/health.service");
  deadCronState.detectThrows = true;
  const { report, deadCrons } = await runHealthCheckCycle(NOON); // must not throw
  assert.equal(deadCrons.length, 0, "detection degraded to []");
  assert.equal(persisted.length, 1, "health report still persisted");
  assert.equal(report.status, "healthy");
});
