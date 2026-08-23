-- Batch 2 — trustworthy intake completion semantics.
--
-- Additive + defensive (IF NOT EXISTS, nullable / defaulted → no backfill, no
-- destructive op). Production's Prisma ledger is known to be behind the repo
-- (manual SQL drift), so these guards make the migration safe to apply even if a
-- column was already added out of band.
--
--   intake_attempts        — REQUIRED-stage execution-failure counter (bounded retry).
--   intake_failed_at       — terminal marker; intake-reconcile excludes these rows
--                            so a provider outage can't re-drive one forever.
--   intake_failure_reason  — sanitized (PII-redacted) last terminal reason, for triage.
ALTER TABLE "buyer_opportunities"
  ADD COLUMN IF NOT EXISTS "intake_attempts" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "buyer_opportunities"
  ADD COLUMN IF NOT EXISTS "intake_failed_at" TIMESTAMP(3);

ALTER TABLE "buyer_opportunities"
  ADD COLUMN IF NOT EXISTS "intake_failure_reason" TEXT;
