-- Migration: add_prequal_consent_accepted_at
-- Adds accepted_at column to prequal_consents to match Prisma schema (PrequalConsent.acceptedAt)
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'prequal_consents')) IS NOT NULL THEN
    ALTER TABLE "prequal_consents" ADD COLUMN IF NOT EXISTS "accepted_at" TIMESTAMP(3) DEFAULT NOW();
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'prequal_consents')) IS NOT NULL THEN
    UPDATE "prequal_consents" SET "accepted_at" = "created_at" WHERE "accepted_at" IS NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'prequal_consents')) IS NOT NULL THEN
    ALTER TABLE "prequal_consents" ALTER COLUMN "accepted_at" SET NOT NULL;
  END IF;
END $$;
