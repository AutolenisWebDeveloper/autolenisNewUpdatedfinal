// Y2 — coverage-hold release reconciler.
//
// Periodically re-runs the request-time coverage gate over currently soft-held,
// still-sourcing VehicleRequests. Each tick recruits the next bounded batch of
// prospect contacts (recruitOnThin) and clears any request whose coverage has
// recovered to >= MIN_COVERAGE_DEALERS. This is the release path and is fully
// self-healing — no manual owner touchpoint. Bounded per run; the remainder is
// picked up next tick. Safe to re-run: the gate is idempotent set-or-clear.

import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { reconcileCoverageHolds } from "@/lib/services/acquisition/request-coverage-gate.service";

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const result = await reconcileCoverageHolds();
    return NextResponse.json({ success: true, data: { ...result, timestamp: new Date().toISOString() } });
  } catch (err) {
    logger.error("[coverage-hold-reconcile] failed:", err);
    return NextResponse.json({ success: false, error: "reconcile_failed" }, { status: 500 });
  }
}
