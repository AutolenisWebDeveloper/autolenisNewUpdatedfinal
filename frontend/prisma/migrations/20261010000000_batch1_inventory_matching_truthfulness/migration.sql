-- Batch 1 — Executable Inventory & Matching Foundation
-- Additive and defensive only. No data is rewritten. No columns are dropped.
--
-- PRODUCTION CUTOVER REQUIRES `prisma migrate deploy` — OWNER-GATED.
-- Production migration history is known to drift from physical schema, so every
-- statement here is guarded with IF NOT EXISTS and each new enum value with
-- ADD VALUE IF NOT EXISTS. Verify PHYSICAL schema (pg_enum / pg_indexes), not just
-- _prisma_migrations, before and after applying.

-- 1) Truthful inventory-sync outcomes: a run can no longer read as healthy when
--    no synchronization actually occurred.
ALTER TYPE "SyncRunStatus" ADD VALUE IF NOT EXISTS 'NOT_CONFIGURED';
ALTER TYPE "SyncRunStatus" ADD VALUE IF NOT EXISTS 'ZERO_RESULTS';
ALTER TYPE "SyncRunStatus" ADD VALUE IF NOT EXISTS 'DEFERRED';

-- 2) The built-in MarketCheck aggregator recorded as a first-class source type.
ALTER TYPE "InventorySourceType" ADD VALUE IF NOT EXISTS 'MARKETCHECK';

-- 3) Idempotent source registration — one row per (type, name).
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_sources_type_name_key"
  ON "inventory_sources"("type", "name");

-- 4) Canonical request→inventory match results: idempotent upserts + fast lookup.
CREATE UNIQUE INDEX IF NOT EXISTS "vehicle_request_match_results_request_id_inventory_item_id_key"
  ON "vehicle_request_match_results"("request_id", "inventory_item_id");
CREATE INDEX IF NOT EXISTS "vehicle_request_match_results_request_id_idx"
  ON "vehicle_request_match_results"("request_id");
