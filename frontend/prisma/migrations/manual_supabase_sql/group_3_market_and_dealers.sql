-- =====================================================
-- AutoLenis Group 3 — Market Enrichment + Dealer Discovery
-- Run this in Supabase SQL Editor
-- =====================================================
--
-- NOTE: The enum is named "DealerProspectStatus" (not "DealerStatus")
-- to avoid colliding with the existing "DealerStatus" enum used by
-- the dealers table (PENDING/ACTIVE/SUSPENDED/TERMINATED).

-- Part 1: Add market enrichment fields to buyer_opportunities
ALTER TABLE buyer_opportunities
  ADD COLUMN IF NOT EXISTS market_msrp_estimate INTEGER,
  ADD COLUMN IF NOT EXISTS market_avg_paid_price INTEGER,
  ADD COLUMN IF NOT EXISTS market_typical_markup TEXT,
  ADD COLUMN IF NOT EXISTS market_good_deal_target INTEGER,
  ADD COLUMN IF NOT EXISTS market_notes TEXT,
  ADD COLUMN IF NOT EXISTS market_enriched_at TIMESTAMPTZ;

-- Part 2: Create DealerProspectStatus enum
DO $$ BEGIN
  CREATE TYPE "DealerProspectStatus" AS ENUM (
    'DISCOVERED',
    'DRAFTED',
    'CONTACTED',
    'REPLIED',
    'ONBOARDED',
    'DEAD'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Part 3: Create dealer_prospects table
CREATE TABLE IF NOT EXISTS dealer_prospects (
  id TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT,
  buyer_opp_id TEXT NOT NULL,

  name TEXT NOT NULL,
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,

  brand TEXT,

  source_url TEXT,
  search_score DOUBLE PRECISION,
  distance_miles DOUBLE PRECISION,

  status "DealerProspectStatus" NOT NULL DEFAULT 'DISCOVERED',
  outreach_draft TEXT,
  contacted_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT dealer_prospects_pkey PRIMARY KEY (id),
  CONSTRAINT dealer_prospects_buyer_opp_id_fkey
    FOREIGN KEY (buyer_opp_id)
    REFERENCES buyer_opportunities (id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS dealer_prospects_buyer_opp_id_idx
  ON dealer_prospects (buyer_opp_id);

CREATE INDEX IF NOT EXISTS dealer_prospects_status_idx
  ON dealer_prospects (status);

CREATE INDEX IF NOT EXISTS dealer_prospects_zip_idx
  ON dealer_prospects (zip);

-- Auto-update trigger for dealer_prospects
DROP TRIGGER IF EXISTS dealer_prospects_updated_at
  ON dealer_prospects;

CREATE TRIGGER dealer_prospects_updated_at
  BEFORE UPDATE ON dealer_prospects
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- RLS for dealer_prospects
ALTER TABLE dealer_prospects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role only" ON dealer_prospects;
CREATE POLICY "Service role only"
  ON dealer_prospects
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Part 4: Create search_cache table
CREATE TABLE IF NOT EXISTS search_cache (
  id TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT,
  cache_key TEXT NOT NULL,
  search_type TEXT NOT NULL,
  zip TEXT,
  make TEXT,
  model TEXT,
  radius_miles INTEGER,
  result JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT search_cache_pkey PRIMARY KEY (id),
  CONSTRAINT search_cache_cache_key_key UNIQUE (cache_key)
);

CREATE INDEX IF NOT EXISTS search_cache_cache_key_idx
  ON search_cache (cache_key);

CREATE INDEX IF NOT EXISTS search_cache_expires_at_idx
  ON search_cache (expires_at);

-- RLS for search_cache
ALTER TABLE search_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role only" ON search_cache;
CREATE POLICY "Service role only"
  ON search_cache
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
