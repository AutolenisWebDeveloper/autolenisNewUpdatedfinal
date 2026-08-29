-- Workflow delay-node durable resume (Inngest workflow.resume retirement).
--
-- PRODUCTION CUTOVER REQUIRES applying this SQL to Supabase — OWNER-GATED.
-- (workflow_enrollments is a Supabase-managed table, not in the Prisma schema, so
--  this is a raw Supabase migration, not `prisma migrate deploy`.) Branch-only,
--  additive, and idempotent — safe to run multiple times; a no-op once applied.
--
-- WHY: the WorkflowEngine delay node previously suspended by emitting
-- `autolenis/workflow.resume` with a future Inngest `ts` (Inngest's delay
-- primitive). To retire Inngest, the delay is now persisted as durable Postgres
-- state on the enrollment: `resume_at` (when to resume) + `resume_node_id` (which
-- node to resume from). The internal `workflow-resume-drain` Vercel Cron selects
-- due rows (`resume_at <= now()`), claims each crash-safely, and re-enters
-- WorkflowEngine.resumeEnrollment — no Inngest, no setTimeout, no detached promise.
--
-- SAFETY: the WorkflowEngine is already double-gated OFF in production
-- (CRM_INAPP_ENGINE_ENABLED defaults off AND every workflow was archived by the
-- Make cutover T1), so no live enrollment can reach a delay node today — this
-- change is dormant-safe and only takes effect if/when the in-app engine is
-- re-enabled.

ALTER TABLE workflow_enrollments
  ADD COLUMN IF NOT EXISTS resume_at      timestamptz NULL,
  ADD COLUMN IF NOT EXISTS resume_node_id text        NULL;

-- Partial index for the drain's hot query: due, still-active resumes only. Keeps
-- the scan tiny regardless of how many completed/failed enrollments accumulate.
CREATE INDEX IF NOT EXISTS idx_workflow_enrollments_due_resume
  ON workflow_enrollments (resume_at)
  WHERE resume_at IS NOT NULL AND status = 'active';

-- Verification (expect the two columns + index to exist):
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'workflow_enrollments'
--      AND column_name IN ('resume_at','resume_node_id');
--   SELECT indexname FROM pg_indexes
--    WHERE tablename = 'workflow_enrollments'
--      AND indexname = 'idx_workflow_enrollments_due_resume';
