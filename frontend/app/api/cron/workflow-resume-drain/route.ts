// workflow-resume-drain — re-enters WorkflowEngine enrollments whose delay-node
// resume has fallen due.
//
// Migrated off the Inngest worker `workflowResumeFn` (`autolenis/workflow.resume`)
// onto the internal Vercel-Cron / Postgres substrate. The delay is durable state
// on the enrollment (resume_at/resume_node_id); this cron drains due rows every
// minute. The WorkflowEngine is currently double-gated OFF in prod (archived
// workflows + CRM_INAPP_ENGINE_ENABLED default off), so this is dormant until the
// in-app engine is re-enabled.

import { logger } from "@/lib/logger";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { NextRequest, NextResponse } from "next/server";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";
import { drainDueWorkflowResumes } from "@/lib/services/crm/workflow-resume-drain.service";

// A resume can walk several nodes (each with its own send); give the batch headroom.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("workflow-resume-drain", () => drainDueWorkflowResumes());
  if (!run.ok) {
    return NextResponse.json({ success: false, error: "workflow_resume_drain_failed" }, { status: 500 });
  }
  logger.info("[workflow-resume-drain]", JSON.stringify(run.result));
  return NextResponse.json({ success: true, data: run.result });
}
