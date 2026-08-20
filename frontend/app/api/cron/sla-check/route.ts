// sla-check — runs every 30 minutes
import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { checkSLAs } from "@/lib/services/monitoring/health.service";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const run = await withCronRun("sla-check", () => checkSLAs());
  if (!run.ok) return NextResponse.json({ success: false, error: "sla-check_failed" }, { status: 500 });
  return NextResponse.json({ success: true, data: { ...run.result, timestamp: new Date().toISOString() } });
}
