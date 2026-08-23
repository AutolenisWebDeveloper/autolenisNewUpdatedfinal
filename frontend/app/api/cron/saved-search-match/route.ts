// saved-search-match — periodic saved_search_matched emitter for new inventory.
//
// Migrated off the Inngest cron `savedSearchMatcherFn` onto the internal
// Vercel-Cron / application / Postgres substrate. The scan + emit logic lives in
// the CRM service; this route only enforces cron auth and records the run. The
// per-search lastMatchAt cursor is the dedup (the same items never re-alert), so
// overlapping/retried runs are safe.

import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { NextRequest, NextResponse } from "next/server";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";
import { matchSavedSearches } from "@/lib/services/crm/saved-search-matcher.service";

// Up to 500 searches, each running an inventory count + sample query; give it
// headroom beyond the default.
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("saved-search-match", async () => matchSavedSearches());

  if (!run.ok) {
    return NextResponse.json({ success: false, error: "saved_search_match_failed" }, { status: 500 });
  }
  return NextResponse.json({ success: true, data: run.result });
}
