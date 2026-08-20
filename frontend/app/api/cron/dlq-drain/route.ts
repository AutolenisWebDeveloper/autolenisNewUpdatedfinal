// F-035 — automated dead-letter drainer.
// Previously the DLQ was retried ONLY when an admin clicked Retry, so a
// transiently-failed job sat dead until someone noticed. This cron re-emits
// eligible dead-letter rows automatically (bounded per row so a poison job
// can't hot-loop), covering both Inngest and QStash-origin jobs.

import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { getServiceSupabase } from "@/lib/supabase-service";
import { OperationsService } from "@/lib/services/operations.service";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

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
