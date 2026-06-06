-- Migration: p0_prequal_error_metadata (P0-2 prequal failure operability)
-- Adds queryable provider-error metadata to pre_qualifications and a per-attempt
-- forensic table. All statements are idempotent (IF NOT EXISTS) so this is safe
-- to re-run and safe against any prod-side artifacts left by a prior db push.

-- ── pre_qualifications: queryable error metadata ────────────────────────────
ALTER TABLE "pre_qualifications"
  ADD COLUMN IF NOT EXISTS "error_stage" TEXT;
ALTER TABLE "pre_qualifications"
  ADD COLUMN IF NOT EXISTS "error_code" TEXT;
ALTER TABLE "pre_qualifications"
  ADD COLUMN IF NOT EXISTS "error_message" TEXT;
ALTER TABLE "pre_qualifications"
  ADD COLUMN IF NOT EXISTS "last_error_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "pre_qualifications_error_stage_idx"
  ON "pre_qualifications" ("error_stage");
CREATE INDEX IF NOT EXISTS "pre_qualifications_error_code_idx"
  ON "pre_qualifications" ("error_code");
CREATE INDEX IF NOT EXISTS "pre_qualifications_last_error_at_idx"
  ON "pre_qualifications" ("last_error_at");

-- ── prequal_attempt_errors: per-attempt forensic history ────────────────────
CREATE TABLE IF NOT EXISTS "prequal_attempt_errors" (
  "id"                     TEXT NOT NULL,
  "buyer_id"               TEXT NOT NULL,
  "prequal_application_id" TEXT,
  "attempted_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "error_stage"            TEXT NOT NULL,
  "error_code"             TEXT NOT NULL,
  "error_message"          TEXT,
  "http_status"            INTEGER,
  "requested_url"          TEXT,
  "encrypted_payload"      TEXT,
  "resolved_at"            TIMESTAMP(3),
  "resolved_by"            TEXT,
  "resolution_notes"       TEXT,
  CONSTRAINT "prequal_attempt_errors_pkey" PRIMARY KEY ("id")
);

-- Foreign key to buyers (RESTRICT on delete preserves the audit trail).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'prequal_attempt_errors_buyer_id_fkey'
  ) THEN
    ALTER TABLE "prequal_attempt_errors"
      ADD CONSTRAINT "prequal_attempt_errors_buyer_id_fkey"
      FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "prequal_attempt_errors_buyer_id_idx"
  ON "prequal_attempt_errors" ("buyer_id");
CREATE INDEX IF NOT EXISTS "prequal_attempt_errors_prequal_application_id_idx"
  ON "prequal_attempt_errors" ("prequal_application_id");
CREATE INDEX IF NOT EXISTS "prequal_attempt_errors_error_stage_error_code_idx"
  ON "prequal_attempt_errors" ("error_stage", "error_code");
CREATE INDEX IF NOT EXISTS "prequal_attempt_errors_attempted_at_idx"
  ON "prequal_attempt_errors" ("attempted_at");
CREATE INDEX IF NOT EXISTS "prequal_attempt_errors_resolved_at_idx"
  ON "prequal_attempt_errors" ("resolved_at");
