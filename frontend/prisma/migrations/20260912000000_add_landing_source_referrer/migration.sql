-- Migration: add_landing_source_referrer
-- Hybrid SEO landing system — paid vs organic conversion segmentation.
-- Adds two nullable attribution columns to vehicle_requests:
--   landing_source : semantic FormSource ("lp_facebook", "seo_city_frisco", …)
--   referrer       : document.referrer captured at form mount
-- landing_path was intentionally NOT added — it is redundant with the existing
-- source_url column. IF NOT EXISTS guards keep this idempotent.
--
-- NOTE: This migration is PROPOSED. Do not apply without explicit owner
-- confirmation per repo migration discipline. The request-vehicle API writes
-- these columns with a graceful fallback, so it is safe to deploy code ahead
-- of applying this migration.

ALTER TABLE "vehicle_requests"
  ADD COLUMN IF NOT EXISTS "landing_source" TEXT,
  ADD COLUMN IF NOT EXISTS "referrer"       TEXT;
