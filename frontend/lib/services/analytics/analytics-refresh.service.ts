// Analytics matview refresh — internal Vercel-Cron substrate (migrated off the
// retired Inngest `analyticsRefreshFn`). The lifecycle funnel dashboard reads
// mv_funnel_metrics; the matview is refreshed daily via the `refresh_analytics_views`
// RPC (REFRESH MATERIALIZED VIEW CONCURRENTLY — non-blocking for concurrent
// dashboard reads, and a no-op replay when no rows changed, so it is safe to run
// at any cadence).
//
// This is the exact RPC the admin manual-refresh route already calls
// (app/api/admin/operations/analytics/refresh/route.ts). On failure it throws so
// withCronRun records the cron FAILED (HTTP 500) and the next scheduled run picks
// up the same data — matching the Inngest retry posture (no dead-letter).

import { getServiceSupabase } from "@/lib/supabase-service";

export interface AnalyticsRefreshResult {
  status: "OK";
  refreshed_at: string;
}

export async function refreshAnalyticsViews(): Promise<AnalyticsRefreshResult> {
  const supabase = getServiceSupabase();
  const { error } = await supabase.rpc("refresh_analytics_views");
  if (error) {
    throw new Error(`analytics_refresh_failed: ${error.message}`);
  }
  return { status: "OK", refreshed_at: new Date().toISOString() };
}
