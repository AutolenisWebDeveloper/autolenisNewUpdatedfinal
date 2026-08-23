// lead-nurture-drain — sends due LP form-abandonment / exit-intent touches.
//
// Migrated off the Inngest `formAbandonmentFn` / `exitIntentFn` (which used
// step.sleep for the inter-touch delays). Each touch is a durable
// lead_nurture_schedule row with a run_at; this cron sends the due touch
// (re-checking completion + suppression) and schedules the next. Runs every
// minute for ≤1-min delay precision on the longer nurture windows.

import { logger } from "@/lib/logger";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { NextRequest, NextResponse } from "next/server";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";
import { drainDueLeadNurture } from "@/lib/services/crm/lead-nurture.service";

export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("lead-nurture-drain", () => drainDueLeadNurture());
  if (!run.ok) {
    return NextResponse.json({ success: false, error: "lead_nurture_drain_failed" }, { status: 500 });
  }
  logger.info("[lead-nurture-drain]", JSON.stringify(run.result));
  return NextResponse.json({ success: true, data: run.result });
}
