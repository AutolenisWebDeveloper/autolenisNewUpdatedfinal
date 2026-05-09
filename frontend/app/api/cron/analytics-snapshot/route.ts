// analytics-snapshot — daily platform stats snapshot
import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { snapshotPlatformStats } from "@/lib/services/analytics/analytics.service";

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  await snapshotPlatformStats();
  return NextResponse.json({ success: true, data: { snapshot: true, timestamp: new Date().toISOString() } });
}
