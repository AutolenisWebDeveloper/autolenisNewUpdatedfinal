// /api/cron/affiliate-digest — Monday weekly digest
// Cron schedule configured in vercel.json. Manually runnable via authenticated GET.

import { logger } from "@/lib/logger";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { NextRequest, NextResponse } from "next/server";
import { runWeeklyDigestBatch } from "@/lib/services/affiliate/digest.service";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

// Long-ish cron — up to 500 affiliates @ ~250ms each ≈ 2 minutes
export const maxDuration = 180;

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("affiliate-digest", () => runWeeklyDigestBatch(new Date()));
  if (!run.ok) return NextResponse.json({ success: false, error: "affiliate-digest_failed" }, { status: 500 });
  logger.info("[cron/affiliate-digest]", run.result);
  return NextResponse.json({
    success: true,
    data: {
      total: run.result.total,
      sent: run.result.sent,
      skipped: run.result.skipped,
      failed: run.result.failed,
      timestamp: new Date().toISOString(),
    },
  });
}
