-- Make.com cutover, Tranche T1 — double-send fuse.
-- Archives every in-app workflow so the legacy WorkflowEngine cannot enroll or
-- dispatch once behavioral events begin flowing (Make becomes the sole nurture
-- sender). The engine treats any status <> 'active' as non-dispatching; the
-- workflows_status_check constraint permits draft|active|paused|archived, so
-- 'archived' is the explicit retired/disabled terminal state.
-- Idempotent: safe to run multiple times. No-op once all rows are archived.

UPDATE workflows
SET status = 'archived',
    updated_at = now()
WHERE status <> 'archived';

-- Verification (expect 0 active):
-- SELECT status, count(*) FROM workflows GROUP BY status;
