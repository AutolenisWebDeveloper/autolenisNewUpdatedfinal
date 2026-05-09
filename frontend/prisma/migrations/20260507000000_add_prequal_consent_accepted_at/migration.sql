-- Migration: add_prequal_consent_accepted_at
-- Adds accepted_at column to prequal_consents to match Prisma schema (PrequalConsent.acceptedAt)
ALTER TABLE "prequal_consents" ADD COLUMN IF NOT EXISTS "accepted_at" TIMESTAMP(3) DEFAULT NOW();
UPDATE "prequal_consents" SET "accepted_at" = "created_at" WHERE "accepted_at" IS NULL;
ALTER TABLE "prequal_consents" ALTER COLUMN "accepted_at" SET NOT NULL;
