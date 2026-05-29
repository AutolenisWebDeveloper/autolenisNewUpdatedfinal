-- Migration: add_prequal_financial_detail
-- Upgrades prequalification to institutional-grade financial accuracy:
--   - Captures buyer housing status + housing/other-debt obligations so the
--     income gate can apply a back-end (total) DTI in addition to the existing
--     front-end (auto-only) DTI.
--   - Stores the estimated credit score parsed from iPredict.
--   - Persists the decision detail (front/back-end DTI + benchmark APR, in
--     basis points) for buyer-facing transparency and admin review.

ALTER TABLE "pre_qualifications" ADD COLUMN IF NOT EXISTS "housing_status"                TEXT;
ALTER TABLE "pre_qualifications" ADD COLUMN IF NOT EXISTS "monthly_housing_payment_cents" INTEGER;
ALTER TABLE "pre_qualifications" ADD COLUMN IF NOT EXISTS "monthly_other_debt_cents"      INTEGER;
ALTER TABLE "pre_qualifications" ADD COLUMN IF NOT EXISTS "credit_score_estimate"         INTEGER;
ALTER TABLE "pre_qualifications" ADD COLUMN IF NOT EXISTS "front_end_dti_bps"             INTEGER;
ALTER TABLE "pre_qualifications" ADD COLUMN IF NOT EXISTS "back_end_dti_bps"              INTEGER;
ALTER TABLE "pre_qualifications" ADD COLUMN IF NOT EXISTS "benchmark_apr_bps"             INTEGER;
