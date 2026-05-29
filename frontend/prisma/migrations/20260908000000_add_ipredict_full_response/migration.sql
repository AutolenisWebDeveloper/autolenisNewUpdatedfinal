-- Migration: add_ipredict_full_response
-- Production iPredict Advantage cutover (iPredict_6.yaml). Persists the full
-- parsed response for audit + decision transparency:
--   - credit_score          DECISION.SCORES[].Value (300–850)
--   - idv_score             SERVICEDETAILS.IDV.score
--   - mla_covered           Military Lending Act covered-borrower status
--   - fraud_warning         SERVICEDETAILS.IDV.fraudWarning
--   - adverse_reason_codes  DECISION.REASONS[].code (FCRA § 615)
--   - deceased_flag         SERVICEDETAILS.IDV.deceasedIndicator
--   - bankruptcy_flag       SERVICEDETAILS.IDV.bankruptcyFlag

ALTER TABLE "pre_qualifications"
  ADD COLUMN IF NOT EXISTS "credit_score"         INTEGER,
  ADD COLUMN IF NOT EXISTS "idv_score"            INTEGER,
  ADD COLUMN IF NOT EXISTS "mla_covered"          BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "fraud_warning"        TEXT,
  ADD COLUMN IF NOT EXISTS "adverse_reason_codes" TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "deceased_flag"        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "bankruptcy_flag"      BOOLEAN NOT NULL DEFAULT FALSE;
