// amips-tier-f — daily Tier F threshold monitor.
//
// Runs daily at 07:00 UTC (see vercel.json). For every vehicle + metro that has
// crossed 50 completed AutoLenis transactions, it aggregates the verified
// metrics into autolenis_intelligence and seeds Tier F content-queue items the
// first time the combo qualifies — unlocking the proprietary, transaction-backed
// content moat. Page generation itself runs through the standard AMIPS generator
// cron, which re-checks the 50-transaction gate before publishing.
import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { runTierFThresholdMonitor } from "@/lib/amips/pipelines/tier-f-threshold.pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const result = await runTierFThresholdMonitor();
  logger.info(
    `[amips-cron] tier-f — over-threshold ${result.combosOverThreshold}, unlocked ${result.unlocked}, queued ${result.queueItemsSeeded}, aggregated ${result.aggregated}`,
  );
  return NextResponse.json({ success: true, data: result });
}
