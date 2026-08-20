-- Phase 5 Block 3 — credit application (lender decisioning) lifecycle.
--
-- Additive. New table credit_applications with a guarded status machine and PII
-- stored AES-256-GCM ENCRYPTED at rest (ssn/income/employment/dob — never
-- plaintext). RLS deny-all (server-only). FKs are on this NEW table (deals, buyers)
-- — no required FK is added to a pre-existing table. FinancingPath already exists.
--
-- ⚠️ REQUIRED PRE-LIVE STEP: apply to production with `prisma migrate deploy`.
--    Also set FINANCING_ENCRYPTION_KEY (64-char hex) in prod — the app fails
--    closed (throws) rather than storing PII with an insecure key.
--
-- Rollback:
--   DROP TABLE IF EXISTS "credit_applications";
--   DROP TYPE IF EXISTS "CreditApplicationStatus";

DO $$ BEGIN CREATE TYPE "CreditApplicationStatus" AS ENUM ('DRAFT','SUBMITTED','PENDING_LENDER','CONDITIONAL','APPROVED','DECLINED','ADVERSE_ACTION_PENDING','HUMAN_REVIEW','WITHDRAWN'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "credit_applications" (
  "id"                      TEXT NOT NULL,
  "deal_id"                 TEXT NOT NULL,
  "buyer_id"                TEXT NOT NULL,
  "status"                  "CreditApplicationStatus" NOT NULL DEFAULT 'DRAFT',
  "financing_path"          "FinancingPath" NOT NULL DEFAULT 'DEALER',
  "amount_requested_cents"  INTEGER,
  "term_months"             INTEGER,
  "ssn_encrypted"           TEXT,
  "annual_income_encrypted" TEXT,
  "employment_encrypted"    TEXT,
  "dob_encrypted"           TEXT,
  "lender_name"             TEXT,
  "lender_reference_id"     TEXT,
  "decision_outcome"        TEXT,
  "approved_amount_cents"   INTEGER,
  "apr_rate"                DOUBLE PRECISION,
  "monthly_payment_cents"   INTEGER,
  "stipulations"            JSONB,
  "decline_reason_codes"    JSONB,
  "submitted_at"            TIMESTAMP(3),
  "decided_at"              TIMESTAMP(3),
  "created_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "credit_applications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "credit_applications_deal_id_idx" ON "credit_applications"("deal_id");
CREATE INDEX IF NOT EXISTS "credit_applications_buyer_id_status_idx" ON "credit_applications"("buyer_id","status");
CREATE INDEX IF NOT EXISTS "credit_applications_status_idx" ON "credit_applications"("status");

DO $$ BEGIN
  ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_deal_id_fkey"
    FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_buyer_id_fkey"
    FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "credit_applications" ENABLE ROW LEVEL SECURITY;
