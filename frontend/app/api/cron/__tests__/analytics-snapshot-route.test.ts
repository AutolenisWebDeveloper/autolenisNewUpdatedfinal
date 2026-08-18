// S5 — analytics-snapshot cron now also drives funnel observability on the same
// daily cadence (no new cron). Pins: cron auth is enforced BEFORE any work; both
// the platform-stats snapshot and the funnel snapshot/alert pass run; the funnel
// result is surfaced in the response.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks "app/api/cron/__tests__/analytics-snapshot-route.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

let platformSnapshotCalls = 0;
let funnelCalls = 0;

mock.module("@/lib/services/analytics/analytics.service", {
  namedExports: {
    snapshotPlatformStats: async () => {
      platformSnapshotCalls += 1;
    },
  },
});

mock.module("@/lib/services/analytics/funnel-observability.service", {
  namedExports: {
    snapshotAndAlertFunnel: async () => {
      funnelCalls += 1;
      return { snapshotted: 8, alerts: 1 };
    },
  },
});

async function loadGET() {
  const mod = await import("@/app/api/cron/analytics-snapshot/route");
  return mod.GET;
}

function req(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/cron/analytics-snapshot", { headers });
}

beforeEach(() => {
  platformSnapshotCalls = 0;
  funnelCalls = 0;
  process.env.CRON_SECRET = "test-secret";
});

test("rejects unauthorized requests without running any snapshot", async () => {
  const GET = await loadGET();
  const res = await GET(req());
  assert.equal(res.status, 401);
  assert.equal(platformSnapshotCalls, 0);
  assert.equal(funnelCalls, 0);
});

test("accepts the Vercel cron header and runs BOTH the stats + funnel passes", async () => {
  const GET = await loadGET();
  const res = await GET(req({ "x-vercel-cron": "1" }));
  assert.equal(res.status, 200);
  assert.equal(platformSnapshotCalls, 1);
  assert.equal(funnelCalls, 1);

  const body = (await res.json()) as { success: boolean; data: { funnel: unknown } };
  assert.equal(body.success, true);
  assert.deepEqual(body.data.funnel, { snapshotted: 8, alerts: 1 });
});

test("accepts the bearer secret", async () => {
  const GET = await loadGET();
  const res = await GET(req({ authorization: "Bearer test-secret" }));
  assert.equal(res.status, 200);
  assert.equal(funnelCalls, 1);
});
