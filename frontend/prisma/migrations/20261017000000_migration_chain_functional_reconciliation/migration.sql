-- Reconcile the FUNCTIONAL drift between the migration chain and schema.prisma.
--
-- The chain had never been run against an empty database (CI has no database
-- job), so it drifted from the schema it is supposed to build. A database
-- provisioned from migrations alone was missing one table, seven columns, five
-- enum values and five indexes that application code depends on — most sharply
-- vehicle_requests.buyer_opportunity_id, which lib/services/acquisition/
-- intake-pipeline.service.ts queries on every hot-lead alert.
--
-- SCOPE: additive only. `prisma migrate diff` also proposes destructive changes
-- (DROP TABLE "conversations", index renames, foreign-key re-creations). Those
-- are deliberately NOT included: they were derived from a locally provisioned
-- database, and aiming DROP statements at a production instance whose real state
-- cannot be inspected from here would risk data loss for a cosmetic gain. The CI
-- drift check records the remainder so it cannot grow silently.
--
-- IDEMPOTENT / NO-OP ON A CORRECT DATABASE: every statement is guarded, so on an
-- instance that already matches the schema this migration changes nothing.
--
-- ROLLBACK: see rollback.sql in this directory. Enum values are append-only in
-- postgres and are intentionally not rolled back.

-- ---------------------------------------------------------------- enum values
ALTER TYPE "CommissionStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'SUPPORT_TICKET';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PAYOUT_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PAYOUT_PAID';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PAYOUT_FAILED';

-- --------------------------------------------------------------- missing table
CREATE TABLE IF NOT EXISTS "amips_intelligence_snapshots" (
    "id"                     TEXT NOT NULL,
    "captured_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "health_score"           INTEGER NOT NULL,
    "metros_covered"         INTEGER NOT NULL,
    "metros_scored"          INTEGER NOT NULL,
    "avg_buyer_leverage"     DOUBLE PRECISION NOT NULL,
    "active_pages"           INTEGER NOT NULL,
    "published_30d"          INTEGER NOT NULL,
    "impressions"            INTEGER NOT NULL DEFAULT 0,
    "clicks"                 INTEGER NOT NULL DEFAULT 0,
    "leads"                  INTEGER NOT NULL DEFAULT 0,
    "revenue_run_rate_cents" INTEGER NOT NULL DEFAULT 0,
    "indexation_rate"        DOUBLE PRECISION NOT NULL DEFAULT 0,
    "payload_json"           TEXT NOT NULL,
    "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "amips_intelligence_snapshots_pkey" PRIMARY KEY ("id")
);

-- Deny-all for anon/authenticated, matching every other table in this schema
-- (20260918000000_enable_rls_manual_tables). All access is server-side.
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'amips_intelligence_snapshots')) IS NOT NULL THEN
    ALTER TABLE "amips_intelligence_snapshots" ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ------------------------------------------------------------- missing columns
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'affiliate_compliance_records')) IS NOT NULL THEN
    ALTER TABLE "affiliate_compliance_records"
      ADD COLUMN IF NOT EXISTS "ip_address" TEXT,
      ADD COLUMN IF NOT EXISTS "user_agent" TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'dealers')) IS NOT NULL THEN
    ALTER TABLE "dealers"
      ADD COLUMN IF NOT EXISTS "marketplace_agreement_envelope_id" TEXT,
      ADD COLUMN IF NOT EXISTS "marketplace_agreement_sent_at"     TIMESTAMP(3),
      ADD COLUMN IF NOT EXISTS "marketplace_agreement_signed_at"   TIMESTAMP(3);
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'prequal_consents')) IS NOT NULL THEN
    ALTER TABLE "prequal_consents" ADD COLUMN IF NOT EXISTS "terms_version" TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'vehicle_requests')) IS NOT NULL THEN
    ALTER TABLE "vehicle_requests" ADD COLUMN IF NOT EXISTS "buyer_opportunity_id" TEXT;
  END IF;
END $$;

-- ------------------------------------------------------------- missing indexes
-- Three of these five are genuinely absent from a chain-built database. The
-- other two (buyer_opportunities_created_at_idx, dealer_prospects_email_idx)
-- already exist under the same NAME but with a different definition — DESC
-- ordering and a partial WHERE clause respectively — so IF NOT EXISTS makes them
-- no-ops here. Re-shaping an existing index means dropping it, which is outside
-- this migration's additive-only scope; the drift check records the difference.
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'amips_intelligence_snapshots')) IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS "amips_intelligence_snapshots_captured_at_idx"
      ON "amips_intelligence_snapshots"("captured_at");
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'ab_test_variants')) IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS "ab_test_variants_group_id_idx" ON "ab_test_variants"("group_id");
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'buyer_opportunities')) IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS "buyer_opportunities_created_at_idx" ON "buyer_opportunities"("created_at");
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'dealer_prospects')) IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS "dealer_prospects_email_idx" ON "dealer_prospects"("email");
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'vehicle_requests')) IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS "vehicle_requests_buyer_opportunity_id_idx"
      ON "vehicle_requests"("buyer_opportunity_id");
  END IF;
END $$;
