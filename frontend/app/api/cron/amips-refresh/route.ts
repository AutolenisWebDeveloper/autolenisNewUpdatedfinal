// AMIPS — refresh cron.
//
// Closes the loop lifecycle review opens. amips-lifecycle demotes pages to
// REFRESH_REQUIRED when their data ages out; nothing promoted back, and the
// source pipelines that would make the data newer ran only when an admin
// clicked. This refreshes those sources on a schedule and re-opens the pages
// the refresh rescued, letting amips-generate regenerate them properly rather
// than back-dating a freshness claim onto an unchanged body.
//
// Scheduled 03:00 UTC daily: after amips-snapshot (02:00) so the snapshot
// records the pre-refresh state, and before the first amips-generate run
// (06:00) so anything re-opened here is regenerated the same morning.

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";
import { runAmipsRefresh } from "@/lib/amips/refresh.service";

export const dynamic = "force-dynamic";
// Both source pipelines declare maxDuration 120 on their admin routes and run
// sequentially here, plus the candidate queries.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("amips-refresh", async () => runAmipsRefresh());

  if (!run.ok) {
    logger.error("[amips-refresh] failed:", run.error);
    return NextResponse.json({ success: false, error: "REFRESH_FAILED" }, { status: 500 });
  }
  return NextResponse.json({ success: true, ...run.result });
}
