// The ONE dealer reminder rail — §Stage 7's 50% and 90% of the window.
//
// WHAT THIS ROUTE USED TO BE, AND WHY THE REPLACEMENT IS A BUG FIX. It reminded dealerships
// once, in a 5h–7h-to-deadline window, through the direct Resend rail. Two other rails did the
// same job at other times: QStash `dealer-invited` → `dealer-bid-reminder` at +24h and +42h
// (SMS and email, and already unreachable from the scheduler), and `/api/cron/auction-close`
// every five minutes for every auction ending within 2h.
//
// THE THREE DID NOT MERELY OVERLAP — TWO OF THEM CANCELLED EACH OTHER. This route and
// `auction-close` both called `sendDealerAuctionReminderEmail`, whose idempotency key is
// `dealer-auction-reminder-${auctionId}-${to}` (`resend.service.ts:1671`). This one fires first
// at ~6h out and marks the key SENT, so every `auction-close` reminder then returns DUPLICATE
// (`:200-202`) and is never delivered — and because DUPLICATE is a resolved value rather than a
// rejection, the `.catch(() => {})` at `auction-close/route.ts:90` could not see it. The ≤2h
// "submit your offer" notice, the one with the most bid-conversion value, has never reached any
// dealership that received the 6h one.
//
// Three further defects went with it: the window was a fixed offset, so an auction whose
// `endsAt` was overridden (the admin route accepts 1–168h) got reminders at the wrong moments
// or none; `respondedAt` was selected (`:48`) and never used, so declined and bounced
// dealerships were chased anyway; and `auction-close` interpolated `vehicleYear: 0` with an
// empty make and model straight into the subject line.
//
// `sweepInvitationReminders` replaces all three: fractions of the real window, reminders only to
// nonresponders, per-invitation idempotency through the `reminder50SentAt`/`reminder90SentAt`
// columns the Phase 1 wave provisioned and nothing ever wrote, and delivery through the §27
// dispatcher — which applies the FULL suppression tier, honours an unsubscribe, and carries a
// working one-click opt-out header.
//
// THE TOKEN EXPIRY SWEEP STAYS HERE. It was folded into this cron deliberately rather than given
// a job of its own, and it is unrelated to the reminder rail.

import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";
import { expireStaleInvitations } from "@/lib/services/dealer-recruitment/invitation-token.service";
import { sweepInvitationReminders } from "@/lib/services/auction/auction-invitation.service";

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("dealer-invitation-reminder", async () => {
    const now = new Date();

    // §Stage 7's 50%/90% schedule, for every ACTIVE auction, across BOTH pools.
    const reminders = await sweepInvitationReminders(undefined, now);

    // Unchanged: invitations whose TTL elapsed. Expiry used to be applied only lazily, when
    // someone happened to hit the token, which left PENDING rows sitting past their
    // `expiresAt` indefinitely.
    const invitationsExpired = await expireStaleInvitations(now);

    return {
      now: now.toISOString(),
      invitationsExpired,
      auctionsConsidered: reminders.auctionsConsidered,
      remindersEnqueued50: reminders.enqueued50,
      remindersEnqueued90: reminders.enqueued90,
      remindersSkipped: reminders.skipped,
    };
  });
  if (!run.ok) {
    return NextResponse.json({ success: false, error: "dealer-invitation-reminder_failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: run.result });
}
