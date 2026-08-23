// inactivity-scan — hourly buyer_inactive emitter for stale early-stage contacts.
//
// Migrated off the Inngest cron `inactivityScannerFn` onto the internal
// Vercel-Cron / application / Postgres substrate. The scan + emit logic lives in
// the CRM service; this route only enforces cron auth and records the run. The
// spine's lifecycle advance is the idempotency guard (an emitted contact moves to
// 'inactive' and drops out of the next scan), so overlapping/retried runs are safe.

import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { NextRequest, NextResponse } from "next/server";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";
import { scanInactiveContacts } from "@/lib/services/crm/inactivity-scanner.service";

// The scan can emit up to 500 domain events per run, each doing a contact upsert
// + timeline write; give it headroom beyond the default.
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("inactivity-scan", async () => scanInactiveContacts());

  if (!run.ok) {
    return NextResponse.json({ success: false, error: "inactivity_scan_failed" }, { status: 500 });
  }
  return NextResponse.json({ success: true, data: run.result });
}
