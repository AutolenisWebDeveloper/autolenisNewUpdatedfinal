-- Session C — Viral Intelligence Layer
-- Run against Supabase (manual SQL). Idempotent.

-- 1. SocialIntelligenceCache: key/value JSON cache with TTL for trending data.
CREATE TABLE IF NOT EXISTS social_intelligence_cache (
  id         TEXT        NOT NULL PRIMARY KEY,
  cache_key  TEXT        NOT NULL UNIQUE,
  data       JSONB       NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. WinningPattern.avgCompletionRate: rolling completion-rate average per
--    (platform, franchise, hook) used by the video-learning engine.
ALTER TABLE winning_patterns
  ADD COLUMN IF NOT EXISTS avg_completion_rate DOUBLE PRECISION;
