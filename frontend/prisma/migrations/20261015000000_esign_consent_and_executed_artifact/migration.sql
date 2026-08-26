-- Program 4 e-sign COMPLETION — consent record + executed contract artifact.
--
-- ⚠️ OWNER-GATED — AUTHORED, NOT APPLIED. This migration is dormant. It must not
-- be applied to production until (1) an attorney/compliance review of the consent
-- policy (DRAFT_V1) and executed-artifact sufficiency is complete, and (2) the
-- owner explicitly approves activation. ESIGN/UETA legal sufficiency remains
-- NOT VERIFIED — REQUIRES ATTORNEY/COMPLIANCE REVIEW.
--
-- Additive + idempotent (expand step of expand→backfill→enforce): every column is
-- nullable, so existing rows, historical DocuSign envelopes, and already-archived
-- history rows are untouched. No column is dropped, no constraint tightened.
--
-- What it adds:
--  • e_sign_envelopes: per-attempt consent policy version + frozen consent
--    snapshot (JSONB); executed-contract artifact key/hash/timestamp; a
--    confirmation-sequencing marker so buyer/dealer "signed contract is ready"
--    notifications are emitted exactly once and only after the artifact exists.
--  • e_sign_envelope_history: the same consent + executed-artifact references, so
--    the frozen consent snapshot and executed copy survive archival bound to the
--    correct superseded attempt (terminal-immutability, §10 integration).
--
-- Rollback (down SQL):
--   ALTER TABLE "e_sign_envelopes"
--     DROP COLUMN IF EXISTS "consent_policy_version",
--     DROP COLUMN IF EXISTS "consent_snapshot",
--     DROP COLUMN IF EXISTS "executed_document_key",
--     DROP COLUMN IF EXISTS "executed_document_hash",
--     DROP COLUMN IF EXISTS "executed_generated_at",
--     DROP COLUMN IF EXISTS "confirmations_sent_at";
--   ALTER TABLE "e_sign_envelope_history"
--     DROP COLUMN IF EXISTS "consent_policy_version",
--     DROP COLUMN IF EXISTS "consent_snapshot",
--     DROP COLUMN IF EXISTS "executed_document_key",
--     DROP COLUMN IF EXISTS "executed_document_hash",
--     DROP COLUMN IF EXISTS "executed_generated_at";

-- Consent record + executed-artifact evidence on the current working row.
ALTER TABLE "e_sign_envelopes"
  ADD COLUMN IF NOT EXISTS "consent_policy_version"  TEXT,
  ADD COLUMN IF NOT EXISTS "consent_snapshot"        JSONB,
  ADD COLUMN IF NOT EXISTS "executed_document_key"   TEXT,
  ADD COLUMN IF NOT EXISTS "executed_document_hash"  TEXT,
  ADD COLUMN IF NOT EXISTS "executed_generated_at"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "confirmations_sent_at"   TIMESTAMP(3);

-- Same references on the append-only history archive, so consent + executed
-- evidence survive archival bound to the superseded attempt (never rewritten).
ALTER TABLE "e_sign_envelope_history"
  ADD COLUMN IF NOT EXISTS "consent_policy_version"  TEXT,
  ADD COLUMN IF NOT EXISTS "consent_snapshot"        JSONB,
  ADD COLUMN IF NOT EXISTS "executed_document_key"   TEXT,
  ADD COLUMN IF NOT EXISTS "executed_document_hash"  TEXT,
  ADD COLUMN IF NOT EXISTS "executed_generated_at"   TIMESTAMP(3);
