import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { refreshMatchesForActiveRequests } from "@/lib/services/inventory/request-inventory-match.service";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

// Cron: /api/cron/inventory-match-refresh — Schedule: 30 */6 * * * (every 6h, after sync)
// Batch 1: recompute canonical VehicleRequestMatchResult rows for every non-terminal
// request against current executable supply. Read + match + persist only — no comms,
// no money, no offer/deposit/deal side effects. The CronJobLog result payload records
// the truthful roll-up (matched / zeroMatches / noSupply / skipped / failed) so an
// operator can distinguish "matched", "zero matches", "no executable supply", and
// "matching execution failed" at a glance.
// Registered in vercel.json ✓ and CRON_STALENESS ✓

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("inventory-match-refresh", () => refreshMatchesForActiveRequests());
  if (!run.ok) return NextResponse.json({ success: false, error: String(run.error) }, { status: 500 });

  return NextResponse.json({ success: true, data: run.result });
}
