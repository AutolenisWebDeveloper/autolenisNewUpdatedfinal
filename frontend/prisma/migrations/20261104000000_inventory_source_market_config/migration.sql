-- Inventory source market configuration — make the served market a setting, not a constant.
--
-- WRITTEN BUT NOT APPLIED. This ships for owner review alongside the rest of the
-- unapplied chain. Nothing here has been run against any database.
--
-- WHY: the geography the inventory aggregator is queried with was a single
-- fallback in the MarketCheck adapter --
--
--     zip: params.zip ?? "10001"     -- lib/services/inventory/adapters/marketcheck.adapter.ts
--
-- 10001 is Manhattan, and both sync crons call runInventorySync({}) with no
-- params, so that fallback decided every scheduled run. On 2026-09-02 the
-- catalogue was 147 of 148 active listings in New York, NY, for a business that
-- serves the Dallas-Fort Worth metro. Nothing in the database or the environment
-- could change it: inventory_sources carried an identity (type, name) and run
-- accounting (last_run_at, last_run_status, vehicles_last_count) but no query
-- configuration at all.
--
-- WHAT: nine nullable/defaulted columns describing the market one source is
-- queried with -- a centre (postal code, or an explicit coordinate pair), a
-- radius, and optional make / price / year filters. ONE ROW = ONE (ADAPTER,
-- MARKET) PAIR, which the existing unique constraint on (type, name) already
-- models: a second market for the same adapter is a second row, e.g.
-- ('MARKETCHECK', 'MarketCheck') for Dallas-Fort Worth and
-- ('MARKETCHECK', 'MarketCheck -- Houston') for Houston.
--
-- Chosen over a new table deliberately. market_coverage already exists, but it is
-- a coverage/marketing record (city, state, zip, listing_count) with no radius, no
-- filters and no adapter binding, and nothing in the sync path reads it. Putting
-- the QUERY configuration on the row that already represents "a source we sync"
-- keeps one source of truth instead of two competing ones.
--
-- SCOPE: ADDITIVE ONLY. Nine columns. No DROP, no data change, no constraint, no
-- foreign key, no index (these columns are read once per sync run, by a query
-- already filtered on is_active -- an index would serve nothing), and NO
-- BACKFILL. Existing rows keep every market column NULL, which resolves to "no
-- market configured" and is handled explicitly: the source reports NOT_CONFIGURED
-- and ingests nothing rather than silently falling back to a market. Inventing a
-- market for an existing row here would be exactly the fabricated configuration
-- this change exists to remove.
--
-- IDEMPOTENT: every statement is guarded with IF NOT EXISTS, so re-running is a
-- no-op.
--
-- RLS: inventory_sources already runs with RLS ENABLED and ZERO policies
-- (deny-all for anon/authenticated, bypass for service_role) from
-- 20260423180146_complete_schema. Adding a policy to a zero-policy table OPENS
-- access rather than hardening it, so this migration contains no CREATE POLICY
-- and does not touch RLS state. The market columns hold no PII.
--
-- APPLY BEFORE (OR WITH) THE CODE. Prisma selects every column a model declares
-- unless a query narrows it, so once schema.prisma carries these fields, an
-- unnarrowed inventory_sources read fails with P2022 against a database that
-- lacks them. The orchestrator detects P2022/42703 SPECIFICALLY and degrades to
-- the INVENTORY_DEFAULT_MARKET_ZIP environment fallback rather than taking
-- inventory sync down, so deploying the code first is survivable -- but it is
-- still the wrong order. These columns are additive and idempotent, so applying
-- them AHEAD of the code is safe and is the right order: unread columns cost
-- nothing.
--
-- ROLLBACK: see rollback.sql in this directory. Roll the CODE back first, for the
-- same reason -- dropping the columns under a running deployment that still
-- declares them reintroduces the same P2022.

ALTER TABLE "inventory_sources" ADD COLUMN IF NOT EXISTS "market_label" TEXT;
ALTER TABLE "inventory_sources" ADD COLUMN IF NOT EXISTS "market_zip" TEXT;
ALTER TABLE "inventory_sources" ADD COLUMN IF NOT EXISTS "market_lat" DECIMAL(10,7);
ALTER TABLE "inventory_sources" ADD COLUMN IF NOT EXISTS "market_lng" DECIMAL(10,7);
ALTER TABLE "inventory_sources" ADD COLUMN IF NOT EXISTS "market_radius_miles" INTEGER;
ALTER TABLE "inventory_sources" ADD COLUMN IF NOT EXISTS "market_makes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "inventory_sources" ADD COLUMN IF NOT EXISTS "market_price_max_cents" INTEGER;
ALTER TABLE "inventory_sources" ADD COLUMN IF NOT EXISTS "market_year_min" INTEGER;
ALTER TABLE "inventory_sources" ADD COLUMN IF NOT EXISTS "market_year_max" INTEGER;
