-- Rollback for 20261104000000_inventory_source_market_config.
--
-- Safe to run once the CODE has been rolled back first: nothing references these
-- columns by foreign key, index, or constraint, and no other table reads them.
-- Dropping them loses the configured market for every source, after which the
-- orchestrator falls back to the INVENTORY_DEFAULT_MARKET_ZIP environment
-- variable -- and, with that unset, syncs nothing rather than a default market.
--
-- Record the configured markets before dropping if you intend to restore them:
--   SELECT type, name, market_label, market_zip, market_lat, market_lng,
--          market_radius_miles, market_makes, market_price_max_cents,
--          market_year_min, market_year_max
--     FROM inventory_sources;

ALTER TABLE "inventory_sources" DROP COLUMN IF EXISTS "market_label";
ALTER TABLE "inventory_sources" DROP COLUMN IF EXISTS "market_zip";
ALTER TABLE "inventory_sources" DROP COLUMN IF EXISTS "market_lat";
ALTER TABLE "inventory_sources" DROP COLUMN IF EXISTS "market_lng";
ALTER TABLE "inventory_sources" DROP COLUMN IF EXISTS "market_radius_miles";
ALTER TABLE "inventory_sources" DROP COLUMN IF EXISTS "market_makes";
ALTER TABLE "inventory_sources" DROP COLUMN IF EXISTS "market_price_max_cents";
ALTER TABLE "inventory_sources" DROP COLUMN IF EXISTS "market_year_min";
ALTER TABLE "inventory_sources" DROP COLUMN IF EXISTS "market_year_max";
