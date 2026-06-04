-- =====================================================
-- AutoLenis Phase 4B-3 — Dealer Outreach Log
-- Email send infrastructure for dealer outreach.
-- Run this in the Supabase SQL Editor (idempotent — safe to re-run).
-- =====================================================

CREATE TABLE IF NOT EXISTS dealer_outreach_log (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_prospect_id TEXT NOT NULL,
  outreach_type      TEXT NOT NULL,  -- 'initial' | 'followup_1' | 'followup_2'
  channel            TEXT NOT NULL,  -- 'email' | 'sms' | 'phone'
  subject            TEXT,
  body               TEXT,
  to_email           TEXT,
  from_email         TEXT,
  resend_id          TEXT,           -- Resend's message id
  status             TEXT NOT NULL,  -- 'queued' | 'sent' | 'delivered' | 'bounced' | 'replied' | 'complained' | 'failed'
  error_message      TEXT,
  sent_at            TIMESTAMPTZ DEFAULT NOW(),
  delivered_at       TIMESTAMPTZ,
  replied_at         TIMESTAMPTZ,
  metadata           JSONB DEFAULT '{}'::jsonb,

  CONSTRAINT fk_dealer_prospect
    FOREIGN KEY (dealer_prospect_id)
    REFERENCES dealer_prospects (id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS dealer_outreach_log_dealer_idx
  ON dealer_outreach_log (dealer_prospect_id);

CREATE INDEX IF NOT EXISTS dealer_outreach_log_status_idx
  ON dealer_outreach_log (status);

CREATE INDEX IF NOT EXISTS dealer_outreach_log_sent_at_idx
  ON dealer_outreach_log (sent_at);

-- Resend webhook delivery events are matched back to a log row by resend_id.
CREATE INDEX IF NOT EXISTS dealer_outreach_log_resend_id_idx
  ON dealer_outreach_log (resend_id) WHERE resend_id IS NOT NULL;
