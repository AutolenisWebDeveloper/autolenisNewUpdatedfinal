-- Phase 2 correction — null-vs-zero contract for SocialPerformance metrics.
--
-- Platform reach/engagement metrics must be able to store NULL to mark a metric
-- as *unavailable* (deprecated Graph field, or an endpoint not in scope for our
-- token), distinct from a confirmed 0. The DEFAULT 0 is retained so writers that
-- omit a column keep the old zero behavior; only an explicit NULL records
-- "unknown" so the optimization loop can exclude it.
--
-- Idempotent: DROP NOT NULL is a no-op if the column is already nullable.
-- Run in Supabase BEFORE deploying the code that writes NULLs.

ALTER TABLE social_performance ALTER COLUMN impressions    DROP NOT NULL;
ALTER TABLE social_performance ALTER COLUMN reach          DROP NOT NULL;
ALTER TABLE social_performance ALTER COLUMN views          DROP NOT NULL;
ALTER TABLE social_performance ALTER COLUMN likes          DROP NOT NULL;
ALTER TABLE social_performance ALTER COLUMN comments       DROP NOT NULL;
ALTER TABLE social_performance ALTER COLUMN shares         DROP NOT NULL;
ALTER TABLE social_performance ALTER COLUMN saves          DROP NOT NULL;
ALTER TABLE social_performance ALTER COLUMN link_clicks    DROP NOT NULL;
ALTER TABLE social_performance ALTER COLUMN profile_visits DROP NOT NULL;

-- watch_time_pct and completion_rate are already nullable (Float?).
-- Business counters (vehicle_requests, dealer_signups, dealer_bids, deals_won,
-- revenue_generated, lead_score) remain NOT NULL — they are derived internally,
-- never "unavailable".
