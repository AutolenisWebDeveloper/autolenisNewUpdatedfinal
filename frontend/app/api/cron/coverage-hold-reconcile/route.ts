// Y2 — coverage-hold release reconciler.
//
// Periodically re-runs the request-time coverage gate over currently soft-held,
// still-sourcing VehicleRequests. Each tick recruits the next bounded batch of
// prospect contacts (recruitOnThin) and clears any request whose coverage has
// recovered to >= MIN_COVERAGE_DEALERS. This is the release path and is fully
// self-healing — no manual owner touchpoint. Bounded per run; the remainder is
// picked up next tick. Safe to re-run: the gate is idempotent set-or-clear.

import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { reconcileCoverageHolds } from "@/lib/services/acquisition/request-coverage-gate.service";
import { reconcileRequestProgression } from "@/lib/services/vehicle-request/request-progression.service";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  // withCronRun records the run in CronJobLog (best-effort) and logs failures.
  // Two reconcilers, isolated: (1) advance SUBMITTED/INTAKE requests toward
  // ACTIVE_SOURCING (Batch 3 — the reliable driver behind the best-effort inline
  // advance); (2) release/refresh coverage soft-holds. Progression first, so a
  // freshly-advanced request's coverage flag is set the same tick.
  const run = await withCronRun("coverage-hold-reconcile", async () => {
    const progression = await reconcileRequestProgression();
    const holds = await reconcileCoverageHolds();
    return { progression, holds };
  });
  if (!run.ok) {
    return NextResponse.json({ success: false, error: "reconcile_failed" }, { status: 500 });
  }
  return NextResponse.json({ success: true, data: { ...run.result, timestamp: new Date().toISOString() } });
}
