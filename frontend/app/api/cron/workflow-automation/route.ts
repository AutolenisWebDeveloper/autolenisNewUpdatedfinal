// workflow-automation — runs every 5 minutes
// Nudge engine, deal risk updates, deal-stuck detection

import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { runNudgeEngine } from "@/lib/services/nudge/nudge.service";
import { updateAllDealRisks } from "@/lib/services/deal/deal-risk.service";

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const [nudged, risksUpdated] = await Promise.all([
    runNudgeEngine().catch(e => { logger.error("Nudge engine error:", e); return 0; }),
    updateAllDealRisks().catch(e => { logger.error("Risk update error:", e); return 0; }),
  ]);

  return NextResponse.json({ success: true, data: { nudged, risksUpdated, timestamp: new Date().toISOString() } });
}
