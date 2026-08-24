-- ROLLBACK for 20261011000000_batch4_canonical_offer_convergence
--
-- RUNBOOK ARTIFACT — NOT a Prisma migration. Prisma `migrate deploy` executes
-- only `migration.sql`; this file is ignored by the migrate engine and is run
-- MANUALLY, OWNER-GATED, when reverting the Batch 4 schema. Run inside a
-- transaction. Validated against a database whose guard query returned 0.
--
-- ORDER MATTERS — undo in reverse of the forward migration:
--   forward:  (1) auctions.deposit_id DROP NOT NULL   (2) add offers.concierge_source_ref + unique index
--   rollback: (2) drop index + column                 (1) re-assert deposit_id NOT NULL
--
-- LOCKSTEP WARNING: this reverts the DB only. The Batch 4 application code
-- (schema.prisma depositId String?, the concierge-offer adapter, the
-- vehicle-request offer/respond route, and the nullable-depositId readers)
-- assumes the FORWARD schema. Reverting the DB without also reverting that code
-- breaks the convergence path at runtime (NOT NULL violation on auction insert;
-- "column does not exist" on concierge_source_ref). Revert code in the same change.

-- ── GUARD — run FIRST. Step (1) below is safe ONLY if this returns 0. ─────────
-- SELECT count(*) AS deposit_optional_auctions FROM "auctions" WHERE "deposit_id" IS NULL;
-- If > 0, do NOT run step (1): those deposit-optional concierge auctions (and any
-- Deals converged from them) must be resolved first — backfill a deposit, or
-- delete the auction + dependent offers/deals after an explicit, owner-approved
-- data decision. Alternatively run a PARTIAL rollback: steps (2a)+(2b) only,
-- leaving deposit_id nullable, and revert the concierge application code.

BEGIN;

-- (2a) Drop the unique index on the provenance / idempotency anchor.
DROP INDEX IF EXISTS "offers_concierge_source_ref_key";

-- (2b) Drop the column. DATA-DESTRUCTIVE: erases the concierge->offer provenance
--      for any converted offers. Snapshot offers(id, concierge_source_ref) first
--      if that link may be needed later.
ALTER TABLE "offers" DROP COLUMN IF EXISTS "concierge_source_ref";

-- (1) Re-assert NOT NULL on auctions.deposit_id.
--     FAILS if any auctions.deposit_id IS NULL (see GUARD above).
ALTER TABLE "auctions" ALTER COLUMN "deposit_id" SET NOT NULL;

COMMIT;

-- ── POST-ROLLBACK VERIFICATION (physical schema, not _prisma_migrations) ─────
-- Expected pre-Batch-4 state:
--   SELECT is_nullable FROM information_schema.columns
--     WHERE table_name='auctions' AND column_name='deposit_id';            -- NO
--   SELECT count(*) FROM information_schema.columns
--     WHERE table_name='offers' AND column_name='concierge_source_ref';    -- 0
--   SELECT count(*) FROM pg_indexes
--     WHERE indexname='offers_concierge_source_ref_key';                   -- 0
