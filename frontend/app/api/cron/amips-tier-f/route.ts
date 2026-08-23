// amips-tier-f — daily Tier F threshold monitor.
//
// Runs daily at 07:00 UTC (see vercel.json). For every vehicle + metro that has
// crossed 50 completed AutoLenis transactions, it aggregates the verified
// metrics into autolenis_intelligence and seeds Tier F content-queue items the
// first time the combo qualifies — unlocking the proprietary, transaction-backed
// content moat. Page generation itself runs through the standard AMIPS generator
// cron, which re-checks the 50-transaction gate before publishing.
import { logger } from "@/lib/logger";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { NextRequest, NextResponse } from "next/server";
import { runTierFThresholdMonitor } from "@/lib/amips/pipelines/tier-f-threshold.pipeline";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("amips-tier-f", async () => {
  const result = await runTierFThresholdMonitor();
  logger.info(
    `[amips-cron] tier-f — over-threshold ${result.combosOverThreshold}, unlocked ${result.unlocked}, queued ${result.queueItemsSeeded}, aggregated ${result.aggregated}`,
  );
  return result;
  });
  if (!run.ok) return NextResponse.json({ success: false, error: "amips-tier-f_failed" }, { status: 500 });

  return NextResponse.json({ success: true, data: run.result });
}
