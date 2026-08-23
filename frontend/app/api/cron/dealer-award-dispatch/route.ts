// dealer-award-dispatch — dispatches winner-award + non-award close-out
// notifications for newly offer-accepted deals.
//
// Migrated off the Inngest worker `dealerAwardFn` (`autolenis/dealer.award`) onto
// the internal Vercel-Cron / Postgres substrate. select-offer creates the Deal
// with the winning offerId; this cron scans deals whose dealerAwardDispatchedAt
// marker is NULL and dispatches via emitDealerAwardOutcomes, then stamps the
// marker. Runs every minute for timely (≤1-min) award notification.

import { logger } from "@/lib/logger";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { NextRequest, NextResponse } from "next/server";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";
import { drainDealerAwardDispatch } from "@/lib/services/deal/dealer-award-dispatch.service";

// Each deal can send several emails (winner + every other bidder); give headroom.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("dealer-award-dispatch", () => drainDealerAwardDispatch());
  if (!run.ok) {
    return NextResponse.json({ success: false, error: "dealer_award_dispatch_failed" }, { status: 500 });
  }
  logger.info("[dealer-award-dispatch]", JSON.stringify(run.result));
  return NextResponse.json({ success: true, data: run.result });
}
