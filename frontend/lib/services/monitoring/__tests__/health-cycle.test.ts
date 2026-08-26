// D3a — health-check persistence, retention purge throttle, and dead-cron
// fold-in. persistHealthReport writes ONE HealthCheckLog row per cycle (folding
// contractFails/integrations into the alerts array — no schema column for them).
// maybeRunRetentionPurge runs AT MOST once/day (guarded on hour-of-day) even
// though health-check ticks every 5 minutes. All writes are best-effort.
//
// Run: pnpm test:monitoring

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

type Deleted = { count: number };
const state = {
  healthCreated: [] as Array<Record<string, unknown>>,
  healthCreateThrows: false,
  healthDeleteWhere: [] as unknown[],
  cronDeleteWhere: [] as unknown[],
  healthDeletedCount: 4,
  cronDeletedCount: 7,
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      healthCheckLog: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          if (state.healthCreateThrows) throw new Error("insert failed");
          state.healthCreated.push(data);
          return { id: "hc_1", ...data };
        },
        deleteMany: async ({ where }: { where: unknown }): Promise<Deleted> => {
          state.healthDeleteWhere.push(where);
          return { count: state.healthDeletedCount };
        },
      },
      cronJobLog: {
        deleteMany: async ({ where }: { where: unknown }): Promise<Deleted> => {
          state.cronDeleteWhere.push(where);
          return { count: state.cronDeletedCount };
        },
      },
    },
  },
});

beforeEach(() => {
  state.healthCreated = [];
  state.healthCreateThrows = false;
  state.healthDeleteWhere = [];
  state.cronDeleteWhere = [];
});

const baseReport = {
  status: "healthy" as const,
  database: true,
  inventoryHealth: 96,
  activeAuctions: 3,
  pendingOFAC: 0,
  contractFails: 2,
  integrations: { stripe: true, resend: true, microbilt: true },
  alerts: [],
  timestamp: new Date("2026-08-19T12:00:00.000Z"),
};

test("persistHealthReport writes one HealthCheckLog row with the core columns + alerts", async () => {
  const { persistHealthReport } = await import("@/lib/services/monitoring/health.service");
  await persistHealthReport(baseReport);
  assert.equal(state.healthCreated.length, 1);
  const row = state.healthCreated[0]!;
  assert.equal(row.status, "healthy");
  assert.equal(row.database, true);
  assert.equal(row.inventoryHealth, 96);
  assert.equal(row.activeAuctions, 3);
  assert.equal(row.pendingOFAC, 0);
  assert.ok(Array.isArray(row.alerts));
});

test("persistHealthReport swallows a write failure (best-effort, never throws)", async () => {
  const { persistHealthReport } = await import("@/lib/services/monitoring/health.service");
  state.healthCreateThrows = true;
  await persistHealthReport(baseReport); // must not throw
  assert.equal(state.healthCreated.length, 0);
});

test("maybeRunRetentionPurge purges both log tables at the daily purge hour", async () => {
  const { maybeRunRetentionPurge } = await import("@/lib/services/monitoring/health.service");
  const at0300 = new Date("2026-08-19T03:00:00.000Z");
  const res = await maybeRunRetentionPurge(at0300);
  assert.equal(res.purged, true);
  assert.equal(res.healthDeleted, state.healthDeletedCount);
  assert.equal(res.cronDeleted, state.cronDeletedCount);
  assert.equal(state.healthDeleteWhere.length, 1);
  assert.equal(state.cronDeleteWhere.length, 1);
});

test("maybeRunRetentionPurge is throttled — no purge outside the purge hour", async () => {
  const { maybeRunRetentionPurge } = await import("@/lib/services/monitoring/health.service");
  const at1200 = new Date("2026-08-19T12:00:00.000Z");
  const res = await maybeRunRetentionPurge(at1200);
  assert.equal(res.purged, false);
  assert.equal(state.healthDeleteWhere.length, 0);
  assert.equal(state.cronDeleteWhere.length, 0);
});

test("maybeRunRetentionPurge only fires on the FIRST tick of the purge hour", async () => {
  const { maybeRunRetentionPurge } = await import("@/lib/services/monitoring/health.service");
  // health-check runs every 5m; a later tick in the same hour must not re-purge.
  const at0305 = new Date("2026-08-19T03:05:00.000Z");
  const res = await maybeRunRetentionPurge(at0305);
  assert.equal(res.purged, false, "second tick of the purge hour is throttled out");
});
