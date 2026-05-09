-- Add pending_recovery_codes column to admins table for server-side MFA setup flow
ALTER TABLE "admins" ADD COLUMN "pending_recovery_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
