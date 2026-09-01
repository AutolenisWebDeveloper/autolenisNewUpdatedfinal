import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { captureIntelligenceSnapshot } from "@/lib/amips/intelligence/executive-intelligence";
import { reportStalenessRunway } from "@/lib/amips/staleness-runway.service";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Daily — capture a point-in-time snapshot of the executive-intelligence rollup
// so the Market Intelligence Center can show genuine day/week trend deltas.
//
// Also carries the staleness-runway signal. This cron hosts it because it is the
// only DAILY AMIPS job: the runway is a countdown to a single-day cliff, so
// weekly resolution (amips-lifecycle) could report "7 days left" and not fire
// again until after the cliff had passed. No new cron is added — that would be a
// schedule change, which is out of scope.
export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("amips-snapshot", async () => {
    const snapshot = await captureIntelligenceSnapshot();
    // Escalation happens inside reportStalenessRunway (platform alert +
    // notifyOncall); the figures ride out in the cron result JSONB so the
    // countdown is queryable from cron_job_logs without a new table.
    //
    // This reads the servable corpus a second time — captureIntelligenceSnapshot
    // already computes a runway for the dashboard payload. Accepted rather than
    // plumbed through: it is one indexed read of ~400 rows over four small
    // columns, once a day, and keeping reportStalenessRunway self-contained is
    // what lets it be called from anywhere without threading state.
    const stalenessRunway = await reportStalenessRunway();
    return { id: snapshot.id, healthScore: snapshot.healthScore, stalenessRunway };
  });
  if (!run.ok) {
    return NextResponse.json(
      { success: false, error: (run.error as Error).message },
      { status: 200 },
    );
  }

  return NextResponse.json({
    success: true,
    data: run.result,
  });
}
