-- 001_affiliate_correctness — affiliate-surface data-layer reconciliation.
-- OWNER-GATED: written in the affiliate-portal remediation branch; do NOT
-- apply to production without owner approval. Annotated mirror for manual
-- application: docs/plans/sql/001_affiliate_correctness.sql.
--
-- Contents (every section idempotent; every statement followed by a
-- commented verification query):
--   ENUM — reconcile live enum types with schema.prisma (VERIFIED against
--         production 2026-08-29 via pg_enum: CommissionStatus lacks REJECTED;
--         NotificationType lacks PAYOUT_REQUESTED/PAYOUT_PAID/PAYOUT_FAILED;
--         PAYOUT_CANCELLED is net-new for cancelled settlements)
--   D2  — affiliate_documents drift fix. LIVE PRODUCTION IS DRIFTED —
--         VERIFIED 2026-08-29 against aieybibvewmvrubcpthm via
--         information_schema.columns: document_type text NOT NULL (no
--         default, not in schema.prisma), type nullable, file_name nullable,
--         file_size_bytes bigint nullable, plus a stray nullable integer
--         file_size column. Every Prisma insert omits document_type and
--         fails its NOT NULL — AFFILIATE DOCUMENT UPLOAD IS BROKEN IN
--         PRODUCTION until this migration is applied (the table holds 0
--         rows). An earlier revision of this header claimed production was
--         verified not drifted; that claim was wrong — it was based on
--         reading the baseline migration SQL, not on a live query.
--   D1  — commissions (affiliate_id, status) + (status, created_at) indexes
--   D7  — buyers (affiliate_id) index
--   D8  — affiliates (parent_id) index
--   D6  — affiliate_referrals.referred_user_id UNIQUE (0 live rows at audit)
--   D15 — affiliate_payouts (affiliate_id) index
--   D13 — commissions approved_at / approved_by / reversed_at stamps
--   D20 — commissions.payout_id FK SET NULL -> RESTRICT
--   M-x — drop the orphaned camelCase "lastInactiveNudgeAt" duplicate column

-- ── ENUM: reconcile live enum types with schema.prisma ───────────────────────
-- The migration chain is NOT authoritative for the live database. VERIFIED
-- against production 2026-08-29 (SELECT t.typname, e.enumlabel FROM pg_type t
-- JOIN pg_enum e ON e.enumtypid=t.oid WHERE t.typname IN
-- ('CommissionStatus','NotificationType') ORDER BY e.enumsortorder):
--   • live "CommissionStatus" = {PENDING,APPROVED,PAID,REVERSED} — NO
--     REJECTED, though schema.prisma declares it and the admin reject route
--     writes it: the reject rail fails on live production until this runs.
--   • live "NotificationType" ends at OFFER_DECLINED — NO PAYOUT_REQUESTED /
--     PAYOUT_PAID / PAYOUT_FAILED (schema.prisma declares all three): the
--     settle rail's notifications fail on live production until this runs.
--   • PAYOUT_CANCELLED is net-new (owner item 3): the cancelled-settlement
--     notification gets its own truthful type instead of PAYOUT_FAILED.
-- ADD VALUE IF NOT EXISTS no-ops on chain-provisioned databases, where the
-- chain already created the first four; nothing later in this migration uses
-- the new labels, so the in-transaction ADD VALUE restriction does not bite.
ALTER TYPE "CommissionStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PAYOUT_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PAYOUT_PAID';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PAYOUT_FAILED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PAYOUT_CANCELLED';
-- VERIFY:
--   SELECT e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid
--   WHERE t.typname='CommissionStatus';  -- expect REJECTED present (5 labels)
--   SELECT e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid
--   WHERE t.typname='NotificationType' AND e.enumlabel LIKE 'PAYOUT%'; -- expect 4 rows

-- ── D2: affiliate_documents drift fix ────────────────────────────────────────
-- LIVE PRODUCTION HAS THIS SHAPE (VERIFIED 2026-08-29, information_schema.
-- columns): "document_type" text NOT NULL (no default, not in schema.prisma),
-- nullable "type"/"file_name" (Prisma: required), "file_size_bytes" bigint
-- nullable (Prisma: Int required), plus a stray nullable integer "file_size"
-- column schema.prisma does not declare. Every Prisma insert omits
-- document_type and fails its NOT NULL — affiliate document upload is BROKEN
-- IN PRODUCTION until this section runs. The table holds 0 rows (VERIFIED:
-- SELECT count(*) FROM affiliate_documents), so every backfill below no-ops
-- live; the guards keep the section correct for any environment.
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

  -- Stray "file_size" integer column (live production carries it alongside
  -- file_size_bytes; schema.prisma declares neither reads nor writes it).
  -- Preserve any value into the canonical column, then drop.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'affiliate_documents' AND column_name = 'file_size'
  ) THEN
    UPDATE "affiliate_documents" SET "file_size_bytes" = COALESCE("file_size_bytes", "file_size"::bigint)
     WHERE "file_size" IS NOT NULL;
    ALTER TABLE "affiliate_documents" DROP COLUMN "file_size";
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
--     AND column_name IN ('type','file_name','file_size_bytes','document_type','file_size');
--   -- expect: no document_type row, no file_size row;
--   --         type/file_name/file_size_bytes NOT NULL; file_size_bytes integer.

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
-- Safe: 0 duplicate referred_user_id groups on live production (RE-VERIFIED
-- 2026-08-29: SELECT referred_user_id FROM affiliate_referrals GROUP BY
-- referred_user_id HAVING count(*)>1 returns 0 rows). If a future
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
