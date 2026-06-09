-- Session C — Viral Intelligence Layer
-- Run against Supabase/Postgres to bring the DB in sync with schema.prisma.

-- 1. Cache table for live trending intelligence (TikTok hashtags, Reddit
--    topics, Google Trends), shared across a ~23h TTL window.
CREATE TABLE IF NOT EXISTS social_intelligence_cache (
  id         TEXT        NOT NULL PRIMARY KEY,
  cache_key  TEXT        NOT NULL UNIQUE,
  data       JSONB       NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Video-learning rolling average of completion rate per winning pattern.
ALTER TABLE winning_patterns
  ADD COLUMN IF NOT EXISTS avg_completion_rate DOUBLE PRECISION;
