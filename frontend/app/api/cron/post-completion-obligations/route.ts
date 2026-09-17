// §Stage 21's overdue sweep — the only thing in Phase 9 that runs after a Deal is COMPLETED.
//
// DAILY, NOT HOURLY, AND THAT IS THE DOCUMENT'S CADENCE RATHER THAN A COMPROMISE. Obligations
// are due in days — a title in thirty, a trade payoff in ten — so an hourly scan would find the
// same nothing twenty-three extra times and shave, at best, part of a day off a notice about a
// thirty-day deadline.
//
// WHY IT IS NOT FOLDED INTO `pickup-confirmation-nudge`, which is where the appointment
// reminders went. That cron is the PICKUP SLA rail and its subject is an appointment that has
// not happened yet; this one's subject is a transaction that is finished. Sharing a job would
// mean a failure in one masking the other in `cron_runs`, and §Stage 21's whole premise is that
// these obligations are tracked WITHOUT touching the completed deal — including, here, without
// sharing its machinery.

import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";
import { sweepOverdueObligations } from "@/lib/services/deal/post-completion-obligations.service";

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("post-completion-obligations", () => sweepOverdueObligations());
  if (!run.ok) {
    return NextResponse.json({ success: false, error: "obligation_sweep_failed" }, { status: 500 });
  }
  return NextResponse.json({
    success: true,
    data: { ...run.result, timestamp: new Date().toISOString() },
  });
}
