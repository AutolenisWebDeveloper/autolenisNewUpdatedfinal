// Social Engine — Cron: AutoLenis Market Index (weekly LinkedIn newsletter).
// Generates the weekly market intelligence report, publishes it to the
// AutoLenis LinkedIn company page, records it as a SocialPost, and emails the
// admin. Schedule: 0 12 * * 1 (Monday 07:00 CT).

import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";
import { publishMarketIndex } from "@/lib/social/market-index.generator";

// Groq report generation dominates the runtime.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const run = await withCronRun("social-market-index", () => publishMarketIndex());
  if (!run.ok) {
    return NextResponse.json(
      { success: false, error: "Market index publish failed" },
      { status: 500 },
    );
  }
  return NextResponse.json({ success: true, data: run.result });
}
