// holds — §10c vehicle-hold expiry and the §Stage 10 24-hour reaffirmation window.
//
// REPURPOSED, NOT REPLACED — §13-D26, ruled. What this route did before:
//
//   const run = await withCronRun("holds", async () => {
//     return { released: 0, autoRefundsDisabled: true };   // no-op deposit-hold reconciler
//   });
//
// It was a documented no-op, retained so an external schedule pointing at it stayed valid. The
// deposit-hold reconciliation it was named for stopped existing when automatic refunds were
// removed — the $99 is never auto-refunded and is released deliberately by an admin through the
// manual refund tools.
//
// EVERY REFERENCE TO IT WAS ENUMERATED BEFORE REPURPOSING, and there were three: this file,
// `vercel.json:44` (`*/10 * * * *`), and `lib/services/monitoring/cron-schedule.ts:52`
// (`intervalMinutes: 10`). NOTHING read its return shape — no test, no health check, no alert, no
// dashboard, no `CronJobLog` consumer keyed on `released` or `autoRefundsDisabled`. The dead-cron
// monitor watches it BY NAME, so keeping the name keeps its heartbeat intact. Deleting it and
// adding `vehicle-hold-expire` would have cost a `vercel.json` change and a registry change for
// nothing, and would have needed the §35 scope guard to declare a new route family.
//
// WHAT IT DOES NOW, both halves of §Stage 10's clock:
//
//   §10c  "If the contract has not been requested before the hold expires, the dealership is asked
//          to extend or release." The predicate is the CONTRACT REQUEST, not the date alone — a
//          deal already at CONTRACT_PENDING or beyond has passed the point the hold protects.
//   §10   "Within 24 hours, the winning dealership confirms." A window that closes with no answer
//          returns the buyer to the remaining valid offers, with a scorecard entry and — on a
//          repeat inside §13-D42's 90-day window — an SLA violation.
//
// THE 12-HOUR REMINDER IS NOT HERE, deliberately. It is enqueued at Stage 10's opening with a
// future `runAt` and the deal's cancel key (`dealer-reaffirmation.service.openReaffirmation`), so
// it is durable in the outbox rather than dependent on this cron having run. A reminder a cron
// forgot is a reminder nobody sent; a row that already exists cannot be forgotten.
//
// IT STILL MOVES NO MONEY. That was the one property worth preserving from the no-op, and it is
// preserved by construction: nothing below touches a deposit, a payment intent or a refund.
import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";
import {
  sweepExpiringHolds,
  expireOverdueReaffirmations,
} from "@/lib/services/deal/dealer-reaffirmation.service";

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("holds", async () => {
    const now = new Date();
    // Ordered: expire the 24-hour windows FIRST. A reaffirmation that times out stands the deal
    // down and closes the firewall, and a hold notice sent to a buyer whose deal has just been
    // returned to the remaining offers would contradict the notice they are about to receive.
    const reaffirmations = await expireOverdueReaffirmations(now);
    const holds = await sweepExpiringHolds(now);
    return {
      reaffirmationsTimedOut: reaffirmations.expired,
      holdsExpiring: holds.expiring,
      holdsExpired: holds.expired,
      // No automatic refunds are initiated. Deposits remain charged.
      autoRefundsDisabled: true,
    };
  });
  if (!run.ok) return NextResponse.json({ success: false, error: "holds_failed" }, { status: 500 });
  return NextResponse.json({
    success: true,
    data: { ...run.result, timestamp: new Date().toISOString() },
  });
}
