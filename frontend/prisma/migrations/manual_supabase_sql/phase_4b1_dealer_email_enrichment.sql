-- AutoLenis Phase 4B-1 — Dealer Email Enrichment Schema
--
-- Adds email-source + enrichment-timestamp tracking to dealer_prospects so the
-- Gemini-Search enrichment layer can record where each address came from and
-- when it last ran. The `email` column already exists from group_3; the
-- ADD COLUMN below is idempotent and harmless if so.
--
-- Run in the Supabase SQL editor. Safe to re-run (all statements are guarded).

ALTER TABLE dealer_prospects
  ADD COLUMN IF NOT EXISTS email TEXT;

ALTER TABLE dealer_prospects
  ADD COLUMN IF NOT EXISTS email_source TEXT;

ALTER TABLE dealer_prospects
  ADD COLUMN IF NOT EXISTS email_enriched_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS dealer_prospects_email_idx
  ON dealer_prospects (email) WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS dealer_prospects_email_source_idx
  ON dealer_prospects (email_source);
