-- Program 4 correction — terminal signing-record immutability.
-- Preserve every superseded TERMINAL signing attempt (VOIDED/DECLINED/EXPIRED) as
-- immutable historical evidence, so a subsequent authorized signing attempt that
-- reuses the one-per-deal ESignEnvelope working row can never mutate or recycle a
-- terminal record. Additive + idempotent; RLS enabled (deny-all — all access is
-- server-side via Prisma). NOT applied to production (owner-gated).
--
-- Rollback:
--   DROP TABLE IF EXISTS "e_sign_envelope_history";
--   ALTER TABLE "e_sign_envelopes" DROP COLUMN IF EXISTS "attempt_number";

-- Per-deal signing-attempt counter on the current working row.
ALTER TABLE "e_sign_envelopes"
  ADD COLUMN IF NOT EXISTS "attempt_number" INTEGER NOT NULL DEFAULT 1;

-- Append-only archive of superseded terminal signing attempts.
CREATE TABLE IF NOT EXISTS "e_sign_envelope_history" (
  "id"                      TEXT PRIMARY KEY,
  "deal_id"                 TEXT NOT NULL,
  "envelope_id"             TEXT NOT NULL,
  "attempt_number"          INTEGER NOT NULL,
  "status"                  "ESignStatus" NOT NULL,
  "document_version_id"     TEXT,
  "document_hash"           TEXT,
  "signer_user_id"          TEXT,
  "signer_role"             TEXT,
  "signer_name"             TEXT,
  "signer_email"            TEXT,
  "consented_to_electronic" BOOLEAN NOT NULL DEFAULT false,
  "consented_at"            TIMESTAMP(3),
  "signature_text"          TEXT,
  "signed_at"               TIMESTAMP(3),
  "viewed_at"               TIMESTAMP(3),
  "ip_address"              TEXT,
  "user_agent"              TEXT,
  "decline_reason"          TEXT,
  "voided_at"               TIMESTAMP(3),
  "void_reason"             TEXT,
  "expires_at"              TIMESTAMP(3),
  "completed_at"            TIMESTAMP(3),
  "certificate_pdf_path"    TEXT,
  "sent_at"                 TIMESTAMP(3),
  "superseded_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF to_regclass('public.e_sign_envelope_history') IS NOT NULL
     AND to_regclass('public.deals') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint WHERE conname = 'e_sign_envelope_history_deal_id_fkey'
     ) THEN
    ALTER TABLE "e_sign_envelope_history"
      ADD CONSTRAINT "e_sign_envelope_history_deal_id_fkey"
      FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "e_sign_envelope_history_deal_id_idx" ON "e_sign_envelope_history" ("deal_id");
CREATE INDEX IF NOT EXISTS "e_sign_envelope_history_envelope_id_idx" ON "e_sign_envelope_history" ("envelope_id");

-- RLS: enable + deny-all (no policies). All legitimate access is server-side via
-- Prisma (table owner / service role), consistent with the other AutoLenis tables.
ALTER TABLE "e_sign_envelope_history" ENABLE ROW LEVEL SECURITY;
