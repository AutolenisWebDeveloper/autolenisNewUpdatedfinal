// refinance-outreach-drain — sends due refinance-outreach touches (internal
// parity for the QStash `/api/jobs/refinance-outreach` job).
//
// DORMANT until the owner-gated atomic cutover: nothing enqueues to
// `refinance_outreach_schedule` yet (the touch is still dispatched to QStash from
// the `review-request` job), so this cron no-ops (NO_DUE / NO_TABLE). It is wired
// live now so monitoring proves it alive and the cutover is a one-line producer
// swap, not a new deploy. The 60-day delay makes ≤15-min drain lateness
// irrelevant.

import { logger } from "@/lib/logger";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { NextRequest, NextResponse } from "next/server";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";
import { drainDueRefinanceOutreach } from "@/lib/services/refinance/refinance-outreach-drain.service";

export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("refinance-outreach-drain", () => drainDueRefinanceOutreach());
  if (!run.ok) {
    return NextResponse.json({ success: false, error: "refinance_outreach_drain_failed" }, { status: 500 });
  }
  logger.info("[refinance-outreach-drain]", JSON.stringify(run.result));
  return NextResponse.json({ success: true, data: run.result });
}
