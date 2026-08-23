// health-check — runs every 5 minutes
import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { runHealthCheckCycle } from "@/lib/services/monitoring/health.service";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  // The cycle computes health, detects dead crons, persists the report, and runs
  // the throttled retention purge. withCronRun records this run in CronJobLog.
  const run = await withCronRun("health-check", () => runHealthCheckCycle());
  if (!run.ok) {
    return NextResponse.json({ success: false, error: String(run.error) }, { status: 500 });
  }
  return NextResponse.json({ success: true, data: run.result.report });
}
