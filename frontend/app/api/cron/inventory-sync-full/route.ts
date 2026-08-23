import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { runInventorySync } from "@/lib/services/inventory/orchestrator";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

// Cron: /api/cron/inventory-sync-full — Schedule: 0 */6 * * * (every 6 hours)
// Registered in vercel.json ✓

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
      deactivated: result.deactivated,
      healthScore: result.healthScore,
      adapters: result.adapterResults,
      duration: result.completedAt.getTime() - result.startedAt.getTime(),
    },
  });
}
