// holds — deposit-hold reconciliation for closed auctions.
//
// IMPORTANT: This cron NO LONGER issues automatic refunds. The $99 Auction
// Access Deposit is a non-refundable access fee and is retained even when an
// auction closes with no dealer offers. Refunds, if ever warranted, are issued
// deliberately by an admin through the manual refund tools — never automatically
// here. This endpoint is retained as a no-op reconciler so any external cron
// schedule pointing at it stays valid without moving money.
import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const run = await withCronRun("holds", async () => {
    // No automatic refunds are initiated. Deposits remain charged.
    return { released: 0, autoRefundsDisabled: true };
  });
  if (!run.ok) return NextResponse.json({ success: false, error: "holds_failed" }, { status: 500 });
  return NextResponse.json({
    success: true,
    data: { ...run.result, timestamp: new Date().toISOString() },
  });
}
