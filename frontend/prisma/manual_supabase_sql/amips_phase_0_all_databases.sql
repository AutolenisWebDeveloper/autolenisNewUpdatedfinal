-- =====================================================
-- AutoLenis AMIPS Phase 0 — Data Foundation (All 6 Databases)
-- Automotive Market Intelligence Publishing System.
--
-- Creates the six intelligence databases plus the content queue and
-- the AMIPS page store in a single migration. Kept fully separate from
-- content_articles (the Phase C2 keyword system) — both coexist.
--
-- Run this in the Supabase SQL Editor.
-- Idempotent: CREATE TABLE IF NOT EXISTS + guarded enum + triggers.
-- =====================================================

-- -----------------------------------------------------
-- Enum guard pattern (mirrors phase_c1_content_articles.sql).
-- AMIPS Phase 0 stores tier/status/lifecycle as TEXT for forward
-- flexibility, so no new enum types are required here. The guard block
-- below is retained for parity and to make later enum additions safe.
-- -----------------------------------------------------
DO $$
BEGIN
  -- No AMIPS enums at Phase 0. (Lifecycle/status/tier are TEXT.)
  -- Future phases may add e.g. "AmipsLifecycleStatus" here using the
  -- same IF NOT EXISTS guard as "ArticleStatus".
  NULL;
END$$;

-- -----------------------------------------------------
-- Shared updated_at trigger function (one function, many triggers).
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION set_amips_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- DATABASE 1 — vehicle_intelligence
-- =====================================================
CREATE TABLE IF NOT EXISTS vehicle_intelligence (
  id                      TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT,
  make                    TEXT NOT NULL,
  model                   TEXT NOT NULL,
  trim                    TEXT,
  year                    INTEGER NOT NULL,
  msrp_cents              INTEGER NOT NULL,
  fair_market_low_cents   INTEGER NOT NULL,
  fair_market_high_cents  INTEGER NOT NULL,
  aggressive_target_cents INTEGER NOT NULL,
  active_incentives       TEXT,
  incentives_expires_at   TIMESTAMPTZ,
  financing_notes         TEXT,
  lease_notes             TEXT,
  negotiation_difficulty  TEXT NOT NULL,
  data_source             TEXT NOT NULL,
  last_updated            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT vehicle_intelligence_pkey PRIMARY KEY (id)
);

-- Unique on (make, model, trim, year). NULLS NOT DISTINCT so rows with a
-- NULL trim still collide on the same make/model/year (Postgres 15+).
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_intelligence_make_model_trim_year_key
  ON vehicle_intelligence (make, model, trim, year) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS vehicle_intelligence_make_model_idx
  ON vehicle_intelligence (make, model);
CREATE INDEX IF NOT EXISTS vehicle_intelligence_last_updated_idx
  ON vehicle_intelligence (last_updated);

DROP TRIGGER IF EXISTS trg_vehicle_intelligence_updated_at ON vehicle_intelligence;
CREATE TRIGGER trg_vehicle_intelligence_updated_at
  BEFORE UPDATE ON vehicle_intelligence
  FOR EACH ROW EXECUTE FUNCTION set_amips_updated_at();

-- =====================================================
-- DATABASE 2 — dealer_intelligence
-- =====================================================
CREATE TABLE IF NOT EXISTS dealer_intelligence (
  id                   TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT,
  dealer_name          TEXT NOT NULL,
  brand                TEXT NOT NULL,
  city                 TEXT NOT NULL,
  state                TEXT NOT NULL,
  zip                  TEXT NOT NULL,
  latitude             DOUBLE PRECISION,
  longitude            DOUBLE PRECISION,
  website              TEXT,
  inventory_signal     TEXT NOT NULL DEFAULT 'normal',
  dealer_density_score DOUBLE PRECISION,
  dealers_within_30mi  INTEGER,
  data_source          TEXT NOT NULL,
  last_updated         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT dealer_intelligence_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS dealer_intelligence_brand_city_state_idx
  ON dealer_intelligence (brand, city, state);
CREATE INDEX IF NOT EXISTS dealer_intelligence_state_idx
  ON dealer_intelligence (state);
CREATE INDEX IF NOT EXISTS dealer_intelligence_last_updated_idx
  ON dealer_intelligence (last_updated);

DROP TRIGGER IF EXISTS trg_dealer_intelligence_updated_at ON dealer_intelligence;
CREATE TRIGGER trg_dealer_intelligence_updated_at
  BEFORE UPDATE ON dealer_intelligence
  FOR EACH ROW EXECUTE FUNCTION set_amips_updated_at();

-- =====================================================
-- DATABASE 3 — market_intelligence
-- =====================================================
CREATE TABLE IF NOT EXISTS market_intelligence (
  id                   TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT,
  metro_name           TEXT NOT NULL,
  state                TEXT NOT NULL,
  population           INTEGER,
  vehicle_demand_score DOUBLE PRECISION,
  competition_score    DOUBLE PRECISION,
  inventory_score      DOUBLE PRECISION,
  buyer_leverage_score DOUBLE PRECISION,
  seasonal_notes       TEXT,
  last_updated         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT market_intelligence_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS market_intelligence_metro_name_state_key
  ON market_intelligence (metro_name, state);
CREATE INDEX IF NOT EXISTS market_intelligence_state_idx
  ON market_intelligence (state);
CREATE INDEX IF NOT EXISTS market_intelligence_buyer_leverage_score_idx
  ON market_intelligence (buyer_leverage_score);

DROP TRIGGER IF EXISTS trg_market_intelligence_updated_at ON market_intelligence;
CREATE TRIGGER trg_market_intelligence_updated_at
  BEFORE UPDATE ON market_intelligence
  FOR EACH ROW EXECUTE FUNCTION set_amips_updated_at();

-- =====================================================
-- DATABASE 4 — autolenis_intelligence
-- =====================================================
CREATE TABLE IF NOT EXISTS autolenis_intelligence (
  id                         TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT,
  metro                      TEXT NOT NULL,
  vehicle_make               TEXT NOT NULL,
  vehicle_model              TEXT NOT NULL,
  request_volume             INTEGER NOT NULL DEFAULT 0,
  dealer_response_rate       DOUBLE PRECISION,
  avg_offers_received        DOUBLE PRECISION,
  verified_savings_avg_cents INTEGER,
  offer_win_rate             DOUBLE PRECISION,
  transaction_count          INTEGER NOT NULL DEFAULT 0,
  period_month               TEXT NOT NULL,
  last_updated               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT autolenis_intelligence_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS autolenis_intelligence_metro_make_model_period_key
  ON autolenis_intelligence (metro, vehicle_make, vehicle_model, period_month);
CREATE INDEX IF NOT EXISTS autolenis_intelligence_metro_idx
  ON autolenis_intelligence (metro);
CREATE INDEX IF NOT EXISTS autolenis_intelligence_transaction_count_idx
  ON autolenis_intelligence (transaction_count);

DROP TRIGGER IF EXISTS trg_autolenis_intelligence_updated_at ON autolenis_intelligence;
CREATE TRIGGER trg_autolenis_intelligence_updated_at
  BEFORE UPDATE ON autolenis_intelligence
  FOR EACH ROW EXECUTE FUNCTION set_amips_updated_at();

-- =====================================================
-- DATABASE 5 — search_intelligence
-- =====================================================
CREATE TABLE IF NOT EXISTS search_intelligence (
  id                  TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT,
  url                 TEXT NOT NULL,
  content_tier        TEXT NOT NULL,
  search_impressions  INTEGER NOT NULL DEFAULT 0,
  clicks              INTEGER NOT NULL DEFAULT 0,
  ctr                 DOUBLE PRECISION,
  avg_position        DOUBLE PRECISION,
  indexed_status      BOOLEAN NOT NULL DEFAULT FALSE,
  leads_generated     INTEGER NOT NULL DEFAULT 0,
  conversion_rate     DOUBLE PRECISION,
  revenue_attribution INTEGER NOT NULL DEFAULT 0,
  week_of             TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT search_intelligence_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS search_intelligence_url_week_of_key
  ON search_intelligence (url, week_of);
CREATE INDEX IF NOT EXISTS search_intelligence_content_tier_idx
  ON search_intelligence (content_tier);
CREATE INDEX IF NOT EXISTS search_intelligence_week_of_idx
  ON search_intelligence (week_of);
CREATE INDEX IF NOT EXISTS search_intelligence_leads_generated_idx
  ON search_intelligence (leads_generated);

DROP TRIGGER IF EXISTS trg_search_intelligence_updated_at ON search_intelligence;
CREATE TRIGGER trg_search_intelligence_updated_at
  BEFORE UPDATE ON search_intelligence
  FOR EACH ROW EXECUTE FUNCTION set_amips_updated_at();

-- =====================================================
-- DATABASE 6 — marketplace_intelligence
-- =====================================================
CREATE TABLE IF NOT EXISTS marketplace_intelligence (
  id                          TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT,
  vehicle_make                TEXT NOT NULL,
  vehicle_model               TEXT NOT NULL,
  vehicle_trim                TEXT,
  metro                       TEXT NOT NULL,
  dealers_invited             INTEGER NOT NULL DEFAULT 0,
  dealers_responded           INTEGER NOT NULL DEFAULT 0,
  response_rate               DOUBLE PRECISION,
  time_to_first_offer_minutes INTEGER,
  time_to_final_offer_minutes INTEGER,
  buyer_accepted_offer        BOOLEAN,
  avg_offers_per_request      DOUBLE PRECISION,
  lead_to_request_conversion  DOUBLE PRECISION,
  request_to_deal_conversion  DOUBLE PRECISION,
  transaction_date            TIMESTAMPTZ NOT NULL,
  buyer_opportunity_id        TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketplace_intelligence_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS marketplace_intelligence_make_model_idx
  ON marketplace_intelligence (vehicle_make, vehicle_model);
CREATE INDEX IF NOT EXISTS marketplace_intelligence_metro_idx
  ON marketplace_intelligence (metro);
CREATE INDEX IF NOT EXISTS marketplace_intelligence_transaction_date_idx
  ON marketplace_intelligence (transaction_date);

DROP TRIGGER IF EXISTS trg_marketplace_intelligence_updated_at ON marketplace_intelligence;
CREATE TRIGGER trg_marketplace_intelligence_updated_at
  BEFORE UPDATE ON marketplace_intelligence
  FOR EACH ROW EXECUTE FUNCTION set_amips_updated_at();

-- =====================================================
-- content_queue
-- =====================================================
CREATE TABLE IF NOT EXISTS content_queue (
  id              TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT,
  priority_score  DOUBLE PRECISION NOT NULL,
  content_tier    TEXT NOT NULL,
  make            TEXT,
  model           TEXT,
  metro           TEXT,
  state           TEXT,
  intent_template TEXT NOT NULL,
  keyword_target  TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  failure_reason  TEXT,
  scheduled_date  TIMESTAMPTZ,
  content_page_id TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT content_queue_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS content_queue_status_priority_idx
  ON content_queue (status, priority_score);
CREATE INDEX IF NOT EXISTS content_queue_content_tier_idx
  ON content_queue (content_tier);
CREATE INDEX IF NOT EXISTS content_queue_scheduled_date_idx
  ON content_queue (scheduled_date);

DROP TRIGGER IF EXISTS trg_content_queue_updated_at ON content_queue;
CREATE TRIGGER trg_content_queue_updated_at
  BEFORE UPDATE ON content_queue
  FOR EACH ROW EXECUTE FUNCTION set_amips_updated_at();

-- =====================================================
-- amips_pages  (kept separate from content_articles)
-- =====================================================
CREATE TABLE IF NOT EXISTS amips_pages (
  id                  TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT,
  slug                TEXT NOT NULL,
  content_tier        TEXT NOT NULL,
  make                TEXT,
  model               TEXT,
  metro               TEXT,
  state               TEXT,
  title               TEXT NOT NULL,
  meta_description    TEXT NOT NULL,
  h1                  TEXT NOT NULL,
  body                TEXT NOT NULL,
  faq_json            TEXT,
  market_score_json   TEXT,
  data_token_count    INTEGER NOT NULL DEFAULT 0,
  cta_type            TEXT NOT NULL,
  lifecycle_status    TEXT NOT NULL DEFAULT 'ACTIVE',
  quality_gate_status TEXT NOT NULL,
  quality_gate_flags  TEXT,
  vehicle_data_as_of  TIMESTAMPTZ,
  dealer_data_as_of   TIMESTAMPTZ,
  market_data_as_of   TIMESTAMPTZ,
  published_at        TIMESTAMPTZ,
  last_refreshed_at   TIMESTAMPTZ,
  impressions         INTEGER NOT NULL DEFAULT 0,
  clicks              INTEGER NOT NULL DEFAULT 0,
  leads_generated     INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT amips_pages_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS amips_pages_slug_key
  ON amips_pages (slug);
CREATE INDEX IF NOT EXISTS amips_pages_tier_lifecycle_idx
  ON amips_pages (content_tier, lifecycle_status);
CREATE INDEX IF NOT EXISTS amips_pages_make_model_metro_idx
  ON amips_pages (make, model, metro);
CREATE INDEX IF NOT EXISTS amips_pages_published_at_idx
  ON amips_pages (published_at);
CREATE INDEX IF NOT EXISTS amips_pages_lifecycle_status_idx
  ON amips_pages (lifecycle_status);

DROP TRIGGER IF EXISTS trg_amips_pages_updated_at ON amips_pages;
CREATE TRIGGER trg_amips_pages_updated_at
  BEFORE UPDATE ON amips_pages
  FOR EACH ROW EXECUTE FUNCTION set_amips_updated_at();

-- =====================================================
-- Verification (should return 8 rows):
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public'
--   AND table_name IN (
--     'vehicle_intelligence', 'dealer_intelligence',
--     'market_intelligence', 'autolenis_intelligence',
--     'search_intelligence', 'marketplace_intelligence',
--     'content_queue', 'amips_pages'
--   )
--   ORDER BY table_name;
-- =====================================================
