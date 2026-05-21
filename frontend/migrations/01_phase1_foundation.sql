-- ============================================================================
-- AutoLenis Phase 1 — Foundation Infrastructure
-- Universal Contact Layer + CRM Workspace + Compliance + Queue Infrastructure
-- ============================================================================
-- This migration has no forward dependencies on Phase 3 (campaigns, segments,
-- email_templates, campaign_recipients) or Phase 5 (analytics views).
-- All audit fixes from review are folded in:
--   - conversations: phone, channel, assigned_to columns
--   - conversation_messages: sender_type, sender_id, twilio_sid, resend_id,
--     read_at columns
--   - sms_suppression: restarted_at column (preserves audit trail on START)
--   - contact_timeline_events: expanded event_type set covering all 28+ types
--   - idempotency_keys: TTL cleanup function (manual run or pg_cron)
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. UNIVERSAL CONTACT LAYER
-- ============================================================================

CREATE TABLE IF NOT EXISTS contacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT DEFAULT NULL,
  phone           TEXT DEFAULT NULL,
  first_name      TEXT,
  last_name       TEXT,
  source          TEXT NOT NULL,
  utm_source      TEXT,
  utm_medium      TEXT,
  utm_campaign    TEXT,
  source_url      TEXT,
  ip_address      INET,
  consent_sms     BOOLEAN NOT NULL DEFAULT false,
  consent_email   BOOLEAN NOT NULL DEFAULT false,
  consent_at      TIMESTAMPTZ DEFAULT NULL,
  consent_ip      INET DEFAULT NULL,
  consent_text    TEXT DEFAULT NULL,
  lifecycle_stage TEXT NOT NULL DEFAULT 'lead'
    CHECK (lifecycle_stage IN (
      'lead', 'prequal_started', 'prequal_completed',
      'deposit_pending', 'deposit_paid', 'auction_active',
      'offer_received', 'purchase_completed', 'inactive'
    )),
  do_not_contact  BOOLEAN NOT NULL DEFAULT false,
  tags            TEXT[] DEFAULT '{}',
  notes           TEXT,
  assigned_to     UUID DEFAULT NULL,
  deleted_at      TIMESTAMPTZ DEFAULT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contacts_phone
  ON contacts(phone) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_lifecycle
  ON contacts(lifecycle_stage);
CREATE INDEX IF NOT EXISTS idx_contacts_assigned
  ON contacts(assigned_to) WHERE assigned_to IS NOT NULL;

-- Lowercase email uniqueness only across active (non-deleted) rows.
-- Nullable email is intentional: SMS-originated contacts may not have one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_email_unique_not_null
  ON contacts(lower(email))
  WHERE email IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS contact_identities (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id   UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  entity_type  TEXT NOT NULL
    CHECK (entity_type IN ('buyer','dealer','affiliate','refinance_lead')),
  entity_id    UUID NOT NULL,
  is_primary   BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_contact_identities_lookup
  ON contact_identities(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_contact_identities_contact
  ON contact_identities(contact_id);

CREATE TABLE IF NOT EXISTS contact_timeline_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id   UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  event_type   TEXT NOT NULL CHECK (event_type IN (
    'email_sent','email_opened','email_clicked','email_bounced','email_unsubscribed',
    'sms_sent','sms_delivered','sms_failed','sms_received','sms_stopped',
    'call_logged','note_added','stage_changed','task_created','task_completed',
    'deposit_initiated','deposit_paid','deposit_refunded',
    'auction_started','auction_closed',
    'offer_received','offer_selected','offer_expired',
    'contract_sent','docusign_signed','docusign_declined',
    'dealer_action','affiliate_action',
    'admin_action','automation_triggered','automation_completed','automation_exited',
    'campaign_sent','campaign_opened','campaign_clicked'
  )),
  event_data   JSONB NOT NULL DEFAULT '{}',
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_timeline_chronology
  ON contact_timeline_events(contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_timeline_type
  ON contact_timeline_events(event_type);

-- ============================================================================
-- 2. CRM WORKSPACE — CONVERSATIONS + TASKS
-- ============================================================================

CREATE TABLE IF NOT EXISTS conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id      UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  phone           TEXT,
  channel         TEXT NOT NULL DEFAULT 'sms'
    CHECK (channel IN ('sms','email')),
  assigned_to     UUID,
  unread_count    INT NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','assigned','escalated','resolved')),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversations_contact
  ON conversations(contact_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status
  ON conversations(status);
CREATE INDEX IF NOT EXISTS idx_conversations_assigned
  ON conversations(assigned_to) WHERE assigned_to IS NOT NULL;

CREATE TABLE IF NOT EXISTS conversation_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction       TEXT NOT NULL
    CHECK (direction IN ('inbound','outbound','internal')),
  sender_type     TEXT
    CHECK (sender_type IS NULL OR sender_type IN ('contact','admin','system')),
  sender_id       UUID,
  body            TEXT NOT NULL,
  twilio_sid      TEXT,
  resend_id       TEXT,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation
  ON conversation_messages(conversation_id, created_at ASC);

-- crm_tasks: contact_id nullable so system/admin scoped tasks are supported.
CREATE TABLE IF NOT EXISTS crm_tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title           TEXT NOT NULL,
  description     TEXT,
  priority        TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low','medium','high','urgent')),
  status          TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','in_progress','completed','deferred')),
  contact_id      UUID REFERENCES contacts(id) ON DELETE CASCADE,
  scope           TEXT NOT NULL DEFAULT 'contact'
    CHECK (scope IN ('contact','system','admin')),
  assigned_to     UUID,
  due_at          TIMESTAMPTZ,
  source          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_tasks_contact
  ON crm_tasks(contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_tasks_status_scope
  ON crm_tasks(status, scope);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_due
  ON crm_tasks(due_at) WHERE status IN ('open','in_progress');

-- ============================================================================
-- 3. COMPLIANCE INFRASTRUCTURE — SUPPRESSION + AUDIT
-- ============================================================================

CREATE TABLE IF NOT EXISTS email_suppression (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  reason        TEXT NOT NULL
    CHECK (reason IN ('unsubscribed','bounced','complained','admin_added','spam_trap')),
  contact_id    UUID REFERENCES contacts(id) ON DELETE SET NULL,
  metadata      JSONB DEFAULT '{}',
  suppressed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sms_suppression (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         TEXT NOT NULL UNIQUE,
  reason        TEXT NOT NULL
    CHECK (reason IN ('stop','admin_added','invalid','carrier_block')),
  contact_id    UUID REFERENCES contacts(id) ON DELETE SET NULL,
  restarted_at  TIMESTAMPTZ,
  suppressed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id     UUID NOT NULL,
  action       TEXT NOT NULL,
  entity_type  TEXT,
  entity_id    UUID,
  before_state JSONB,
  after_state  JSONB,
  ip_address   INET,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_admin
  ON admin_audit_log(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_entity
  ON admin_audit_log(entity_type, entity_id);

-- ============================================================================
-- 4. QUEUE INFRASTRUCTURE — IDEMPOTENCY + DEAD LETTER
-- ============================================================================

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key_hash          TEXT PRIMARY KEY,
  execution_status  TEXT NOT NULL
    CHECK (execution_status IN ('processing','completed','failed')),
  response_payload  JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_idempotency_created
  ON idempotency_keys(created_at);

-- TTL helper — call manually or schedule via pg_cron to keep table bounded.
CREATE OR REPLACE FUNCTION cleanup_old_idempotency_keys()
RETURNS INT AS $$
DECLARE
  removed INT;
BEGIN
  WITH del AS (
    DELETE FROM idempotency_keys
    WHERE created_at < now() - INTERVAL '30 days'
    RETURNING 1
  )
  SELECT count(*) INTO removed FROM del;
  RETURN removed;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS jobs_dead_letter (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          TEXT NOT NULL,
  event_name      TEXT NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}',
  error_message   TEXT NOT NULL,
  failed_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dlq_event
  ON jobs_dead_letter(event_name);
CREATE INDEX IF NOT EXISTS idx_dlq_failed_at
  ON jobs_dead_letter(failed_at DESC);

COMMIT;
