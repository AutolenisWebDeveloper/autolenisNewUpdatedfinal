// D2b — pickup confirmation SLA nudge cron.
//
// Hourly scan: if a dealer hasn't confirmed a buyer's PROPOSED pickup within the
// SLA, nudge the dealer; if a buyer hasn't accepted the dealer's DEALER_COUNTERED
// pickup within the SLA, nudge the buyer. One nudge per side per round (a marker
// column, reset on each new proposal). Bounded per run; safe to re-run.

import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { runPickupConfirmationNudges } from "@/lib/services/pickup/pickup-sla.service";
import {
  sweepAppointmentReminders,
  flagSuspectedNoShows,
  sweepReleasedNotConfirmed,
} from "@/lib/services/pickup/pickup-reminders.service";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";
import { logger } from "@/lib/logger";

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
    // PHASE 10 — TWO SWEEPS JOIN, AND ONE OF THEM WAS DEAD CODE.
    //
    // `flagSuspectedNoShows` has existed since Phase 9, raises §26's PICKUP_MISSED, and
    // HAD NO CALLER ANYWHERE. It was exported, tested, documented — and unreachable, so
    // the exception it exists to raise could never fire in production. Found by §8.3's
    // completeness work, and it is the reason that gate's own header now records what it
    // cannot see: a raise site proves a code CAN be raised, not that anything calls it.
    //
    // `sweepReleasedNotConfirmed` is new and is §26's "Dealer released, buyer has not
    // confirmed | Operations | Remind buyer; never complete automatically".
    //
    // Folded in here rather than given crons of their own, for the reason this file
    // already gives: identical subject, identical cadence, and a second scheduled entry
    // is a second thing that can stop running without anybody noticing.
    const results = await Promise.allSettled([
      runPickupConfirmationNudges(),
      sweepAppointmentReminders(),
      flagSuspectedNoShows(),
      sweepReleasedNotConfirmed(),
    ]);
    const [nudges, reminders, noShows, unconfirmed] = results;

    // Same rule as the two rails below: an independent sweep must not take the others
    // down, and a rejection is LOGGED rather than left as a string in a 200 response.
    if (noShows.status === "rejected") {
      logger.error("[cron/pickup-confirmation-nudge] no-show sweep failed:", noShows.reason);
    }
    if (unconfirmed.status === "rejected") {
      logger.error("[cron/pickup-confirmation-nudge] released-not-confirmed sweep failed:", unconfirmed.reason);
    }
    if (nudges.status === "rejected" && reminders.status === "rejected") {
      throw nudges.reason;
    }
    // A HALF THAT REJECTED IS LOGGED, not merely stringified into the payload. Only BOTH
    // rejecting throws, which is deliberate — one rail must not take the other down. But the
    // surviving half returned `run.ok`, so the response was HTTP 200 `success: true` and the
    // failure existed solely as a `nudgeError`/`reminderError` string inside the body. A
    // permanently broken reminder sweep was invisible to cron monitoring, which is the exact
    // failure mode the comment above ("a second thing that can stop running without anybody
    // noticing") gives as the reason for folding the sweeps into one job.
    if (nudges.status === "rejected") {
      logger.error("[cron/pickup-confirmation-nudge] proposal-nudge sweep failed:", nudges.reason);
    }
    if (reminders.status === "rejected") {
      logger.error("[cron/pickup-confirmation-nudge] appointment-reminder sweep failed:", reminders.reason);
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
