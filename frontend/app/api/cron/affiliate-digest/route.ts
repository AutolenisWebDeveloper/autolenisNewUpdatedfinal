// /api/cron/affiliate-digest — Monday weekly digest
// Cron schedule configured in vercel.json. Manually runnable via authenticated GET.

import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { runWeeklyDigestBatch } from "@/lib/services/affiliate/digest.service";

// Long-ish cron — up to 500 affiliates @ ~250ms each ≈ 2 minutes
export const maxDuration = 180;

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const summary = await runWeeklyDigestBatch(new Date());
  // eslint-disable-next-line no-console
  console.log("[cron/affiliate-digest]", summary);
  return NextResponse.json({
    success: true,
    data: {
      total: summary.total,
      sent: summary.sent,
      skipped: summary.skipped,
      failed: summary.failed,
      timestamp: new Date().toISOString(),
    },
  });
}
