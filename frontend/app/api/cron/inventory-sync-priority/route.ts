import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { runInventorySync } from "@/lib/services/inventory/orchestrator";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

// Cron: /api/cron/inventory-sync-priority — Schedule: 0 * * * * (every hour)
// Registered in vercel.json ✓

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("inventory-sync-priority", () => runInventorySync({}, "priority"));
  if (!run.ok) return NextResponse.json({ success: false, error: String(run.error) }, { status: 500 });

  return NextResponse.json({ success: true, data: { upserted: run.result.upserted, healthScore: run.result.healthScore } });
}
