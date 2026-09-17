// D2b — pickup confirmation SLA nudge cron.
//
// Hourly scan: if a dealer hasn't confirmed a buyer's PROPOSED pickup within the
// SLA, nudge the dealer; if a buyer hasn't accepted the dealer's DEALER_COUNTERED
// pickup within the SLA, nudge the buyer. One nudge per side per round (a marker
// column, reset on each new proposal). Bounded per run; safe to re-run.

import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { runPickupConfirmationNudges } from "@/lib/services/pickup/pickup-sla.service";
import { sweepAppointmentReminders } from "@/lib/services/pickup/pickup-reminders.service";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  // TWO SWEEPS, ONE JOB, and the second is §Stage 17's — "The existing job chases proposal
  // responses, not appointment reminders." It does now. The 24h/2h appointment reminders and the
  // missed-pickup suspicion are folded in here rather than given a cron of their own: identical
  // subject, identical hourly cadence, and a second scheduled entry is a second thing that can
  // stop running without anybody noticing. Same choice `dealer-invitation-reminder` made for its
  // token-expiry sweep.
  //
  // THE REMINDERS RUN EVEN IF THE NUDGES THROW. They are unrelated rails and a buyer travelling
  // tomorrow should not lose their reminder because a proposal nudge failed.
  const run = await withCronRun("pickup-confirmation-nudge", async () => {
    const results = await Promise.allSettled([runPickupConfirmationNudges(), sweepAppointmentReminders()]);
    const [nudges, reminders] = results;
    if (nudges.status === "rejected" && reminders.status === "rejected") {
      throw nudges.reason;
    }
    return {
      ...(nudges.status === "fulfilled" ? nudges.value : { nudgeError: String(nudges.reason) }),
      ...(reminders.status === "fulfilled" ? reminders.value : { reminderError: String(reminders.reason) }),
    };
  });
  if (!run.ok) {
    return NextResponse.json({ success: false, error: "nudge_failed" }, { status: 500 });
  }
  return NextResponse.json({ success: true, data: { ...run.result, timestamp: new Date().toISOString() } });
}
