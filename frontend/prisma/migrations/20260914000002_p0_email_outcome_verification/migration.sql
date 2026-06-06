-- Migration: p0_email_outcome_verification (P0-4 verified email outcomes)
-- Extends email_send_logs with verified-outcome + retry-tracking columns.
-- Idempotent (IF NOT EXISTS) — safe to re-run and safe against prod artifacts.
ALTER TABLE "email_send_logs"
  ADD COLUMN IF NOT EXISTS "outcome" TEXT;
ALTER TABLE "email_send_logs"
  ADD COLUMN IF NOT EXISTS "provider_error" TEXT;
ALTER TABLE "email_send_logs"
  ADD COLUMN IF NOT EXISTS "attempt_count" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "email_send_logs"
  ADD COLUMN IF NOT EXISTS "last_attempt_at" TIMESTAMP(3);
ALTER TABLE "email_send_logs"
  ADD COLUMN IF NOT EXISTS "compliance_critical" BOOLEAN NOT NULL DEFAULT false;

-- Backfill outcome from the existing status for historical rows.
UPDATE "email_send_logs" SET "outcome" = "status" WHERE "outcome" IS NULL;

CREATE INDEX IF NOT EXISTS "email_send_logs_outcome_idx"
  ON "email_send_logs" ("outcome");
CREATE INDEX IF NOT EXISTS "email_send_logs_compliance_critical_outcome_idx"
  ON "email_send_logs" ("compliance_critical", "outcome");
