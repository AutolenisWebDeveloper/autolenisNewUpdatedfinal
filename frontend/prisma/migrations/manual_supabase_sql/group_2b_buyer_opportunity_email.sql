-- =====================================================
-- AutoLenis — Add email column to buyer_opportunities
-- Run this in Supabase SQL Editor
-- =====================================================

ALTER TABLE buyer_opportunities
  ADD COLUMN IF NOT EXISTS email TEXT;

CREATE INDEX IF NOT EXISTS buyer_opportunities_email_idx
  ON buyer_opportunities (email);
