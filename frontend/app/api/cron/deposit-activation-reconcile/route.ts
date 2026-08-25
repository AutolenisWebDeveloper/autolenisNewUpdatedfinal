// W0-A — Deposit-activation reconciler cron.
// Closes the gap F-001 did NOT cover: F-001 reconciles auction *close*; this
// reconciles auction *activation*. Sweeps stranded paid deposits (no auction /
// PENDING / ACTIVE-with-zero-invitations) by STATE and converges each to a
// populated ACTIVE auction or a terminal CLOSED auction. The $99 Auction Access
// Deposit is never auto-refunded (refundable on request, subject to manual
// review). Idempotent + serialized,
// so a missed/slow tick self-heals and overlapping runs never double-act.

import { logger } from "@/lib/logger";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { NextRequest, NextResponse } from "next/server";
import { reconcileStuckActivations } from "@/lib/services/auction/deposit-activation.service";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("deposit-activation-reconcile", () => reconcileStuckActivations());
  if (!run.ok) {
    return NextResponse.json({ success: false, error: "RECONCILE_FAILED" }, { status: 500 });
  }
  if (run.result.scanned > 0) {
    logger.info(`[deposit-activation-reconcile] ${JSON.stringify(run.result)}`);
  }
  return NextResponse.json({ success: true, data: run.result });
}
