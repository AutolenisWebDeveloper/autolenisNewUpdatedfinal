-- Migration: add_prequal_consent_accepted_at
-- Adds accepted_at column to prequal_consents to match Prisma schema (PrequalConsent.acceptedAt)
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'prequal_consents')) IS NOT NULL THEN
    ALTER TABLE "prequal_consents" ADD COLUMN IF NOT EXISTS "accepted_at" TIMESTAMP(3) DEFAULT NOW();
  END IF;
END $$;

-- Backfill from created_at ONLY where that column exists.
--
-- prequal_consents has never had a created_at column: the migration that creates
-- the table (20260428000000) does not define one, and the PrequalConsent model
-- does not either. The original unguarded UPDATE therefore failed with 42703 on
-- every database that reached it, which is where `prisma migrate deploy` died on
-- a fresh provision — at migration 22 of 94.
--
-- The guard is kept rather than the statement deleted so that a legacy database
-- that DOES carry created_at still gets the historically accurate value instead
-- of the NOW() supplied by the ADD COLUMN default above.
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'prequal_consents')) IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'prequal_consents'
         AND column_name = 'created_at'
     ) THEN
    UPDATE "prequal_consents" SET "accepted_at" = "created_at" WHERE "accepted_at" IS NULL;
  END IF;
END $$;

-- Any row still NULL (no created_at to copy from) takes the column default.
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'prequal_consents')) IS NOT NULL THEN
    UPDATE "prequal_consents" SET "accepted_at" = NOW() WHERE "accepted_at" IS NULL;
    ALTER TABLE "prequal_consents" ALTER COLUMN "accepted_at" SET NOT NULL;
  END IF;
END $$;
