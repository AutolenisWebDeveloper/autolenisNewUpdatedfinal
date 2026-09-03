-- Rollback for 20261105000000_inventory_dealer_provenance_and_call_accounting.
--
-- Roll the CODE back FIRST. Dropping these columns under a deployment that still declares them
-- in schema.prisma reintroduces the P2022 this migration exists to avoid.
--
-- Dropping rooftop_id discards resolved listing->rooftop links. They are derived, not authored:
-- the next sweep re-resolves them from the persisted dealer object. Nothing else references
-- them, and no buyer-visible row is deleted -- only the link column goes.
--
-- api_calls_used is dropped with its historical values. Those are observability data, not
-- ledger state; the authoritative month-to-date counter lives on
-- inventory_sources.calls_used_this_cycle and is untouched here.

ALTER TABLE "inventory_items" DROP CONSTRAINT IF EXISTS "inventory_items_rooftop_id_fkey";
DROP INDEX IF EXISTS "inventory_items_rooftop_id_idx";

ALTER TABLE "inventory_items" DROP COLUMN IF EXISTS "rooftop_id";
ALTER TABLE "inventory_items" DROP COLUMN IF EXISTS "mc_dealer_id";
ALTER TABLE "inventory_items" DROP COLUMN IF EXISTS "mc_rooftop_id";
ALTER TABLE "inventory_items" DROP COLUMN IF EXISTS "external_dealer_type";
ALTER TABLE "inventory_items" DROP COLUMN IF EXISTS "external_dealer_email";
ALTER TABLE "inventory_items" DROP COLUMN IF EXISTS "external_dealer_zip";
ALTER TABLE "inventory_items" DROP COLUMN IF EXISTS "external_dealer_street";

ALTER TABLE "inventory_sync_runs" DROP COLUMN IF EXISTS "api_calls_used";
