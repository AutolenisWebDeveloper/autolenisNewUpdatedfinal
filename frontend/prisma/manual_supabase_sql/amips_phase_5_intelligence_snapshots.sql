-- =====================================================
-- AutoLenis AMIPS Phase 5 — Intelligence Snapshots
-- Periodic point-in-time captures of the executive-intelligence rollup so the
-- Market Intelligence Center can show genuine trends (day/week deltas) instead
-- of static figures. Written daily by the amips-snapshot cron.
--
-- Run this in the Supabase SQL Editor after amips_phase_1_market_scores.sql.
-- Idempotent: CREATE TABLE IF NOT EXISTS + guarded indexes.
-- =====================================================

CREATE TABLE IF NOT EXISTS amips_intelligence_snapshots (
  id                     TEXT PRIMARY KEY,
  captured_at            TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  health_score           INTEGER NOT NULL,
  metros_covered         INTEGER NOT NULL,
  metros_scored          INTEGER NOT NULL,
  avg_buyer_leverage     DOUBLE PRECISION NOT NULL,
  active_pages           INTEGER NOT NULL,
  published_30d          INTEGER NOT NULL,
  impressions            INTEGER NOT NULL DEFAULT 0,
  clicks                 INTEGER NOT NULL DEFAULT 0,
  leads                  INTEGER NOT NULL DEFAULT 0,
  revenue_run_rate_cents INTEGER NOT NULL DEFAULT 0,
  indexation_rate        DOUBLE PRECISION NOT NULL DEFAULT 0,
  payload_json           TEXT NOT NULL,
  created_at             TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS amips_intelligence_snapshots_captured_at_idx
  ON amips_intelligence_snapshots (captured_at);

-- =====================================================
-- Verification:
--   SELECT COUNT(*) FROM amips_intelligence_snapshots;
-- =====================================================
