-- =====================================================
-- AutoLenis — Add email-sent flags to buyer_opportunities
-- Run this in Supabase SQL Editor
-- =====================================================

ALTER TABLE buyer_opportunities
  ADD COLUMN IF NOT EXISTS buyer_email_sent BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS founder_email_sent BOOLEAN NOT NULL DEFAULT false;
