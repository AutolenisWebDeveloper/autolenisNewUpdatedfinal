-- Rollback for 20261104000000_inventory_market_config_and_call_budget.
--
-- Roll the CODE back FIRST. Dropping these columns under a deployment that still declares
-- them in schema.prisma reintroduces the P2022 this migration exists to avoid.
--
-- SyncRunStatus.BUDGET_EXHAUSTED is deliberately NOT dropped: PostgreSQL has no
-- DROP VALUE, and rebuilding the type would rewrite inventory_sync_runs. The label is inert
-- once the code is reverted, and historical rows carrying it stay readable. Confirm no run
-- row is mid-flight with that status before running this.
--
-- The DFW config values disappear with their columns; no separate data rollback is needed.

ALTER TABLE "inventory_sources" DROP COLUMN IF EXISTS "center_zip";
ALTER TABLE "inventory_sources" DROP COLUMN IF EXISTS "radius_miles";
ALTER TABLE "inventory_sources" DROP COLUMN IF EXISTS "filter_make";
ALTER TABLE "inventory_sources" DROP COLUMN IF EXISTS "filter_model";
ALTER TABLE "inventory_sources" DROP COLUMN IF EXISTS "filter_year_min";
ALTER TABLE "inventory_sources" DROP COLUMN IF EXISTS "filter_year_max";
ALTER TABLE "inventory_sources" DROP COLUMN IF EXISTS "filter_price_max_cents";
ALTER TABLE "inventory_sources" DROP COLUMN IF EXISTS "rows_per_call";
ALTER TABLE "inventory_sources" DROP COLUMN IF EXISTS "max_calls_per_run";
ALTER TABLE "inventory_sources" DROP COLUMN IF EXISTS "monthly_call_budget";
ALTER TABLE "inventory_sources" DROP COLUMN IF EXISTS "calls_used_this_cycle";
ALTER TABLE "inventory_sources" DROP COLUMN IF EXISTS "budget_cycle_key";
