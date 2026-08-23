// analytics-refresh — daily REFRESH MATERIALIZED VIEW for the funnel dashboard.
//
// Migrated off the Inngest cron `analyticsRefreshFn` onto the internal
// Vercel-Cron / application / Postgres substrate. Same RPC, same daily cadence
// (see vercel.json), same retry posture: a failed refresh throws so the cron is
// recorded FAILED (HTTP 500) and the next day's run replays the same data.

import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { NextRequest, NextResponse } from "next/server";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";
import { refreshAnalyticsViews } from "@/lib/services/analytics/analytics-refresh.service";

// REFRESH MATERIALIZED VIEW CONCURRENTLY grows with the contacts table; give it
// generous headroom so a large daily refresh isn't killed by the platform's
// default function timeout (the original ran as an unbounded Inngest step).
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("analytics-refresh", async () => refreshAnalyticsViews());

  if (!run.ok) {
    return NextResponse.json({ success: false, error: "analytics_refresh_failed" }, { status: 500 });
  }
  return NextResponse.json({ success: true, data: run.result });
}
