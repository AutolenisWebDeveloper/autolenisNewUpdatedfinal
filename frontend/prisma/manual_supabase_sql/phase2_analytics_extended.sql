-- Phase 2 — Native Platform Analytics — extended SocialPerformance columns.
--
-- The Prisma SocialPerformance model already declares the extended analytics
-- columns (saves, profile_visits, watch_time_pct, completion_rate). This script
-- is idempotent and safe to run against an environment whose social_performance
-- table predates those columns. Run in Supabase after merge.

-- Saves (Instagram, TikTok, YouTube favorites).
ALTER TABLE social_performance
  ADD COLUMN IF NOT EXISTS saves INTEGER NOT NULL DEFAULT 0;

-- Profile visits (TikTok, Instagram).
ALTER TABLE social_performance
  ADD COLUMN IF NOT EXISTS profile_visits INTEGER NOT NULL DEFAULT 0;

-- Watch-time percentage / completion rate (TikTok, YouTube; 0-1).
ALTER TABLE social_performance
  ADD COLUMN IF NOT EXISTS watch_time_pct DOUBLE PRECISION;

ALTER TABLE social_performance
  ADD COLUMN IF NOT EXISTS completion_rate DOUBLE PRECISION;

-- Audience demographics reuse the existing social_intelligence_cache table,
-- keyed by `audience_<platform>` (audience_instagram, audience_tiktok, ...).
-- No new tables needed.
