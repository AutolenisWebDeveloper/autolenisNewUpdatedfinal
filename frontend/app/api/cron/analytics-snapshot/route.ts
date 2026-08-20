// analytics-snapshot — daily platform stats snapshot + funnel observability (S5)
import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { snapshotPlatformStats } from "@/lib/services/analytics/analytics.service";
import { snapshotAndAlertFunnel } from "@/lib/services/analytics/funnel-observability.service";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const run = await withCronRun("analytics-snapshot", async () => {
  await snapshotPlatformStats();
  // S5 — derive-by-snapshot funnel counters + drop-off / no-match / zero-offer
  // alerts, on the same daily cadence (no new cron).
  const funnel = await snapshotAndAlertFunnel();
  return { snapshot: true, funnel };
  });
  if (!run.ok) return NextResponse.json({ success: false, error: "analytics-snapshot_failed" }, { status: 500 });

  return NextResponse.json({
    success: true,
    data: { ...run.result, timestamp: new Date().toISOString() },
  });
}
