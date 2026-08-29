-- =====================================================
-- AutoLenis AMIPS Phase 1 — Market Score cache
-- Dealer + Market Intelligence pipelines pre-compute the AutoLenis Market
-- Score per (make, model, metro) into this lookup table so the AMIPS-2
-- generator reads a stored score instead of recomputing per page.
--
-- Phase 1 populates dealer_intelligence and market_intelligence (both created
-- in amips_phase_0_all_databases.sql) via application pipelines — no schema
-- change is needed for those two tables. The only new table is below.
--
-- Run this in the Supabase SQL Editor after amips_phase_0_all_databases.sql.
-- Idempotent: CREATE TABLE IF NOT EXISTS + guarded indexes + trigger.
-- =====================================================

-- Reuses the shared trigger function created in Phase 0
-- (set_amips_updated_at). Re-created here defensively in case Phase 1 is run
-- against a database where only the tables — not the function — exist.
CREATE OR REPLACE FUNCTION set_amips_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- amips_market_scores
-- =====================================================
CREATE TABLE IF NOT EXISTS amips_market_scores (
  id                      TEXT PRIMARY KEY,
  make                    TEXT NOT NULL,
  model                   TEXT NOT NULL,
  metro                   TEXT NOT NULL,
  state                   TEXT NOT NULL,
  dealer_count            INTEGER NOT NULL DEFAULT 0,
  overall_buyer_advantage DOUBLE PRECISION NOT NULL,
  score_json              TEXT NOT NULL,
  computed_at             TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  created_at              TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS amips_market_scores_make_model_metro_key
  ON amips_market_scores (make, model, metro);
CREATE INDEX IF NOT EXISTS amips_market_scores_metro_idx
  ON amips_market_scores (metro);
CREATE INDEX IF NOT EXISTS amips_market_scores_overall_idx
  ON amips_market_scores (overall_buyer_advantage);

DROP TRIGGER IF EXISTS trg_amips_market_scores_updated_at ON amips_market_scores;
CREATE TRIGGER trg_amips_market_scores_updated_at
  BEFORE UPDATE ON amips_market_scores
  FOR EACH ROW EXECUTE FUNCTION set_amips_updated_at();

-- =====================================================
-- Verification:
--   SELECT COUNT(*) FROM dealer_intelligence;
--   SELECT COUNT(*) FROM market_intelligence;
--   SELECT metro_name, buyer_leverage_score
--   FROM market_intelligence
--   ORDER BY buyer_leverage_score DESC
--   LIMIT 5;
--   SELECT COUNT(*) FROM amips_market_scores;
-- =====================================================
