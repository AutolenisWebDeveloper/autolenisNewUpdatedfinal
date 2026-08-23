// sla-check — runs every 30 minutes
import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { checkSLAs } from "@/lib/services/monitoring/health.service";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("sla-check", () => checkSLAs());
  if (!run.ok) return NextResponse.json({ success: false, error: "sla-check_failed" }, { status: 500 });
  return NextResponse.json({ success: true, data: { ...run.result, timestamp: new Date().toISOString() } });
}
