// holds — deposit-hold reconciliation for closed auctions.
//
// IMPORTANT: This cron NO LONGER issues automatic refunds. The $99 Auction
// Access Deposit is never auto-refunded — it is retained even when an auction
// closes with no dealer offers, and remains refundable on request subject to
// manual review. Refunds are issued deliberately by an admin through the manual
// refund tools — never automatically here. This endpoint is retained as a no-op
// reconciler so any external cron schedule pointing at it stays valid without
// moving money.
import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

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
