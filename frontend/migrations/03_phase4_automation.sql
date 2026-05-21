-- ============================================================================
-- AutoLenis Phase 4 — Automation Engine + Workflow Builder
-- workflows, workflow_versions, workflow_enrollments, workflow_execution_log
-- ============================================================================
-- Forward dependencies: contacts(id) from Phase 1, crm_tasks (Phase 1) so that
-- 'action.createTask' nodes can link a task back to the enrollment that
-- spawned it. References to email_templates(id) (Phase 3) are validated at
-- the service layer rather than via FK because workflow node config is JSONB.
--
-- nodes JSONB shape (validated by WorkflowService + WorkflowEngine):
--   {
--     "nodes": [
--       { "id": "trigger_1", "type": "trigger.buyer_signup", "config": {} },
--       { "id": "action_1",  "type": "action.sendEmail",     "config": { "template_id": "..." } },
--       { "id": "delay_1",   "type": "delay",                "config": { "duration": "1h" } },
--       { "id": "cond_1",    "type": "condition",            "config": { "field": "consent_sms", "op": "is_true" } },
--       { "id": "end_1",     "type": "action.endWorkflow",   "config": {} }
--     ],
--     "edges": [
--       { "from": "trigger_1", "to": "action_1" },
--       { "from": "action_1",  "to": "delay_1" },
--       { "from": "delay_1",   "to": "cond_1" },
--       { "from": "cond_1",    "to": "end_1", "branch": "true" },
--       { "from": "cond_1",    "to": "end_1", "branch": "false" }
--     ]
--   }
--
-- Enrollment uniqueness: (workflow_id, contact_id) means a contact cannot be
-- re-enrolled into the same workflow while an active row exists. Re-enrollment
-- is allowed after the enrollment row leaves the 'active' state — for that
-- case we delete the prior row (engine handles this) so the unique constraint
-- doesn't block the new run.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. WORKFLOWS
-- ============================================================================

CREATE TABLE IF NOT EXISTS workflows (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  description    TEXT,
  status         TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','active','paused','archived')),
  trigger_type   TEXT NOT NULL,
  trigger_config JSONB NOT NULL DEFAULT '{}',
  nodes          JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
  version        INT NOT NULL DEFAULT 1,
  is_prebuilt    BOOLEAN NOT NULL DEFAULT false,
  prebuilt_key   TEXT,
  created_by     UUID,
  activated_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflows_status
  ON workflows(status);
CREATE INDEX IF NOT EXISTS idx_workflows_trigger
  ON workflows(trigger_type) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_workflows_updated
  ON workflows(updated_at DESC);

ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2. WORKFLOW VERSIONS — snapshot history (last 10 retained by service)
-- ============================================================================

CREATE TABLE IF NOT EXISTS workflow_versions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id    UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  version        INT NOT NULL,
  nodes          JSONB NOT NULL,
  trigger_config JSONB NOT NULL DEFAULT '{}',
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workflow_id, version)
);

CREATE INDEX IF NOT EXISTS idx_workflow_versions_workflow
  ON workflow_versions(workflow_id, version DESC);

ALTER TABLE workflow_versions ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 3. WORKFLOW ENROLLMENTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS workflow_enrollments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id     UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  contact_id      UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','completed','exited','failed','paused')),
  current_node_id TEXT,
  trigger_data    JSONB NOT NULL DEFAULT '{}',
  enrolled_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  exited_at       TIMESTAMPTZ,
  exit_reason     TEXT
);

-- One active enrollment per contact per workflow. The engine deletes the
-- previous terminal row before re-enrolling so this constraint never blocks
-- a legitimate re-run.
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_enrollments_unique
  ON workflow_enrollments(workflow_id, contact_id);

CREATE INDEX IF NOT EXISTS idx_workflow_enrollments_status
  ON workflow_enrollments(status);
CREATE INDEX IF NOT EXISTS idx_workflow_enrollments_contact
  ON workflow_enrollments(contact_id);
CREATE INDEX IF NOT EXISTS idx_workflow_enrollments_failed
  ON workflow_enrollments(workflow_id, exited_at DESC)
  WHERE status IN ('failed','exited');

ALTER TABLE workflow_enrollments ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 4. WORKFLOW EXECUTION LOG — per-node audit trail
-- ============================================================================

CREATE TABLE IF NOT EXISTS workflow_execution_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID NOT NULL REFERENCES workflow_enrollments(id) ON DELETE CASCADE,
  node_id       TEXT NOT NULL,
  node_type     TEXT NOT NULL,
  status        TEXT NOT NULL
    CHECK (status IN ('success','failed','skipped','pending','suspended')),
  input_data    JSONB NOT NULL DEFAULT '{}',
  output_data   JSONB NOT NULL DEFAULT '{}',
  error_message TEXT,
  executed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_exec_log_enrollment
  ON workflow_execution_log(enrollment_id, executed_at ASC);
CREATE INDEX IF NOT EXISTS idx_workflow_exec_log_status
  ON workflow_execution_log(status);

ALTER TABLE workflow_execution_log ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 5. CRM_TASKS — backfill workflow_enrollment_id link for automation tasks
-- ============================================================================
-- Tasks created by action.createTask reference back to the enrollment so the
-- operations panel can tie "failing workflows" → "abandoned tasks".

ALTER TABLE crm_tasks
  ADD COLUMN IF NOT EXISTS workflow_enrollment_id UUID
    REFERENCES workflow_enrollments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_crm_tasks_workflow_enrollment
  ON crm_tasks(workflow_enrollment_id) WHERE workflow_enrollment_id IS NOT NULL;

COMMIT;
