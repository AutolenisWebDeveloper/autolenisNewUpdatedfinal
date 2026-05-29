-- Migration: drop_credit_score_estimate
-- Cleanup: the credit_score_estimate column was a duplicate of the iPredict
-- credit_score column (20260908000000). It has been removed from the schema
-- and consolidated into credit_score. This DROP is idempotent (IF EXISTS), so
-- it is a no-op on databases where credit_score_estimate was never created.

ALTER TABLE "pre_qualifications"
  DROP COLUMN IF EXISTS "credit_score_estimate";
