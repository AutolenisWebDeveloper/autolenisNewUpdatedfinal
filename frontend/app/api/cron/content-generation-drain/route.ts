// content-generation-drain — drains the ContentGenerationJobItem queue.
//
// Migrated off the Inngest workers `contentGenerateFn` / `contentRegenerateFn`
// onto the internal Vercel-Cron / Postgres substrate. The item table is the
// durable queue; this cron claims and processes a bounded batch of QUEUED (and
// reclaimable stale-PROCESSING) items every few minutes. Admin
// enqueue/resume/retry simply set item status to QUEUED — this drain does the
// work, so there is no Inngest event and no second scheduler.

import { logger } from "@/lib/logger";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { NextRequest, NextResponse } from "next/server";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";
import { drainContentGenerationQueue } from "@/lib/services/content/content-generation-processor.service";

// Each item is a long-running Groq generation; give the batch full headroom.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("content-generation-drain", () => drainContentGenerationQueue());
  if (!run.ok) {
    return NextResponse.json({ success: false, error: "content_generation_drain_failed" }, { status: 500 });
  }
  logger.info("[content-generation-drain]", JSON.stringify(run.result));
  return NextResponse.json({ success: true, data: run.result });
}
