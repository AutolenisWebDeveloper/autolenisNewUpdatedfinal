-- Migration: dealer_auth_system
-- Adds DealerApplication, DealerInvitation, and supporting fields for Areas 1-3

-- 1. Add requires_password_change to users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "requires_password_change" BOOLEAN NOT NULL DEFAULT false;

-- 2. Add license_number, agreed_to_terms_at, onboarding_step to dealers
ALTER TABLE "dealers" ADD COLUMN IF NOT EXISTS "license_number" TEXT;
ALTER TABLE "dealers" ADD COLUMN IF NOT EXISTS "agreed_to_terms_at" TIMESTAMP(3);
ALTER TABLE "dealers" ADD COLUMN IF NOT EXISTS "onboarding_step" TEXT NOT NULL DEFAULT 'BUSINESS_INFO';

-- 3. Create DealerApplicationStatus enum
DO $$ BEGIN
  CREATE TYPE "DealerApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 4. Create DealerInvitationStatus enum
DO $$ BEGIN
  CREATE TYPE "DealerInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 5. Create dealer_applications table
CREATE TABLE IF NOT EXISTS "dealer_applications" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "dealership_name" TEXT NOT NULL,
  "dealership_type" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "city" TEXT NOT NULL,
  "zip" TEXT NOT NULL,
  "license_number" TEXT NOT NULL,
  "contact_name" TEXT NOT NULL,
  "contact_email" TEXT NOT NULL,
  "contact_phone" TEXT,
  "annual_volume" TEXT,
  "notes" TEXT,
  "status" "DealerApplicationStatus" NOT NULL DEFAULT 'PENDING',
  "reviewed_by" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "reject_reason" TEXT,
  "dealer_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dealer_applications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "dealer_applications_dealer_id_key" UNIQUE ("dealer_id")
);
CREATE INDEX IF NOT EXISTS "dealer_applications_status_idx" ON "dealer_applications"("status");

-- 6. Create dealer_invitations table
CREATE TABLE IF NOT EXISTS "dealer_invitations" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "dealership_name" TEXT NOT NULL,
  "contact_name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "personal_message" TEXT,
  "token" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "status" "DealerInvitationStatus" NOT NULL DEFAULT 'PENDING',
  "invited_by" TEXT NOT NULL,
  "accepted_at" TIMESTAMP(3),
  "dealer_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dealer_invitations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "dealer_invitations_token_key" UNIQUE ("token"),
  CONSTRAINT "dealer_invitations_dealer_id_key" UNIQUE ("dealer_id")
);
CREATE INDEX IF NOT EXISTS "dealer_invitations_status_idx" ON "dealer_invitations"("status");
CREATE INDEX IF NOT EXISTS "dealer_invitations_token_idx" ON "dealer_invitations"("token");
