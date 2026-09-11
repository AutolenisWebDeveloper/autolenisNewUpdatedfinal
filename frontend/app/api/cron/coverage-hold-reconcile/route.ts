// Y2 — coverage-hold release reconciler.
//
// Periodically re-runs the request-time coverage gate over currently soft-held,
// still-sourcing VehicleRequests. Each tick recruits the next bounded batch of
// prospect contacts (recruitOnThin) and clears any request whose coverage has
// recovered to >= MIN_COVERAGE_DEALERS. This is the release path and is fully
// self-healing — no manual owner touchpoint. Bounded per run; the remainder is
// picked up next tick. Safe to re-run: the gate is idempotent set-or-clear.

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { reconcileCoverageHolds } from "@/lib/services/acquisition/request-coverage-gate.service";
import { reconcileRequestProgression } from "@/lib/services/vehicle-request/request-progression.service";
import { sweepSourcingCases } from "@/lib/services/sourcing/sourcing-driver.service";
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
    // Isolated: a failure in one reconciler must not skip the other this tick.
    const progression = await reconcileRequestProgression().catch((err) => {
      logger.error("[coverage-hold-reconcile] progression failed:", err);
      return { error: String(err) };
    });
    const holds = await reconcileCoverageHolds().catch((err) => {
      logger.error("[coverage-hold-reconcile] holds failed:", err);
      return { error: String(err) };
    });
    // (3) Phase 5 — advance every open sourcing case one rung of the §6a ladder, and hand a
    // ready case to the §7 readiness check. S6-34b names this tick rather than a new cron:
    // the ladder then advances on the same clock as the progression and hold reconcilers,
    // which is also what drives the 14-day abandonment close.
    //
    // NO-OP WHILE SOURCING_CASE_REPLACES_AUCTION_LAUNCH IS OFF (the default). §13-D52 is the
    // owner's, and with the flag off the legacy path is still the only thing that creates and
    // invites — running both would put two auctions on one deposit, which
    // `Auction.depositId @unique` would refuse on a buyer's paid request.
    const sourcing = await sweepSourcingCases().catch((err) => {
      logger.error("[coverage-hold-reconcile] sourcing sweep failed:", err);
      return { error: String(err) };
    });
    return { progression, holds, sourcing };
  });
  if (!run.ok) {
    return NextResponse.json({ success: false, error: "reconcile_failed" }, { status: 500 });
  }
  return NextResponse.json({ success: true, data: { ...run.result, timestamp: new Date().toISOString() } });
}
