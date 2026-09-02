import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { runInventorySync } from "@/lib/services/inventory/orchestrator";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

// DELIBERATELY UNSCHEDULED. Not in vercel.json, and not in CRON_STALENESS — a registry
// entry with no schedule goes OVERDUE and pages an operator nightly.
//
// WHY IT WAS DE-SCHEDULED. This route and inventory-sync-full both called
// runInventorySync({}, mode) with an IDENTICAL empty params object: same adapter, same
// query, same market, differing only in a row count that the adapter clamped to the same
// value for both. There was no priority scope — no per-request geography, no priority
// queue, no distinct market. It was a strictly-smaller prefix of the daily sweep, running
// hourly at 24 provider calls/day (~730/month, 146% of the entire 500/month plan on its
// own) and contributing to 191 consecutive HTTP 429 runs in 2026-08.
//
// WHY THE ROUTE SURVIVES. It is the manual re-run lever: cron-secret gated, and now
// budget-gated to exactly ONE call (mode "priority" grants 1, never the 10-page sweep), so
// an operator can force a re-check after fixing config without waiting for 08:00 UTC.

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("inventory-sync-priority", () => runInventorySync({}, "priority"));
  if (!run.ok) return NextResponse.json({ success: false, error: String(run.error) }, { status: 500 });

  return NextResponse.json({ success: true, data: { upserted: run.result.upserted, healthScore: run.result.healthScore } });
}
