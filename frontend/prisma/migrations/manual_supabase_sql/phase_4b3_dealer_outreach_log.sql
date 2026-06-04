-- AutoLenis Phase 4B-3 — Dealer Outreach Log + contact columns
--
-- One row per outreach attempt to a dealer prospect, tracking the Resend
-- delivery lifecycle (queued → sent → delivered/bounced/complained/replied).
-- Also adds the contact_name / contact_title columns the Phase 4B-1 enrichment
-- now persists and the email personalizer consumes.
--
-- Run in the Supabase SQL editor. Safe to re-run (all statements are guarded).

-- Contact person captured during email enrichment (Phase 4B-1).
ALTER TABLE dealer_prospects
  ADD COLUMN IF NOT EXISTS contact_name TEXT;
ALTER TABLE dealer_prospects
  ADD COLUMN IF NOT EXISTS contact_title TEXT;

CREATE TABLE IF NOT EXISTS dealer_outreach_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_prospect_id TEXT NOT NULL,
  outreach_type   TEXT NOT NULL,
  channel         TEXT NOT NULL,
  subject         TEXT,
  body            TEXT,
  to_email        TEXT,
  from_email      TEXT,
  resend_id       TEXT,
  status          TEXT NOT NULL,
  error_message   TEXT,
  sent_at         TIMESTAMP DEFAULT NOW(),
  delivered_at    TIMESTAMP,
  replied_at      TIMESTAMP,
  metadata        JSONB DEFAULT '{}'::jsonb,

  CONSTRAINT fk_dealer_prospect
    FOREIGN KEY (dealer_prospect_id)
    REFERENCES dealer_prospects(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS dealer_outreach_log_dealer_idx
  ON dealer_outreach_log (dealer_prospect_id);
CREATE INDEX IF NOT EXISTS dealer_outreach_log_status_idx
  ON dealer_outreach_log (status);
CREATE INDEX IF NOT EXISTS dealer_outreach_log_sent_at_idx
  ON dealer_outreach_log (sent_at);
CREATE INDEX IF NOT EXISTS dealer_outreach_log_resend_id_idx
  ON dealer_outreach_log (resend_id);
