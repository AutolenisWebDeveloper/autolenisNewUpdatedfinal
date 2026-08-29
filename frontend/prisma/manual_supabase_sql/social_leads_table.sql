-- Social leads — buyers captured from social campaign landing pages (/lp/*).
-- System of record for the social-specific email nurture sequence
-- (welcome + 5-step) driven by the social-lead-nurture cron.
-- Idempotent: safe to run multiple times against any environment.

CREATE TABLE IF NOT EXISTS social_leads (
  id                  TEXT        NOT NULL PRIMARY KEY,
  social_post_id      TEXT,
  platform            TEXT,
  franchise           TEXT,
  utm_source          TEXT,
  utm_campaign        TEXT,
  utm_content         TEXT,
  utm_hook            TEXT,
  landing_page        TEXT,
  first_name          TEXT        NOT NULL,
  last_name           TEXT,
  email               TEXT        NOT NULL,
  phone               TEXT,
  zip                 TEXT,
  city                TEXT,
  state               TEXT,
  vehicle_interest    TEXT,
  make                TEXT,
  model               TEXT,
  budget              TEXT,
  timeline            TEXT,
  buyer_opp_id        TEXT,
  vehicle_request_id  TEXT,
  status              TEXT        NOT NULL DEFAULT 'NEW',
  nurture_sequence    TEXT,
  nurture_step        INTEGER     NOT NULL DEFAULT 0,
  last_email_sent_at  TIMESTAMPTZ,
  converted_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS social_leads_email_idx
  ON social_leads(email);
CREATE INDEX IF NOT EXISTS social_leads_status_idx
  ON social_leads(status);
CREATE INDEX IF NOT EXISTS social_leads_post_id_idx
  ON social_leads(social_post_id);
CREATE INDEX IF NOT EXISTS social_leads_platform_idx
  ON social_leads(platform);
CREATE INDEX IF NOT EXISTS social_leads_created_at_idx
  ON social_leads(created_at);
