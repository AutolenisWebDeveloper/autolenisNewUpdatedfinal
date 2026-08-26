-- Program 4 correction: in-house electronic-signature evidence on ESignEnvelope.
-- DocuSign is removed from runtime; the buyer purchase-contract signature is now
-- captured, hashed, and certified in-house. This migration is ADDITIVE and
-- idempotent (expand step of expand→backfill→enforce): every column is nullable
-- (or has a safe default), so existing rows and historical DocuSign envelopes are
-- untouched. The legacy docusign_envelope_id / document_key columns are RETAINED
-- for historical records and are NOT dropped.
--
-- Rollback: DROP the added columns and the index below, and remove EXPIRED from
-- the enum is NOT required (append-only enum value is inert if unused). Down SQL:
--   ALTER TABLE "e_sign_envelopes"
--     DROP COLUMN IF EXISTS "document_version_id",
--     DROP COLUMN IF EXISTS "document_hash",
--     DROP COLUMN IF EXISTS "signer_user_id",
--     DROP COLUMN IF EXISTS "signer_role",
--     DROP COLUMN IF EXISTS "signer_name",
--     DROP COLUMN IF EXISTS "signer_email",
--     DROP COLUMN IF EXISTS "consented_to_electronic",
--     DROP COLUMN IF EXISTS "consented_at",
--     DROP COLUMN IF EXISTS "signature_text",
--     DROP COLUMN IF EXISTS "signed_at",
--     DROP COLUMN IF EXISTS "viewed_at",
--     DROP COLUMN IF EXISTS "ip_address",
--     DROP COLUMN IF EXISTS "user_agent",
--     DROP COLUMN IF EXISTS "decline_reason",
--     DROP COLUMN IF EXISTS "expires_at",
--     DROP COLUMN IF EXISTS "certificate_pdf_path",
--     DROP COLUMN IF EXISTS "certificate_generated_at";
--   DROP INDEX IF EXISTS "e_sign_envelopes_document_version_id_idx";

-- Append the EXPIRED lifecycle value (append-only; safe if never used).
ALTER TYPE "ESignStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';

-- In-house signature evidence columns (all additive / nullable).
ALTER TABLE "e_sign_envelopes"
  ADD COLUMN IF NOT EXISTS "document_version_id" TEXT,
  ADD COLUMN IF NOT EXISTS "document_hash" TEXT,
  ADD COLUMN IF NOT EXISTS "signer_user_id" TEXT,
  ADD COLUMN IF NOT EXISTS "signer_role" TEXT,
  ADD COLUMN IF NOT EXISTS "signer_name" TEXT,
  ADD COLUMN IF NOT EXISTS "signer_email" TEXT,
  ADD COLUMN IF NOT EXISTS "consented_to_electronic" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "consented_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "signature_text" TEXT,
  ADD COLUMN IF NOT EXISTS "signed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "viewed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "ip_address" TEXT,
  ADD COLUMN IF NOT EXISTS "user_agent" TEXT,
  ADD COLUMN IF NOT EXISTS "decline_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "certificate_pdf_path" TEXT,
  ADD COLUMN IF NOT EXISTS "certificate_generated_at" TIMESTAMP(3);

-- Index the evidence document reference for lookups/backstops.
CREATE INDEX IF NOT EXISTS "e_sign_envelopes_document_version_id_idx"
  ON "e_sign_envelopes" ("document_version_id");
