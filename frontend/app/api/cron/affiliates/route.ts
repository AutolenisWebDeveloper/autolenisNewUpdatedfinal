// affiliates — process pending commissions hourly
import { NextRequest, NextResponse } from "next/server";

// P2-4 (review) — the cursor-paged approval (≤10k rows, one Stripe read per
// unique PI) can run for minutes on a backlog; without this the platform
// default kills the function mid-run and every run red-flags. Same convention
// as affiliate-digest/affiliate-inactive; the service also stops batching
// short of this deadline so a partial run completes cleanly.
export const maxDuration = 300;
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { approveMaturePendingCommissions } from "@/lib/services/affiliate/commission.service";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("affiliates", async () => {
    // M2: approval follows the money, not the calendar — ≥7 days old AND the
    // fee charge is verifiably not refunded/disputed (read from Stripe; the
    // webhook refund path is unreachable in production, M16) AND the deal is
    // not CANCELLED/REFUNDED. Unverifiable state stays PENDING (fail closed).
    return approveMaturePendingCommissions();
  });
  if (!run.ok) return NextResponse.json({ success: false, error: "affiliates_failed" }, { status: 500 });

  return NextResponse.json({ success: true, data: { ...run.result, timestamp: new Date().toISOString() } });
}
