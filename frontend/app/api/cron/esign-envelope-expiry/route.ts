// E-sign envelope expiry sweep (§9) — runs hourly.
// Transitions prepared-but-unsigned signing envelopes past their expiresAt to
// EXPIRED via a per-row compare-and-swap, so a COMPLETED (or any terminal) record
// is never touched. Idempotent and audited. Logic lives in the signing service;
// this route is a thin authorized entry point.
import { logger } from "@/lib/logger";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { NextRequest, NextResponse } from "next/server";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";
import { sweepExpiredEnvelopes } from "@/lib/services/esign/buyer-signing.service";

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("esign-envelope-expiry", async () => {
    const result = await sweepExpiredEnvelopes();
    logger.info(`[esign-envelope-expiry] expired ${result.expired}/${result.scanned} stale envelope(s)`);
    return result;
  });
  if (!run.ok) return NextResponse.json({ success: false, error: "esign-envelope-expiry_failed" }, { status: 500 });

  return NextResponse.json({ success: true, ...run.result });
}
