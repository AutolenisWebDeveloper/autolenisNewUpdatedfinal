-- Inventory: configurable swept market + monthly provider call budget.
--
-- WRITTEN BUT NOT APPLIED. Ships for owner review alongside the unapplied chain.
--
-- WHY: geography lived as `params.zip ?? "10001"` inside marketcheck.adapter.ts, and both
-- inventory crons call runInventorySync({}) with an empty params object -- so the NYC
-- fallback ALWAYS won, 100% of ingested rows carried external_dealer_state='NY', and the
-- swept market could not be changed without a deploy. There was no call accounting at all:
-- 28 calls/day against a 500/month plan produced 191 consecutive runs answered
-- "MarketCheck HTTP 429: Too Many Requests" (2026-08-24 05:00 .. 2026-08-31 00:01) with a
-- silently frozen catalogue behind them.
--
-- SCOPE: ADDITIVE ONLY. Twelve nullable-or-defaulted columns on one existing table, one
-- appended enum label, one config UPDATE that only fills NULLs. No DROP, no rename, no data
-- rewrite, no index, no constraint.
--
-- NO CHECK CONSTRAINTS, DELIBERATELY. This chain contains zero CHECK constraints across
-- 101 migrations, Prisma cannot model them, and scripts/check-migration-drift.ts fails in
-- BOTH directions once `prisma migrate diff` structural statements move off the recorded
-- baseline. The 100-mile radius ceiling is enforced in CODE in two independent places
-- (resolveMarketConfig's clampRadius and buildApiUrl's own Math.min) and pinned by unit test.
--
-- IDEMPOTENT: every ADD COLUMN is IF NOT EXISTS, the enum label is ADD VALUE IF NOT EXISTS,
-- and the config UPDATE's predicate stops matching once it has run.
--
-- ALTER TYPE placement: the new label is added here and is NOT referenced by any later
-- statement in this file, which is what makes it legal inside Prisma's migration
-- transaction (same pattern as 20261010000000).
--
-- RLS: VERIFIED read-only on production 2026-09-02 -- inventory_sources, inventory_items and
-- inventory_sync_runs all have relrowsecurity=true with ZERO policies (deny-all for anon and
-- authenticated; service_role bypasses). Adding a policy to a zero-policy table OPENS access,
-- so this migration contains none and does not touch RLS state. NOTE FOR FOLLOW-UP, out of
-- scope here: no migration in the chain ENABLES RLS on these tables, so a chain-built CI or
-- preview database does not inherit production's posture. That gap predates this change.
--
-- APPLY BEFORE THE CODE. Prisma selects every column a model declares unless a query narrows
-- it, so a model declaring unmigrated columns raises P2022. The code deliberately degrades to
-- env config on P2021/P2022 so a deploy-first mistake is survivable, but migration-first is
-- the intended order: an unread column costs nothing.
--
-- ROLLBACK: see rollback.sql in this directory. Roll the CODE back FIRST.

ALTER TABLE "inventory_sources" ADD COLUMN IF NOT EXISTS "center_zip" TEXT;
ALTER TABLE "inventory_sources" ADD COLUMN IF NOT EXISTS "radius_miles" INTEGER;
ALTER TABLE "inventory_sources" ADD COLUMN IF NOT EXISTS "filter_make" TEXT;
ALTER TABLE "inventory_sources" ADD COLUMN IF NOT EXISTS "filter_model" TEXT;
ALTER TABLE "inventory_sources" ADD COLUMN IF NOT EXISTS "filter_year_min" INTEGER;
ALTER TABLE "inventory_sources" ADD COLUMN IF NOT EXISTS "filter_year_max" INTEGER;
ALTER TABLE "inventory_sources" ADD COLUMN IF NOT EXISTS "filter_price_max_cents" INTEGER;
ALTER TABLE "inventory_sources" ADD COLUMN IF NOT EXISTS "rows_per_call" INTEGER NOT NULL DEFAULT 50;
ALTER TABLE "inventory_sources" ADD COLUMN IF NOT EXISTS "max_calls_per_run" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "inventory_sources" ADD COLUMN IF NOT EXISTS "monthly_call_budget" INTEGER;
ALTER TABLE "inventory_sources" ADD COLUMN IF NOT EXISTS "calls_used_this_cycle" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "inventory_sources" ADD COLUMN IF NOT EXISTS "budget_cycle_key" TEXT;

ALTER TYPE "SyncRunStatus" ADD VALUE IF NOT EXISTS 'BUDGET_EXHAUSTED';

-- Dallas-Fort Worth repoint. 76011 (Arlington) is the metroplex centroid: a 100-mile disc
-- centred there covers Fort Worth (~15mi), Dallas (~20mi), Denton, McKinney, Waxahachie,
-- Weatherford and Waco. Centring on 75201 (downtown Dallas) weights the disc east and pushes
-- the western edge past the useful supply.
--
-- This is an UPDATE, not a guarded INSERT: production already holds exactly one
-- inventory_sources row (MARKETCHECK / "MarketCheck", verified read-only 2026-09-02), created
-- at runtime by ensureInventorySource(). A `WHERE NOT EXISTS` INSERT would be a no-op against
-- that row and the repoint would silently never happen. On an empty chain-built database this
-- UPDATE matches zero rows, which is correct -- the row is created at runtime and the market
-- then resolves from INVENTORY_SWEEP_ZIP.
--
-- The `center_zip IS NULL` guard means a later owner edit is never overwritten.
--
-- 400 calls/month = 310 scheduled (10/day x 31) + ~90 for the admin search tool and manual
-- re-runs, against a 500/month provider cap with 100 untouched.
UPDATE "inventory_sources"
   SET "center_zip" = '76011', "radius_miles" = 100, "monthly_call_budget" = 400
 WHERE "type" = 'MARKETCHECK' AND "center_zip" IS NULL;
