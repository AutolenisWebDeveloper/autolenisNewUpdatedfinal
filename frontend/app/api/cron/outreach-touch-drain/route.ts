// outreach-touch-drain — sends due non-deal outreach touches (internal parity for
// the QStash `affiliate-inactive` / `affiliate-reengagement-2` / `referral-nudge`
// notification jobs).
//
// DORMANT until the owner-gated atomic cutover: nothing enqueues to
// `outreach_touch_schedule` yet (those touches are still dispatched to QStash from
// the `cron/affiliate-inactive` Vercel cron and the `review-request` job), so this
// cron no-ops (NO_DUE / NO_TABLE). Wired live now so monitoring proves it alive
// and the cutover is a producer swap, not a new deploy. The multi-day delays make
// ≤15-min drain lateness irrelevant.

import { logger } from "@/lib/logger";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { NextRequest, NextResponse } from "next/server";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";
import { drainDueOutreachTouches } from "@/lib/services/crm/outreach-touch-drain.service";

export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("outreach-touch-drain", () => drainDueOutreachTouches());
  if (!run.ok) {
    return NextResponse.json({ success: false, error: "outreach_touch_drain_failed" }, { status: 500 });
  }
  logger.info("[outreach-touch-drain]", JSON.stringify(run.result));
  return NextResponse.json({ success: true, data: run.result });
}
