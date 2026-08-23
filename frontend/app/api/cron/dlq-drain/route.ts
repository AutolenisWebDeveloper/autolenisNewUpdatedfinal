// F-035 — automated dead-letter drainer.
// Previously the DLQ was retried ONLY when an admin clicked Retry, so a
// transiently-failed job sat dead until someone noticed. This cron re-emits
// eligible dead-letter rows automatically (bounded per row so a poison job
// can't hot-loop), covering both Inngest and QStash-origin jobs.

import { logger } from "@/lib/logger";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-service";
import { OperationsService } from "@/lib/services/operations.service";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("dlq-drain", () => {
    const ops = new OperationsService(getServiceSupabase());
    return ops.autoDrainDeadLetterJobs();
  });
  if (!run.ok) {
    return NextResponse.json({ success: false, error: "DRAIN_FAILED" }, { status: 500 });
  }
  if (run.result.reemitted > 0 || run.result.failed > 0) {
    logger.info(`[dlq-drain] ${JSON.stringify(run.result)}`);
  }
  return NextResponse.json({ success: true, data: run.result });
}
