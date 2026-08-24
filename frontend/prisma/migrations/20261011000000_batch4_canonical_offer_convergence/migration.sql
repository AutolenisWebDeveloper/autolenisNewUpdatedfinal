-- Batch 4 — Canonical offer convergence. Additive and defensive only.
--
-- PRODUCTION CUTOVER REQUIRES `prisma migrate deploy` — OWNER-GATED.
-- Verify PHYSICAL schema (information_schema.columns / pg_indexes), not just
-- _prisma_migrations. Both changes are safe on existing rows: dropping NOT NULL
-- never rejects data, and the new column is nullable with a unique index that
-- ignores NULLs (Postgres treats NULLs as distinct).

-- 1) Deposit-OPTIONAL auctions: a concierge auction can exist without a $99 deposit.
--    Existing competitive auctions keep their deposit_id.
ALTER TABLE "auctions" ALTER COLUMN "deposit_id" DROP NOT NULL;

-- 2) Idempotency + provenance anchor for converted concierge offers.
ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "concierge_source_ref" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "offers_concierge_source_ref_key"
  ON "offers"("concierge_source_ref");
