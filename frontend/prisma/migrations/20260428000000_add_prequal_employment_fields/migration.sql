-- Adds optional employment fields to PreQualification (AutoLenis-internal only,
-- never sent to MicroBilt). Adds prequal_consents table to record the exact
-- FCRA consent text accepted by each buyer. Adds OFAC_REVIEW to the
-- PreQualDecision enum, and adds vehicle preference fields to buyer_preferences.

-- New enum value for OFAC manual review path
ALTER TYPE "PreQualDecision" ADD VALUE IF NOT EXISTS 'OFAC_REVIEW';

-- Optional employment columns on pre_qualifications
ALTER TABLE "pre_qualifications"
    ADD COLUMN IF NOT EXISTS "employment_status"     TEXT,
    ADD COLUMN IF NOT EXISTS "employer_name"         TEXT,
    ADD COLUMN IF NOT EXISTS "monthly_income_cents"  INTEGER,
    ADD COLUMN IF NOT EXISTS "length_of_employment"  TEXT;

-- Vehicle preference columns on buyer_preferences (collected during onboarding)
ALTER TABLE "buyer_preferences"
    ADD COLUMN IF NOT EXISTS "vehicle_type_preference" TEXT,
    ADD COLUMN IF NOT EXISTS "new_or_used_preference"  TEXT;

-- prequal_consents — one row per FCRA acceptance, with the exact verbatim text
CREATE TABLE IF NOT EXISTS "prequal_consents" (
    "id"           TEXT NOT NULL,
    "prequal_id"   TEXT NOT NULL,
    "buyer_id"     TEXT NOT NULL,
    "consent_text" TEXT NOT NULL,
    "accepted_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address"   TEXT,
    "user_agent"   TEXT,

    CONSTRAINT "prequal_consents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "prequal_consents_prequal_id_idx" ON "prequal_consents"("prequal_id");
CREATE INDEX IF NOT EXISTS "prequal_consents_buyer_id_idx"   ON "prequal_consents"("buyer_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'prequal_consents_prequal_id_fkey'
  ) THEN
    ALTER TABLE "prequal_consents"
      ADD CONSTRAINT "prequal_consents_prequal_id_fkey"
      FOREIGN KEY ("prequal_id") REFERENCES "pre_qualifications"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
