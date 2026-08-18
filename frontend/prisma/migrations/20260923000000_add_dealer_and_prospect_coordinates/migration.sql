-- Y5 (Block A / unified sourcing) — geocoded coordinates on Dealer + DealerProspect.
--
-- Additive, nullable, idempotent. Coordinates are backfilled from each row's ZIP
-- via the geocoding adapter (static ZIP map -> cache -> Google), then read by the
-- unified-sourcing geo filter in place of the static ZIP_COORDS lookup.
--
-- Rollback:
--   ALTER TABLE "dealers" DROP COLUMN IF EXISTS "latitude";
--   ALTER TABLE "dealers" DROP COLUMN IF EXISTS "longitude";
--   ALTER TABLE "dealer_prospects" DROP COLUMN IF EXISTS "latitude";
--   ALTER TABLE "dealer_prospects" DROP COLUMN IF EXISTS "longitude";

ALTER TABLE "dealers" ADD COLUMN IF NOT EXISTS "latitude" DOUBLE PRECISION;
ALTER TABLE "dealers" ADD COLUMN IF NOT EXISTS "longitude" DOUBLE PRECISION;

ALTER TABLE "dealer_prospects" ADD COLUMN IF NOT EXISTS "latitude" DOUBLE PRECISION;
ALTER TABLE "dealer_prospects" ADD COLUMN IF NOT EXISTS "longitude" DOUBLE PRECISION;
