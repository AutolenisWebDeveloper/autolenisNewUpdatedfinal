// D2b — pickup confirmation SLA nudge cron.
//
// Hourly scan: if a dealer hasn't confirmed a buyer's PROPOSED pickup within the
// SLA, nudge the dealer; if a buyer hasn't accepted the dealer's DEALER_COUNTERED
// pickup within the SLA, nudge the buyer. One nudge per side per round (a marker
// column, reset on each new proposal). Bounded per run; safe to re-run.

import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { runPickupConfirmationNudges } from "@/lib/services/pickup/pickup-sla.service";

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const result = await runPickupConfirmationNudges();
    return NextResponse.json({ success: true, data: { ...result, timestamp: new Date().toISOString() } });
  } catch (err) {
    logger.error("[pickup-confirmation-nudge] failed:", err);
    return NextResponse.json({ success: false, error: "nudge_failed" }, { status: 500 });
  }
}
