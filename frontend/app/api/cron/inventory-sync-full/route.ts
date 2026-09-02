import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { runInventorySync } from "@/lib/services/inventory/orchestrator";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

// Cron: /api/cron/inventory-sync-full — Schedule: 0 8 * * * (once daily, 08:00 UTC)
// Registered in vercel.json ✓ and CRON_STALENESS ✓
//
// THE ONLY SCHEDULED MARKETCHECK SPENDER. One run makes at most 10 calls x 50 rows = 500
// listings, which is MarketCheck's own deep-paging ceiling — a second daily run could not
// reach any listing the first did not; it would re-fetch the same 500 at double the cost.
//
// It used to run every 6 hours alongside an hourly `inventory-sync-priority`, 28 calls/day
// against a 500/month plan. That produced 191 consecutive runs answered "HTTP 429: Too Many
// Requests" (2026-08-24 .. 2026-08-31) behind a catalogue that had silently frozen.
//
// 08:00 UTC is ~02:00-03:00 America/Chicago — off-peak for the DFW market being swept, and
// clear of the 09:00 UTC cron cluster.

// A 10-page walk with a 250ms inter-call gap plus up to 500 upserts needs more than the
// platform default. The adapter's own 90s deadline stops the walk well inside this.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("inventory-sync-full", () => runInventorySync({}, "full"));
  if (!run.ok) return NextResponse.json({ success: false, error: String(run.error) }, { status: 500 });

  const result = run.result;
  return NextResponse.json({
    success: true,
    data: {
      fetched: result.totalFetched,
      deduped: result.totalAfterDedup,
      upserted: result.upserted,
      // Spend evidence. `apiCallsUsed` is the number the monthly cap is spent against, and
      // `market` / `configSource` are the cheapest proof the sweep queried the market it was
      // configured for rather than falling back — the failure mode that made every row in
      // production a New York listing.
      apiCallsUsed: result.apiCallsUsed,
      configSource: result.configSource,
      market: result.market,
      outcome: result.outcome,
      healthScore: result.healthScore,
      adapters: result.adapterResults,
      duration: result.completedAt.getTime() - result.startedAt.getTime(),
    },
  });
}
