-- AutoLenis Group 8 — Affiliate Program Build-Out (8A: referral click tracking)
--
-- Adds the affiliate_clicks table: one row per inbound visit that carried an
-- affiliate ?ref= code. This is the top of the affiliate funnel — recorded
-- before any account exists — and is distinct from affiliate_referrals, which
-- records completed signups. converted_at / referred_user_id link a click to
-- the buyer signup it produced, giving affiliates real click→conversion
-- attribution. IP addresses are stored only as a salted SHA-256 hash.
--
-- Run in the Supabase SQL editor. Safe to re-run (all statements are guarded).

-- affiliates.id is TEXT (see the canonical init migration), so the FK column
-- and PK here are TEXT to match — gen_random_uuid() is cast to text for the id.
CREATE TABLE IF NOT EXISTS affiliate_clicks (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  affiliate_id     TEXT NOT NULL REFERENCES affiliates("id") ON DELETE CASCADE,
  referral_code    TEXT NOT NULL,
  clicked_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_hash          TEXT,
  user_agent       TEXT,
  referer          TEXT,
  landing_path     TEXT,
  utm_source       TEXT,
  utm_medium       TEXT,
  utm_campaign     TEXT,
  converted_at     TIMESTAMPTZ,
  referred_user_id TEXT
);

CREATE INDEX IF NOT EXISTS affiliate_clicks_affiliate_id_clicked_at_idx
  ON affiliate_clicks (affiliate_id, clicked_at);

CREATE INDEX IF NOT EXISTS affiliate_clicks_referral_code_idx
  ON affiliate_clicks (referral_code);
