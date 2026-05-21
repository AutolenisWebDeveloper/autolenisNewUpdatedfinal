-- ============================================================================
-- AutoLenis Phase 3 — Messaging, Campaigns, Segmentation
-- Email templates (+ versions), Segments, Campaigns (+ recipients)
-- ============================================================================
-- Forward dependencies: none. This migration owns 5 tables and references
-- contacts(id) from Phase 1 only on campaign_recipients (recipient identity).
-- Service role bypasses RLS — admin API uses the service client. Enabling RLS
-- on every table matches the Phase 1 posture (defense-in-depth against accidental
-- anon-client access).
--
-- Build order on top of this migration: TemplateService → SegmentService →
-- CampaignService. Campaigns FK into segments + templates, so the FKs here
-- are SET NULL (don't refuse to delete a template that has historical
-- campaign references — those campaigns just lose their template pointer).
-- campaign_recipients FK to campaign uses CASCADE so deleting a draft campaign
-- cleans up its recipients; FK to contact uses CASCADE for the same reason
-- the contacts table has soft-delete semantics — recipient rows are noise
-- once the contact is gone.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. EMAIL TEMPLATES + VERSIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS email_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  subject       TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'transactional'
    CHECK (category IN ('transactional','marketing','automation')),
  html_body     TEXT NOT NULL,
  text_body     TEXT,
  variables     TEXT[] NOT NULL DEFAULT '{}',
  thumbnail_url TEXT,
  status        TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','inactive','draft')),
  version       INT NOT NULL DEFAULT 1,
  created_by    UUID,
  updated_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_templates_status
  ON email_templates(status);
CREATE INDEX IF NOT EXISTS idx_email_templates_category
  ON email_templates(category);
CREATE INDEX IF NOT EXISTS idx_email_templates_updated_at
  ON email_templates(updated_at DESC);

ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS email_template_versions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id  UUID NOT NULL REFERENCES email_templates(id) ON DELETE CASCADE,
  version      INT NOT NULL,
  subject      TEXT NOT NULL,
  html_body    TEXT NOT NULL,
  text_body    TEXT,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(template_id, version)
);

CREATE INDEX IF NOT EXISTS idx_email_template_versions_template
  ON email_template_versions(template_id, version DESC);

ALTER TABLE email_template_versions ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2. SEGMENTS
-- ============================================================================
-- conditions JSONB shape (validated by SegmentService, not by the DB):
--   {
--     "match": "all" | "any",
--     "rules": [
--       { "field": "lifecycle_stage", "op": "eq",       "value": "lead" },
--       { "field": "consent_email",   "op": "eq",       "value": true   },
--       { "field": "utm_source",      "op": "contains", "value": "fb"   },
--       { "field": "created_at",      "op": "gte",      "value": "2026-01-01" }
--     ]
--   }
-- contact_count is a cached count; SegmentService refreshes it on save and
-- via the live preview endpoint, but campaign fan-out re-queries the segment
-- so a stale count never causes a stale send list.

CREATE TABLE IF NOT EXISTS segments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  description     TEXT,
  conditions      JSONB NOT NULL DEFAULT '{"match":"all","rules":[]}',
  contact_count   INT NOT NULL DEFAULT 0,
  last_counted_at TIMESTAMPTZ,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_segments_updated_at
  ON segments(updated_at DESC);

ALTER TABLE segments ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 3. CAMPAIGNS + RECIPIENTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS campaigns (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  type               TEXT NOT NULL
    CHECK (type IN ('email','sms','mixed')),
  status             TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','scheduled','running','paused','completed','cancelled')),
  segment_id         UUID REFERENCES segments(id) ON DELETE SET NULL,
  template_id        UUID REFERENCES email_templates(id) ON DELETE SET NULL,
  sms_body           TEXT,
  scheduled_at       TIMESTAMPTZ,
  started_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  recipient_count    INT NOT NULL DEFAULT 0,
  sent_count         INT NOT NULL DEFAULT 0,
  delivered_count    INT NOT NULL DEFAULT 0,
  opened_count       INT NOT NULL DEFAULT 0,
  clicked_count      INT NOT NULL DEFAULT 0,
  bounced_count      INT NOT NULL DEFAULT 0,
  failed_count       INT NOT NULL DEFAULT 0,
  unsubscribed_count INT NOT NULL DEFAULT 0,
  suppressed_count   INT NOT NULL DEFAULT 0,
  created_by         UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_status
  ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_scheduled_at
  ON campaigns(scheduled_at) WHERE scheduled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_campaigns_created_at
  ON campaigns(created_at DESC);

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS campaign_recipients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id      UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','delivered','opened','clicked',
                      'bounced','failed','unsubscribed','suppressed')),
  sent_at         TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  opened_at       TIMESTAMPTZ,
  clicked_at      TIMESTAMPTZ,
  unsubscribed_at TIMESTAMPTZ,
  error_message   TEXT,
  resend_id       TEXT,
  twilio_sid      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign
  ON campaign_recipients(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_contact
  ON campaign_recipients(contact_id);
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_status
  ON campaign_recipients(campaign_id, status);
-- Resend/Twilio webhook lookups by provider id need an index, but the value
-- is nullable for most rows so we use a partial index.
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_resend_id
  ON campaign_recipients(resend_id) WHERE resend_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_twilio_sid
  ON campaign_recipients(twilio_sid) WHERE twilio_sid IS NOT NULL;

ALTER TABLE campaign_recipients ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 4. UPDATED_AT TRIGGERS
-- ============================================================================
-- Reuse the convention from Phase 1: a generic trigger function that bumps
-- updated_at on UPDATE. Declared idempotently in case Phase 1 already shipped
-- it under the same name.

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_email_templates_updated_at ON email_templates;
CREATE TRIGGER trg_email_templates_updated_at
  BEFORE UPDATE ON email_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_segments_updated_at ON segments;
CREATE TRIGGER trg_segments_updated_at
  BEFORE UPDATE ON segments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_campaigns_updated_at ON campaigns;
CREATE TRIGGER trg_campaigns_updated_at
  BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
