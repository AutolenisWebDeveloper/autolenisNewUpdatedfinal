// W0-A — Deposit-activation reconciler cron.
// Closes the gap F-001 did NOT cover: F-001 reconciles auction *close*; this
// reconciles auction *activation*. Sweeps stranded paid deposits (no auction /
// PENDING / ACTIVE-with-zero-invitations) by STATE and converges each to a
// populated ACTIVE auction or a terminal CLOSED auction. The $99 deposit is a
// non-refundable access fee and is never auto-refunded. Idempotent + serialized,
// so a missed/slow tick self-heals and overlapping runs never double-act.

import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { reconcileStuckActivations } from "@/lib/services/auction/deposit-activation.service";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const run = await withCronRun("deposit-activation-reconcile", () => reconcileStuckActivations());
  if (!run.ok) {
    return NextResponse.json({ success: false, error: "RECONCILE_FAILED" }, { status: 500 });
  }
  if (run.result.scanned > 0) {
    logger.info(`[deposit-activation-reconcile] ${JSON.stringify(run.result)}`);
  }
  return NextResponse.json({ success: true, data: run.result });
}
