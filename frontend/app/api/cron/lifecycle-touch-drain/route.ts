// lifecycle-touch-drain — sends due lifecycle communications (internal parity for
// the 12 deferred QStash lifecycle-notification jobs: deposit-reminder,
// auction-active/-midpoint/-closing, dealer-invited, offer-received,
// offer-follow-up, deal-complete, form-submitted, check-form-completion,
// review-request).
//
// DORMANT until the owner-gated atomic cutover: nothing enqueues to
// `lifecycle_touch_schedule` yet (every lifecycle touch is still dispatched to
// QStash from its existing producer), so this cron no-ops (NO_DUE / NO_TABLE).
// Wired live now so monitoring proves it alive and the cutover is a producer
// swap, not a new deploy. Runs every 15 min — the multi-hour/-day touch delays
// make drain lateness irrelevant.

import { logger } from "@/lib/logger";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { NextRequest, NextResponse } from "next/server";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";
import { drainDueLifecycleTouches } from "@/lib/services/crm/lifecycle-touch-drain.service";

export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("lifecycle-touch-drain", () => drainDueLifecycleTouches());
  if (!run.ok) {
    return NextResponse.json({ success: false, error: "lifecycle_touch_drain_failed" }, { status: 500 });
  }
  logger.info("[lifecycle-touch-drain]", JSON.stringify(run.result));
  return NextResponse.json({ success: true, data: run.result });
}
