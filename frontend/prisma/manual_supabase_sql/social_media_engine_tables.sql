-- =====================================================
-- AutoLenis Social Intelligence & Media Engine — Session 1
-- Full-automation content / video / publishing / attribution pipeline.
--
-- Creates the 12 social_* tables, two enum types, the 9 content-franchise
-- seed rows, and default posting windows for all 5 platforms x 7 days.
--
-- Run this in the Supabase SQL Editor.
-- Idempotent: CREATE TABLE IF NOT EXISTS + guarded enums + ON CONFLICT seeds.
-- Mirrors prisma/schema.prisma exactly (column names from @map decorators).
-- =====================================================

-- -----------------------------------------------------
-- Enum types (guarded — CREATE TYPE has no IF NOT EXISTS in Postgres).
-- -----------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SocialPostStatus') THEN
    CREATE TYPE "SocialPostStatus" AS ENUM (
      'DRAFT','PENDING_REVIEW','APPROVED','SCHEDULED','PUBLISHING',
      'PUBLISHED','FAILED','SKIPPED','REJECTED'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SocialVideoStatus') THEN
    CREATE TYPE "SocialVideoStatus" AS ENUM (
      'SCRIPT_READY','VIDEO_QUEUED','VIDEO_GENERATING',
      'VIDEO_READY','VIDEO_FAILED','PUBLISH_READY'
    );
  END IF;
END$$;

-- -----------------------------------------------------
-- Shared updated_at trigger function (one function, many triggers).
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION set_social_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------
-- 1. content_franchises
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS content_franchises (
  id               TEXT PRIMARY KEY,
  slug             TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  description      TEXT,
  platforms        TEXT[] NOT NULL DEFAULT '{}',
  cadence          TEXT NOT NULL,
  "postingSlots"   INTEGER[] NOT NULL DEFAULT '{}',
  "hookTypes"      TEXT[] NOT NULL DEFAULT '{}',
  "requiresReview" BOOLEAN NOT NULL DEFAULT FALSE,
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  avg_lead_score   DOUBLE PRECISION,
  posts_generated  INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP(3) NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_content_franchises_updated_at ON content_franchises;
CREATE TRIGGER trg_content_franchises_updated_at
  BEFORE UPDATE ON content_franchises
  FOR EACH ROW EXECUTE FUNCTION set_social_updated_at();

-- -----------------------------------------------------
-- 2. topic_signals
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS topic_signals (
  id               TEXT PRIMARY KEY,
  signal_type      TEXT NOT NULL,
  make             TEXT,
  model            TEXT,
  city             TEXT,
  metro            TEXT,
  state            TEXT,
  signal_value     DOUBLE PRECISION,
  signal_delta     DOUBLE PRECISION,
  signal_context   JSONB NOT NULL DEFAULT '{}',
  source_table     TEXT,
  source_id        TEXT,
  assets_generated BOOLEAN NOT NULL DEFAULT FALSE,
  asset_count      INTEGER NOT NULL DEFAULT 0,
  detected_at      TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMP(3),
  created_at       TIMESTAMP(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS topic_signals_signal_type_idx ON topic_signals (signal_type);
CREATE INDEX IF NOT EXISTS topic_signals_make_model_city_idx ON topic_signals (make, model, city);
CREATE INDEX IF NOT EXISTS topic_signals_assets_generated_idx ON topic_signals (assets_generated);
CREATE INDEX IF NOT EXISTS topic_signals_detected_at_idx ON topic_signals (detected_at);

-- -----------------------------------------------------
-- 3. social_posts
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS social_posts (
  id                        TEXT PRIMARY KEY,
  franchise_id              TEXT REFERENCES content_franchises(id),
  signal_id                 TEXT REFERENCES topic_signals(id),
  source_article_id         TEXT,
  source_vehicle_request_id TEXT,
  platform                  TEXT NOT NULL,
  content_type              TEXT NOT NULL,
  hook_type                 TEXT,
  hook                      TEXT NOT NULL,
  script                    TEXT NOT NULL,
  caption                   TEXT NOT NULL,
  hashtags                  TEXT[] NOT NULL DEFAULT '{}',
  cta_text                  TEXT,
  cta_placement             TEXT,
  visual_prompt             TEXT,
  visual_style              TEXT,
  voiceover_text            TEXT,
  on_screen_text            TEXT,
  duration_seconds          INTEGER,
  geo_target                TEXT,
  make                      TEXT,
  model                     TEXT,
  metro                     TEXT,
  state                     TEXT,
  funnel_destination        TEXT,
  utm_source                TEXT,
  utm_medium                TEXT,
  utm_campaign              TEXT,
  utm_content               TEXT,
  utm_term                  TEXT,
  utm_hook                  TEXT,
  utm_platform              TEXT,
  tracked_url               TEXT,
  compliance_notes          TEXT,
  requires_review           BOOLEAN NOT NULL DEFAULT FALSE,
  automation_mode           TEXT NOT NULL DEFAULT 'HYBRID_AUTO',
  status                    "SocialPostStatus" NOT NULL DEFAULT 'DRAFT',
  rejection_reason          TEXT,
  scheduled_at              TIMESTAMP(3),
  published_at              TIMESTAMP(3),
  publishing_provider       TEXT,
  platform_post_id          TEXT,
  publish_error             TEXT,
  publish_attempts          INTEGER NOT NULL DEFAULT 0,
  lead_score                INTEGER NOT NULL DEFAULT 0,
  creator_id                TEXT,
  affiliate_id              TEXT,
  created_at                TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMP(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS social_posts_platform_status_idx ON social_posts (platform, status);
CREATE INDEX IF NOT EXISTS social_posts_scheduled_at_idx ON social_posts (scheduled_at);
CREATE INDEX IF NOT EXISTS social_posts_franchise_id_idx ON social_posts (franchise_id);
CREATE INDEX IF NOT EXISTS social_posts_signal_id_idx ON social_posts (signal_id);
CREATE INDEX IF NOT EXISTS social_posts_status_idx ON social_posts (status);
CREATE INDEX IF NOT EXISTS social_posts_created_at_idx ON social_posts (created_at);
DROP TRIGGER IF EXISTS trg_social_posts_updated_at ON social_posts;
CREATE TRIGGER trg_social_posts_updated_at
  BEFORE UPDATE ON social_posts
  FOR EACH ROW EXECUTE FUNCTION set_social_updated_at();

-- -----------------------------------------------------
-- 4. social_videos
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS social_videos (
  id               TEXT PRIMARY KEY,
  post_id          TEXT NOT NULL UNIQUE REFERENCES social_posts(id) ON DELETE CASCADE,
  provider         TEXT NOT NULL DEFAULT 'higgsfield',
  provider_job_id  TEXT,
  status           "SocialVideoStatus" NOT NULL DEFAULT 'SCRIPT_READY',
  visual_prompt    TEXT,
  duration_seconds INTEGER,
  style            TEXT,
  video_url        TEXT,
  thumbnail_url    TEXT,
  file_size        INTEGER,
  duration_actual  DOUBLE PRECISION,
  last_polled_at   TIMESTAMP(3),
  poll_attempts    INTEGER NOT NULL DEFAULT 0,
  error_message    TEXT,
  retry_count      INTEGER NOT NULL DEFAULT 0,
  storage_path     TEXT,
  storage_bucket   TEXT,
  generated_at     TIMESTAMP(3),
  created_at       TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS social_videos_status_idx ON social_videos (status);
CREATE INDEX IF NOT EXISTS social_videos_provider_job_id_idx ON social_videos (provider_job_id);
DROP TRIGGER IF EXISTS trg_social_videos_updated_at ON social_videos;
CREATE TRIGGER trg_social_videos_updated_at
  BEFORE UPDATE ON social_videos
  FOR EACH ROW EXECUTE FUNCTION set_social_updated_at();

-- -----------------------------------------------------
-- 5. social_performance
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS social_performance (
  id                TEXT PRIMARY KEY,
  post_id           TEXT NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  impressions       INTEGER NOT NULL DEFAULT 0,
  reach             INTEGER NOT NULL DEFAULT 0,
  views             INTEGER NOT NULL DEFAULT 0,
  watch_time_pct    DOUBLE PRECISION,
  completion_rate   DOUBLE PRECISION,
  likes             INTEGER NOT NULL DEFAULT 0,
  comments          INTEGER NOT NULL DEFAULT 0,
  shares            INTEGER NOT NULL DEFAULT 0,
  saves             INTEGER NOT NULL DEFAULT 0,
  link_clicks       INTEGER NOT NULL DEFAULT 0,
  profile_visits    INTEGER NOT NULL DEFAULT 0,
  vehicle_requests  INTEGER NOT NULL DEFAULT 0,
  dealer_signups    INTEGER NOT NULL DEFAULT 0,
  dealer_bids       INTEGER NOT NULL DEFAULT 0,
  deals_won         INTEGER NOT NULL DEFAULT 0,
  revenue_generated INTEGER NOT NULL DEFAULT 0,
  lead_score        INTEGER NOT NULL DEFAULT 0,
  recorded_at       TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMP(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS social_performance_post_id_idx ON social_performance (post_id);
CREATE INDEX IF NOT EXISTS social_performance_recorded_at_idx ON social_performance (recorded_at);

-- -----------------------------------------------------
-- 6. content_derivatives
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS content_derivatives (
  id                TEXT PRIMARY KEY,
  signal_id         TEXT REFERENCES topic_signals(id),
  source_article_id TEXT,
  post_id           TEXT NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  platform          TEXT NOT NULL,
  derivative_type   TEXT NOT NULL,
  created_at        TIMESTAMP(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS content_derivatives_signal_id_idx ON content_derivatives (signal_id);
CREATE INDEX IF NOT EXISTS content_derivatives_source_article_id_idx ON content_derivatives (source_article_id);

-- -----------------------------------------------------
-- 7. winning_patterns
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS winning_patterns (
  id                   TEXT PRIMARY KEY,
  platform             TEXT NOT NULL,
  franchise_slug       TEXT,
  hook_type            TEXT,
  content_type         TEXT,
  geo_target           TEXT,
  make                 TEXT,
  day_of_week          INTEGER,
  hour                 INTEGER,
  avg_ctr              DOUBLE PRECISION,
  avg_engagement       DOUBLE PRECISION,
  avg_lead_score       DOUBLE PRECISION,
  avg_vehicle_requests DOUBLE PRECISION,
  avg_revenue          DOUBLE PRECISION,
  sample_size          INTEGER NOT NULL DEFAULT 0,
  last_updated         TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  created_at           TIMESTAMP(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS winning_patterns_platform_hook_type_idx ON winning_patterns (platform, hook_type);
CREATE INDEX IF NOT EXISTS winning_patterns_platform_franchise_slug_idx ON winning_patterns (platform, franchise_slug);

-- -----------------------------------------------------
-- 8. posting_windows
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS posting_windows (
  id                 TEXT PRIMARY KEY,
  platform           TEXT NOT NULL,
  day_of_week        INTEGER NOT NULL,
  slot_1_hour        INTEGER NOT NULL DEFAULT 7,
  slot_2_hour        INTEGER NOT NULL DEFAULT 12,
  slot_3_hour        INTEGER NOT NULL DEFAULT 19,
  slot_4_hour        INTEGER,
  slot_5_hour        INTEGER,
  last_optimized_at  TIMESTAMP(3),
  created_at         TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  UNIQUE (platform, day_of_week)
);
DROP TRIGGER IF EXISTS trg_posting_windows_updated_at ON posting_windows;
CREATE TRIGGER trg_posting_windows_updated_at
  BEFORE UPDATE ON posting_windows
  FOR EACH ROW EXECUTE FUNCTION set_social_updated_at();

-- -----------------------------------------------------
-- 9. hook_performance
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS hook_performance (
  id                   TEXT PRIMARY KEY,
  platform             TEXT NOT NULL,
  hook_type            TEXT NOT NULL,
  avg_completion_rate  DOUBLE PRECISION,
  avg_ctr              DOUBLE PRECISION,
  avg_lead_score       DOUBLE PRECISION,
  avg_vehicle_requests DOUBLE PRECISION,
  sample_size          INTEGER NOT NULL DEFAULT 0,
  last_updated         TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  created_at           TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  UNIQUE (platform, hook_type)
);

-- -----------------------------------------------------
-- 10. creator_network
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS creator_network (
  id              TEXT PRIMARY KEY,
  affiliate_id    TEXT,
  name            TEXT NOT NULL,
  email           TEXT,
  platform        TEXT NOT NULL,
  platforms       TEXT[] NOT NULL DEFAULT '{}',
  handle          TEXT,
  follower_count  INTEGER,
  engagement_rate DOUBLE PRECISION,
  niche           TEXT,
  city            TEXT,
  state           TEXT,
  commission_rate DOUBLE PRECISION,
  status          TEXT NOT NULL DEFAULT 'PENDING',
  total_posts     INTEGER NOT NULL DEFAULT 0,
  total_clicks    INTEGER NOT NULL DEFAULT 0,
  total_requests  INTEGER NOT NULL DEFAULT 0,
  total_revenue   INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS creator_network_status_idx ON creator_network (status);
CREATE INDEX IF NOT EXISTS creator_network_platform_idx ON creator_network (platform);
DROP TRIGGER IF EXISTS trg_creator_network_updated_at ON creator_network;
CREATE TRIGGER trg_creator_network_updated_at
  BEFORE UPDATE ON creator_network
  FOR EACH ROW EXECUTE FUNCTION set_social_updated_at();

-- -----------------------------------------------------
-- 11. creator_attributions
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS creator_attributions (
  id                TEXT PRIMARY KEY,
  creator_id        TEXT NOT NULL REFERENCES creator_network(id),
  post_id           TEXT NOT NULL,
  platform          TEXT NOT NULL,
  platform_post_id  TEXT,
  tracking_code     TEXT,
  tracked_url       TEXT,
  clicks            INTEGER NOT NULL DEFAULT 0,
  vehicle_requests  INTEGER NOT NULL DEFAULT 0,
  dealer_signups    INTEGER NOT NULL DEFAULT 0,
  deals_won         INTEGER NOT NULL DEFAULT 0,
  revenue_generated INTEGER NOT NULL DEFAULT 0,
  commission_earned INTEGER NOT NULL DEFAULT 0,
  published_at      TIMESTAMP(3),
  created_at        TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS creator_attributions_creator_id_idx ON creator_attributions (creator_id);
CREATE INDEX IF NOT EXISTS creator_attributions_post_id_idx ON creator_attributions (post_id);
DROP TRIGGER IF EXISTS trg_creator_attributions_updated_at ON creator_attributions;
CREATE TRIGGER trg_creator_attributions_updated_at
  BEFORE UPDATE ON creator_attributions
  FOR EACH ROW EXECUTE FUNCTION set_social_updated_at();

-- -----------------------------------------------------
-- 12. revenue_attributions
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS revenue_attributions (
  id                  TEXT PRIMARY KEY,
  post_id             TEXT NOT NULL REFERENCES social_posts(id),
  utm_source          TEXT,
  utm_campaign        TEXT,
  utm_content         TEXT,
  utm_hook            TEXT,
  utm_platform        TEXT,
  vehicle_request_id  TEXT,
  deal_id             TEXT,
  creator_id          TEXT,
  affiliate_id        TEXT,
  deposit_amount_cents INTEGER,
  fee_amount_cents    INTEGER,
  total_revenue_cents INTEGER,
  attribution_status  TEXT NOT NULL DEFAULT 'CLICK',
  clicked_at          TIMESTAMP(3),
  requested_at        TIMESTAMP(3),
  deal_won_at         TIMESTAMP(3),
  created_at          TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS revenue_attributions_post_id_idx ON revenue_attributions (post_id);
CREATE INDEX IF NOT EXISTS revenue_attributions_vehicle_request_id_idx ON revenue_attributions (vehicle_request_id);
CREATE INDEX IF NOT EXISTS revenue_attributions_deal_id_idx ON revenue_attributions (deal_id);
CREATE INDEX IF NOT EXISTS revenue_attributions_attribution_status_idx ON revenue_attributions (attribution_status);
DROP TRIGGER IF EXISTS trg_revenue_attributions_updated_at ON revenue_attributions;
CREATE TRIGGER trg_revenue_attributions_updated_at
  BEFORE UPDATE ON revenue_attributions
  FOR EACH ROW EXECUTE FUNCTION set_social_updated_at();

-- =====================================================
-- SEED — 9 content franchises.
-- =====================================================
INSERT INTO content_franchises
  (id, slug, name, description, platforms, cadence,
   "postingSlots", "hookTypes", "requiresReview", active)
VALUES
  (gen_random_uuid(), 'dealer_secret_daily',
   'Dealer Secret of the Day',
   'Daily educational content exposing dealer fees and tactics',
   ARRAY['tiktok','instagram','facebook'],
   'daily', ARRAY[7,19],
   ARRAY['fear','warning','controversy'],
   false, true),

  (gen_random_uuid(), 'city_market_alert',
   'City Market Alert',
   'Geo-targeted market condition alerts per city',
   ARRAY['facebook','instagram','linkedin'],
   'daily', ARRAY[7,12],
   ARRAY['savings','social_proof','surprise'],
   false, true),

  (gen_random_uuid(), 'vehicle_price_watch',
   'Vehicle Price Watch',
   'Weekly price movement tracking per make/model/city',
   ARRAY['tiktok','instagram','facebook','youtube'],
   'weekly', ARRAY[12,19],
   ARRAY['savings','surprise','comparison'],
   true, true),

  (gen_random_uuid(), 'trade_in_tuesday',
   'Trade-In Tuesday',
   'Weekly trade-in value tips and market insights',
   ARRAY['facebook','instagram','tiktok'],
   'tuesday', ARRAY[7,12],
   ARRAY['savings','curiosity','warning'],
   true, true),

  (gen_random_uuid(), 'financing_friday',
   'Financing Friday',
   'Weekly financing rate alerts and payment tips',
   ARRAY['facebook','instagram','tiktok'],
   'friday', ARRAY[7,12],
   ARRAY['warning','savings','curiosity'],
   true, true),

  (gen_random_uuid(), 'dealer_fee_breakdown',
   'Dealer Fee Breakdown',
   'Educational breakdown of specific dealer fees',
   ARRAY['tiktok','instagram','youtube'],
   'daily', ARRAY[12,19],
   ARRAY['controversy','fear','warning'],
   false, true),

  (gen_random_uuid(), 'autolenis_market_index',
   'AutoLenis Market Index',
   'Weekly automotive market intelligence report',
   ARRAY['linkedin','facebook','instagram'],
   'weekly', ARRAY[7],
   ARRAY['social_proof','savings','surprise'],
   true, true),

  (gen_random_uuid(), 'buyer_win_story',
   'Buyer Win Story',
   'Social proof stories from AutoLenis buyers',
   ARRAY['facebook','instagram','tiktok'],
   'daily', ARRAY[19],
   ARRAY['social_proof','surprise','comparison'],
   true, true),

  (gen_random_uuid(), 'how_autolenis_works',
   'How AutoLenis Works',
   'Process education and platform explainers',
   ARRAY['tiktok','youtube','instagram','facebook'],
   'daily', ARRAY[12,19],
   ARRAY['curiosity','comparison','social_proof'],
   false, true)
ON CONFLICT (slug) DO NOTHING;

-- =====================================================
-- SEED — default posting windows: 7 AM / 12 PM / 7 PM CT
-- for all 5 platforms x 7 days (0=Sun .. 6=Sat).
-- =====================================================
INSERT INTO posting_windows (id, platform, day_of_week, slot_1_hour, slot_2_hour, slot_3_hour)
SELECT gen_random_uuid(), p.platform, d.dow, 7, 12, 19
FROM (VALUES ('facebook'),('instagram'),('tiktok'),('youtube'),('linkedin')) AS p(platform)
CROSS JOIN (VALUES (0),(1),(2),(3),(4),(5),(6)) AS d(dow)
ON CONFLICT (platform, day_of_week) DO NOTHING;
