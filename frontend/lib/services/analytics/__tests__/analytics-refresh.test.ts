// Unit tests for refreshAnalyticsViews — the analytics-matview refresh migrated
// off the Inngest `analyticsRefreshFn` onto the internal Vercel-Cron substrate.
// Pins: calls the refresh_analytics_views RPC; returns OK on success; throws on
// an RPC error (so withCronRun records the cron FAILED and the next run replays).
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/analytics/__tests__/analytics-refresh.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

let rpcCalls: string[] = [];
let rpcError: { message: string } | null = null;

mock.module("@/lib/supabase-service", {
  namedExports: {
    getServiceSupabase: () => ({
      rpc: async (name: string) => {
        rpcCalls.push(name);
        return { error: rpcError };
      },
    }),
  },
});

async function loadService() {
  return import("@/lib/services/analytics/analytics-refresh.service");
}

beforeEach(() => {
  rpcCalls = [];
  rpcError = null;
});

test("invokes the refresh_analytics_views RPC and returns OK", async () => {
  const { refreshAnalyticsViews } = await loadService();
  const result = await refreshAnalyticsViews();
  assert.deepEqual(rpcCalls, ["refresh_analytics_views"]);
  assert.equal(result.status, "OK");
  assert.equal(typeof result.refreshed_at, "string");
});

test("throws when the RPC returns an error", async () => {
  rpcError = { message: "deadlock detected" };
  const { refreshAnalyticsViews } = await loadService();
  await assert.rejects(() => refreshAnalyticsViews(), /analytics_refresh_failed: deadlock detected/);
  assert.deepEqual(rpcCalls, ["refresh_analytics_views"]);
});
