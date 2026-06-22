// W0-A — Deposit-activation reconciler cron.
// Closes the gap F-001 did NOT cover: F-001 reconciles auction *close*; this
// reconciles auction *activation*. Sweeps stranded paid deposits (no auction /
// PENDING / ACTIVE-with-zero-invitations) by STATE and converges each to a
// populated ACTIVE auction or an automatic refund. Idempotent + serialized, so
// a missed/slow tick self-heals and overlapping runs never double-act.

import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { reconcileStuckActivations } from "@/lib/services/auction/deposit-activation.service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const result = await reconcileStuckActivations();
    if (result.scanned > 0) {
      logger.info(`[deposit-activation-reconcile] ${JSON.stringify(result)}`);
    }
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    logger.error("[deposit-activation-reconcile] failed:", err);
    return NextResponse.json({ success: false, error: "RECONCILE_FAILED" }, { status: 500 });
  }
}
