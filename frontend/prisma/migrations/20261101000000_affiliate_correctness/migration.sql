-- 001_affiliate_correctness — affiliate-surface data-layer reconciliation.
-- OWNER-GATED: written in the affiliate-portal remediation branch; do NOT
-- apply to production without owner approval. Annotated mirror for manual
-- application: docs/plans/sql/001_affiliate_correctness.sql.
--
-- Contents (every section idempotent; every statement followed by a
-- commented verification query):
--   D2  — affiliate_documents drift fix (chain-provisioned DBs only: the
--         baseline created a shape the app's inserts violate; live production
--         verified NOT drifted, so there this section no-ops)
--   D1  — commissions (affiliate_id, status) + (status, created_at) indexes
--   D7  — buyers (affiliate_id) index
--   D8  — affiliates (parent_id) index
--   D6  — affiliate_referrals.referred_user_id UNIQUE (0 live rows at audit)
--   D15 — affiliate_payouts (affiliate_id) index
--   D13 — commissions approved_at / approved_by / reversed_at stamps
--   D20 — commissions.payout_id FK SET NULL -> RESTRICT
--   M-x — drop the orphaned camelCase "lastInactiveNudgeAt" duplicate column

-- ── D2: affiliate_documents drift fix ────────────────────────────────────────
-- The 20260423999999 baseline created "document_type" NOT NULL (no default,
-- not in schema.prisma), nullable "type"/"file_name" (Prisma: required), and
-- "file_size_bytes" bigint (Prisma Int -> integer). On such a database every
-- app upload fails with a NOT NULL violation.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'affiliate_documents' AND column_name = 'document_type'
  ) THEN
    -- Preserve any data the drifted column held before dropping it.
    UPDATE "affiliate_documents" SET "type" = "document_type" WHERE "type" IS NULL;
    ALTER TABLE "affiliate_documents" DROP COLUMN "document_type";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'affiliate_documents'
      AND column_name = 'type' AND is_nullable = 'YES'
  ) THEN
    UPDATE "affiliate_documents" SET "type" = 'OTHER' WHERE "type" IS NULL;
    ALTER TABLE "affiliate_documents" ALTER COLUMN "type" SET NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'affiliate_documents'
      AND column_name = 'file_name' AND is_nullable = 'YES'
  ) THEN
    UPDATE "affiliate_documents" SET "file_name" = 'unknown' WHERE "file_name" IS NULL;
    ALTER TABLE "affiliate_documents" ALTER COLUMN "file_name" SET NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'affiliate_documents'
      AND column_name = 'file_size_bytes' AND data_type = 'bigint'
  ) THEN
    -- Uploads are capped at 10 MB, far inside integer range.
    ALTER TABLE "affiliate_documents" ALTER COLUMN "file_size_bytes" TYPE integer;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'affiliate_documents'
      AND column_name = 'file_size_bytes' AND is_nullable = 'YES'
  ) THEN
    UPDATE "affiliate_documents" SET "file_size_bytes" = COALESCE("file_size_bytes", 0);
    ALTER TABLE "affiliate_documents" ALTER COLUMN "file_size_bytes" SET NOT NULL;
  END IF;
END $$;

-- Align the drifted baseline index name with Prisma's expected name.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_affiliate_documents_affiliate_id')
     AND NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'affiliate_documents_affiliate_id_idx')
  THEN
    ALTER INDEX "idx_affiliate_documents_affiliate_id" RENAME TO "affiliate_documents_affiliate_id_idx";
  END IF;
END $$;
-- VERIFY:
--   SELECT column_name, is_nullable, data_type FROM information_schema.columns
--   WHERE table_name = 'affiliate_documents'
--     AND column_name IN ('type','file_name','file_size_bytes','document_type');
--   -- expect: no document_type row; type/file_name/file_size_bytes NOT NULL; integer.

-- ── D1: commissions read-path indexes ────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "commissions_affiliate_id_status_idx" ON "commissions"("affiliate_id", "status");
-- VERIFY: SELECT indexname FROM pg_indexes WHERE tablename='commissions' AND indexname='commissions_affiliate_id_status_idx';
CREATE INDEX IF NOT EXISTS "commissions_status_created_at_idx" ON "commissions"("status", "created_at");
-- VERIFY: SELECT indexname FROM pg_indexes WHERE tablename='commissions' AND indexname='commissions_status_created_at_idx';

-- ── D7: buyers.affiliate_id index ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "buyers_affiliate_id_idx" ON "buyers"("affiliate_id");
-- VERIFY: SELECT indexname FROM pg_indexes WHERE tablename='buyers' AND indexname='buyers_affiliate_id_idx';

-- ── D8: affiliates.parent_id index ───────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "affiliates_parent_id_idx" ON "affiliates"("parent_id");
-- VERIFY: SELECT indexname FROM pg_indexes WHERE tablename='affiliates' AND indexname='affiliates_parent_id_idx';

-- ── D6: one referrer per referred user (first-touch wins) ────────────────────
-- Safe: affiliate_referrals held 0 rows at audit (2026-08-29). If a future
-- application window created conflicting rows, the guarded block reports
-- instead of failing the whole migration.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='affiliate_referrals_referred_user_id_key') THEN
    IF EXISTS (
      SELECT referred_user_id FROM "affiliate_referrals" GROUP BY referred_user_id HAVING count(*) > 1
    ) THEN
      RAISE EXCEPTION 'affiliate_referrals has duplicate referred_user_id rows — resolve first-touch manually before applying D6';
    END IF;
    CREATE UNIQUE INDEX "affiliate_referrals_referred_user_id_key" ON "affiliate_referrals"("referred_user_id");
  END IF;
END $$;
-- VERIFY: SELECT indexname FROM pg_indexes WHERE tablename='affiliate_referrals' AND indexname='affiliate_referrals_referred_user_id_key';

-- ── D15: affiliate_payouts.affiliate_id index ────────────────────────────────
CREATE INDEX IF NOT EXISTS "affiliate_payouts_affiliate_id_idx" ON "affiliate_payouts"("affiliate_id");
-- VERIFY: SELECT indexname FROM pg_indexes WHERE tablename='affiliate_payouts' AND indexname='affiliate_payouts_affiliate_id_idx';

-- ── D13: commission transition stamps ────────────────────────────────────────
ALTER TABLE "commissions" ADD COLUMN IF NOT EXISTS "approved_at" timestamp(3);
ALTER TABLE "commissions" ADD COLUMN IF NOT EXISTS "approved_by" text;
ALTER TABLE "commissions" ADD COLUMN IF NOT EXISTS "reversed_at" timestamp(3);
-- VERIFY: SELECT column_name FROM information_schema.columns WHERE table_name='commissions' AND column_name IN ('approved_at','approved_by','reversed_at'); -- expect 3 rows

-- ── D20: payout link FK becomes RESTRICT ─────────────────────────────────────
-- SET NULL on payout delete would fabricate the exact corruption the
-- settlement invariant (isCommissionSettled) rejects: PAID + paidAt + no link.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'commissions' AND constraint_name = 'commissions_payout_id_fkey'
  ) THEN
    ALTER TABLE "commissions" DROP CONSTRAINT "commissions_payout_id_fkey";
  END IF;
  ALTER TABLE "commissions"
    ADD CONSTRAINT "commissions_payout_id_fkey"
    FOREIGN KEY ("payout_id") REFERENCES "affiliate_payouts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
END $$;
-- VERIFY:
--   SELECT confdeltype FROM pg_constraint WHERE conname='commissions_payout_id_fkey'; -- expect 'r' (RESTRICT)

-- ── Orphaned duplicate column ────────────────────────────────────────────────
-- Live production carries BOTH "lastInactiveNudgeAt" (camelCase, orphaned —
-- Prisma maps only last_inactive_nudge_at) and "last_inactive_nudge_at".
-- The camelCase column is written by nothing and read by nothing.
ALTER TABLE "affiliates" DROP COLUMN IF EXISTS "lastInactiveNudgeAt";
-- VERIFY: SELECT column_name FROM information_schema.columns WHERE table_name='affiliates' AND column_name='lastInactiveNudgeAt'; -- expect 0 rows

-- ── P1-1 (second review): close legacy orphaned PENDING payouts FIRST ────────
-- The disabled legacy self-serve rail created AffiliatePayout(PENDING) rows
-- that nothing could ever advance and that claim no commissions. Left in
-- place they (a) can hold two PENDING rows for one affiliate, which would
-- fail the unique index build below, and (b) would permanently block that
-- affiliate's requestPayout with REQUEST_PENDING. A legacy orphan is exactly
-- "PENDING with zero attached commissions" — the rebuilt rail always attaches
-- claims in the same transaction, so this cannot touch a real request.
UPDATE "affiliate_payouts" p
   SET "status" = 'FAILED',
       "failure_reason" = 'orphaned by disabled legacy self-serve rail (closed by migration 20261101000000)'
 WHERE p."status" = 'PENDING'
   AND NOT EXISTS (SELECT 1 FROM "commissions" c WHERE c."payout_id" = p."id");
-- VERIFY: SELECT count(*) FROM affiliate_payouts p WHERE p.status='PENDING' AND NOT EXISTS (SELECT 1 FROM commissions c WHERE c.payout_id = p.id); -- expect 0

-- ── P2-2 (review): one open payout request per affiliate, DB-enforced ────────
-- requestPayout checks "no open PENDING request" read-then-act; under READ
-- COMMITTED two concurrent requests can both pass the check. The commission
-- CAS still prevents double-claiming, but the one-open-request invariant the
-- UI and admin rail assume needs a partial unique index to hold under
-- concurrency. (Prisma cannot express partial indexes; raw SQL by design.)
CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_payouts_one_pending_per_affiliate"
  ON "affiliate_payouts"("affiliate_id") WHERE "status" = 'PENDING';
-- VERIFY: SELECT indexname FROM pg_indexes WHERE tablename='affiliate_payouts' AND indexname='affiliate_payouts_one_pending_per_affiliate'; -- expect 1 row
