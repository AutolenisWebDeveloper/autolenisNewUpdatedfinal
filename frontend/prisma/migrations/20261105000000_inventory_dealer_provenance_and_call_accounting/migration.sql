-- Inventory: persist the provider's dealer object, link listings to a holding rooftop, and
-- record per-run provider call consumption.
--
-- WRITTEN BUT NOT APPLIED. Ships for owner review; applies after 20261104000000.
--
-- WHY (dealer provenance): 0 of 148 active inventory_items carry a dealer_id, so a swept
-- listing names a dealership the platform cannot match to anything it owns. The adapter kept
-- only name/phone/city/state from the provider's `dealer` object and discarded zip, street,
-- coordinates, email, type and the provider's own identifiers -- and never wrote the
-- already-declared city/state/zip/latitude/longitude columns on the item itself. That last gap
-- is why the public ZIP+radius filter dropped every aggregator listing: distance was NULL for
-- every row, so a buyer who entered a ZIP saw an empty grid.
--
-- WHY (call accounting): the monthly cap is spent against calls, not runs. 114 August calls
-- produced no inventory_sync_runs row at all, so a budget sized from run counts was short by
-- exactly that much. api_calls_used makes each run's real spend legible.
--
-- SCOPE: ADDITIVE ONLY. Seven nullable columns and one defaulted integer across two existing
-- tables, one index, one foreign key. No DROP, no rename, no data rewrite, no backfill --
-- existing rows keep NULL provenance until the next sweep re-sees them.
--
-- NO CHECK CONSTRAINTS, DELIBERATELY -- same reasoning as 20261104000000: this chain contains
-- none, Prisma cannot model them, and scripts/check-migration-drift.ts fails in both directions
-- once structural statements move off the recorded baseline.
--
-- FOREIGN KEY: inventory_items.rooftop_id -> dealer_rooftops.id, ON DELETE SET NULL. A listing
-- outliving its rooftop must lose the link, never disappear; ON DELETE CASCADE here would let a
-- rooftop cleanup silently delete buyer-visible inventory. Matches Prisma's default for an
-- optional relation, so `prisma migrate diff` stays quiet.
--
-- RLS: unchanged. inventory_items has relrowsecurity=true with zero policies (deny-all for anon
-- and authenticated; service_role bypasses). Adding a policy to a zero-policy table OPENS
-- access, so this migration contains none.
--
-- IDEMPOTENT: every ADD COLUMN is IF NOT EXISTS; the index and constraint are guarded.
--
-- APPLY BEFORE THE CODE. Prisma selects every column a model declares unless a query narrows
-- it, so a model declaring unmigrated columns raises P2022.
--
-- ROLLBACK: see rollback.sql in this directory. Roll the CODE back FIRST.

ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "external_dealer_street" TEXT;
ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "external_dealer_zip" TEXT;
ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "external_dealer_email" TEXT;
ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "external_dealer_type" TEXT;
ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "mc_rooftop_id" TEXT;
ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "mc_dealer_id" TEXT;
ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "rooftop_id" TEXT;

ALTER TABLE "inventory_sync_runs" ADD COLUMN IF NOT EXISTS "api_calls_used" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "inventory_items_rooftop_id_idx" ON "inventory_items"("rooftop_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inventory_items_rooftop_id_fkey'
  ) THEN
    ALTER TABLE "inventory_items"
      ADD CONSTRAINT "inventory_items_rooftop_id_fkey"
      FOREIGN KEY ("rooftop_id") REFERENCES "dealer_rooftops"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
