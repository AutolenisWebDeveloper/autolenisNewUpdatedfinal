// Workflow delay-node resume drain — internal Vercel-Cron substrate (migrated off
// the retired Inngest `workflowResumeFn` / `autolenis/workflow.resume`).
//
// The WorkflowEngine delay node now persists durable resume state on the
// enrollment (`resume_at` + `resume_node_id`, migration
// `manual_supabase_sql/workflow_scheduled_resume.sql`) instead of emitting an
// Inngest event with a future `ts`. This drain selects enrollments whose
// `resume_at` has fallen due and re-enters `WorkflowEngine.resumeEnrollment` —
// DB-scheduled state, no Inngest, no setTimeout, no detached promise.
//
// Crash-safe at-least-once: each due row is claimed via the shared `claimJob`
// primitive (keyed on enrollment+node, reclaimable after STALE_MS), and its
// `resume_at` is cleared ONLY after a successful resume — and only if unchanged
// (a re-suspend at a later delay writes a NEW resume_at, which the conditional
// clear leaves intact). A failed/crashed resume leaves `resume_at` set so a later
// tick re-selects and re-drives it; `resumeEnrollment` is idempotent per node (its
// email/SMS/notify sends carry per-node idempotency keys), so a re-run never
// double-sends.

import { logger } from "@/lib/logger";
import { getServiceSupabase } from "@/lib/supabase-service";
import { claimJob, updateIdempotencyState } from "@/lib/jobs/idempotency";
import { WorkflowEngine, isInAppEngineEnabled } from "@/lib/services/workflow.engine";
import type { SupabaseClient } from "@supabase/supabase-js";

const BATCH = 100;
// A claim older than this is reclaimable (a prior drain died mid-resume). MUST
// exceed the drain route's maxDuration so a live resume is never reclaimed.
const STALE_MS = 10 * 60 * 1000;

export interface WorkflowResumeDrainResult {
  status: "OK" | "NO_DUE_RESUMES" | "ENGINE_DISABLED";
  due: number;
  resumed: number;
  skipped: number;
  failed: number;
}

async function clearResume(
  supabase: SupabaseClient,
  enrollmentId: string,
  originalResumeAt: string,
): Promise<void> {
  // Clear only if resume_at is still the value we processed — if resumeEnrollment
  // hit another delay it wrote a new (future) resume_at that must survive.
  await supabase
    .from("workflow_enrollments")
    .update({ resume_at: null, resume_node_id: null })
    .eq("id", enrollmentId)
    .eq("resume_at", originalResumeAt);
}

export async function drainDueWorkflowResumes(): Promise<WorkflowResumeDrainResult> {
  // If the in-app engine is disabled, resumeEnrollment would no-op — so DON'T
  // select or clear anything. Leaving resume_at intact means a pending resume
  // survives a disable window and fires once the engine is re-enabled, instead of
  // being silently discarded. (In prod the engine is disabled and the column is
  // brand-new, so there is nothing to drain today.)
  if (!isInAppEngineEnabled()) {
    return { status: "ENGINE_DISABLED", due: 0, resumed: 0, skipped: 0, failed: 0 };
  }

  const supabase = getServiceSupabase();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("workflow_enrollments")
    .select("id, resume_node_id, resume_at")
    .eq("status", "active")
    .not("resume_at", "is", null)
    .lte("resume_at", now)
    .order("resume_at", { ascending: true })
    .limit(BATCH);

  if (error) throw new Error(`workflow_resume_query_failed: ${error.message}`);

  const due = data ?? [];
  if (due.length === 0) {
    return { status: "NO_DUE_RESUMES", due: 0, resumed: 0, skipped: 0, failed: 0 };
  }

  let resumed = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of due) {
    const enrollmentId = row.id as string;
    const nodeId = (row.resume_node_id as string | null) ?? null;
    const originalResumeAt = row.resume_at as string;

    // Malformed row (resume_at without a node) — clear so it isn't re-selected.
    if (!nodeId) {
      await clearResume(supabase, enrollmentId, originalResumeAt);
      skipped++;
      continue;
    }

    // Include the resume_at instant so each scheduled resume is a DISTINCT claim
    // identity — a workflow that loops back through the same delay node schedules a
    // new (later) resume_at, which must not collide with the prior pass's
    // 'completed' guard (which claimJob would treat as authoritatively done).
    const key = `workflow-resume:${enrollmentId}:${nodeId}:${originalResumeAt}`;
    const claimed = await claimJob(supabase, key, { staleMs: STALE_MS });
    if (!claimed) {
      // Another drain owns it, or a prior run already completed it.
      skipped++;
      continue;
    }

    try {
      await WorkflowEngine.resumeEnrollment(supabase, enrollmentId, nodeId);
      await clearResume(supabase, enrollmentId, originalResumeAt);
      await updateIdempotencyState(supabase, key, "completed", {});
      resumed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Leave resume_at set → re-selected next tick; claimJob reclaims the 'failed'
      // guard and re-drives the idempotent resume. One row's failure is isolated.
      await updateIdempotencyState(supabase, key, "failed", { error: message });
      logger.error(`[workflow-resume-drain] resume failed for ${enrollmentId}`, message);
      failed++;
    }
  }

  return { status: "OK", due: due.length, resumed, skipped, failed };
}
