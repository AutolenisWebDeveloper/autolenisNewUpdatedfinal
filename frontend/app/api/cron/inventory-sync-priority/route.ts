import { NextRequest, NextResponse } from "next/server";
import { runInventorySync } from "@/lib/services/inventory/orchestrator";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

// Cron: /api/cron/inventory-sync-priority — Schedule: 0 * * * * (every hour)
// Registered in vercel.json ✓

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const run = await withCronRun("inventory-sync-priority", () => runInventorySync({}, "priority"));
  if (!run.ok) return NextResponse.json({ success: false, error: String(run.error) }, { status: 500 });

  return NextResponse.json({ success: true, data: { upserted: run.result.upserted, healthScore: run.result.healthScore } });
}
