-- Migration: add_prequal_dti_calculation
-- Institutional-grade DTI calculation columns for PreQualification:
--   - housing_status / monthly_housing_payment_cents / monthly_other_debt_cents
--     → back-end (total) DTI inputs collected from the buyer
--   - front_end_dti_bps / back_end_dti_bps → computed DTI ratios (basis points)
--   - benchmark_apr_bps → tier-based benchmark APR used in the final calculation
--   - effective_income_cents → monthly income after the stability haircut
--
-- All statements are idempotent (IF NOT EXISTS). The first six columns may
-- already exist from 20260907000000_add_prequal_financial_detail; this migration
-- consolidates the full DTI-calculation column set and adds effective_income_cents.
-- NOTE: credit score is stored in credit_score (20260908000000), NOT here.

ALTER TABLE "pre_qualifications"
  ADD COLUMN IF NOT EXISTS "housing_status"                TEXT,
  ADD COLUMN IF NOT EXISTS "monthly_housing_payment_cents" INTEGER,
  ADD COLUMN IF NOT EXISTS "monthly_other_debt_cents"      INTEGER,
  ADD COLUMN IF NOT EXISTS "front_end_dti_bps"             INTEGER,
  ADD COLUMN IF NOT EXISTS "back_end_dti_bps"              INTEGER,
  ADD COLUMN IF NOT EXISTS "benchmark_apr_bps"             INTEGER,
  ADD COLUMN IF NOT EXISTS "effective_income_cents"        INTEGER;
