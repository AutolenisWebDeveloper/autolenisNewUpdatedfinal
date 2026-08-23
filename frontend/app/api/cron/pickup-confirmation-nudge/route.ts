// D2b — pickup confirmation SLA nudge cron.
//
// Hourly scan: if a dealer hasn't confirmed a buyer's PROPOSED pickup within the
// SLA, nudge the dealer; if a buyer hasn't accepted the dealer's DEALER_COUNTERED
// pickup within the SLA, nudge the buyer. One nudge per side per round (a marker
// column, reset on each new proposal). Bounded per run; safe to re-run.

import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { runPickupConfirmationNudges } from "@/lib/services/pickup/pickup-sla.service";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("pickup-confirmation-nudge", () => runPickupConfirmationNudges());
  if (!run.ok) {
    return NextResponse.json({ success: false, error: "nudge_failed" }, { status: 500 });
  }
  return NextResponse.json({ success: true, data: { ...run.result, timestamp: new Date().toISOString() } });
}
