import { NextRequest, NextResponse } from "next/server";
import { runInventorySync } from "@/lib/services/inventory/orchestrator";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

// Cron: /api/cron/inventory-sync-full — Schedule: 0 */6 * * * (every 6 hours)
// Registered in vercel.json ✓

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

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
