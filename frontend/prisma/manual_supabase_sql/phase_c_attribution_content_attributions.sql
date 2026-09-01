-- =====================================================
-- AutoLenis Phase C-Attribution — ContentAttribution Migration
-- Links content-engine leads to the article that drove them so conversions
-- can be reported by cluster / city / metro / state.
-- Run this in the Supabase SQL Editor.
-- Idempotent: safe to re-run.
-- =====================================================

CREATE TABLE IF NOT EXISTS content_attributions (
  id                     TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT,
  article_slug           TEXT NOT NULL,
  cluster                TEXT NOT NULL,        -- dealer_quotes|otd_price|dealer_fees|trade_in|leasing
  city                   TEXT NOT NULL,
  state                  TEXT NOT NULL,
  metro                  TEXT,
  source                 TEXT NOT NULL,        -- mirrors buyer_opportunities.source
  buyer_opportunity_id   TEXT,                 -- soft link (application-enforced)
  email                  TEXT,
  lead_temperature       TEXT,
  converted              BOOLEAN NOT NULL DEFAULT FALSE,
  converted_at           TIMESTAMPTZ,
  conversion_value_cents INTEGER,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT content_attributions_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS content_attributions_cluster_idx       ON content_attributions (cluster);
CREATE INDEX IF NOT EXISTS content_attributions_city_state_idx    ON content_attributions (city, state);
CREATE INDEX IF NOT EXISTS content_attributions_metro_idx         ON content_attributions (metro);
CREATE INDEX IF NOT EXISTS content_attributions_article_slug_idx  ON content_attributions (article_slug);
CREATE INDEX IF NOT EXISTS content_attributions_buyer_opp_idx     ON content_attributions (buyer_opportunity_id);
CREATE INDEX IF NOT EXISTS content_attributions_converted_idx     ON content_attributions (converted);

-- Keep updated_at fresh on UPDATE (Prisma @updatedAt parity at the DB layer).
CREATE OR REPLACE FUNCTION set_content_attributions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_content_attributions_updated_at ON content_attributions;
CREATE TRIGGER trg_content_attributions_updated_at
  BEFORE UPDATE ON content_attributions
  FOR EACH ROW
  EXECUTE FUNCTION set_content_attributions_updated_at();
