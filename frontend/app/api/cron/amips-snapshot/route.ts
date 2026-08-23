import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { captureIntelligenceSnapshot } from "@/lib/amips/intelligence/executive-intelligence";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Daily — capture a point-in-time snapshot of the executive-intelligence rollup
// so the Market Intelligence Center can show genuine day/week trend deltas.
export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("amips-snapshot", async () => {
    const snapshot = await captureIntelligenceSnapshot();
    return { id: snapshot.id, healthScore: snapshot.healthScore };
  });
  if (!run.ok) {
    return NextResponse.json(
      { success: false, error: (run.error as Error).message },
      { status: 200 },
    );
  }

  return NextResponse.json({
    success: true,
    data: run.result,
  });
}
