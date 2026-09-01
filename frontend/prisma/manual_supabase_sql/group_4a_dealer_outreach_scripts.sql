-- =====================================================
-- AutoLenis Phase 4A — Founder-Driven Dealer Outreach
-- Run this in Supabase SQL Editor
-- =====================================================

-- Part 1: Add SCRIPTED to DealerProspectStatus enum
DO $$ BEGIN
  ALTER TYPE "DealerProspectStatus" ADD VALUE IF NOT EXISTS 'SCRIPTED' BEFORE 'DRAFTED';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Part 2: Add new fields to dealer_prospects
ALTER TABLE dealer_prospects
  ADD COLUMN IF NOT EXISTS outreach_script TEXT,
  ADD COLUMN IF NOT EXISTS script_drafted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS script_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS founder_notes TEXT,
  ADD COLUMN IF NOT EXISTS scripted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dead_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dead_reason TEXT;

-- Part 3: Indexes for admin pipeline efficiency
CREATE INDEX IF NOT EXISTS dealer_prospects_status_buyer_idx
  ON dealer_prospects (status, buyer_opp_id);

CREATE INDEX IF NOT EXISTS dealer_prospects_status_created_idx
  ON dealer_prospects (status, created_at DESC);
