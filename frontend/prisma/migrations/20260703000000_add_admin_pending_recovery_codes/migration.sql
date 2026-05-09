-- Store server-generated bcrypt recovery code hashes while MFA setup/reset awaits confirmation.
-- The client only receives plaintext codes for display and never receives or submits hashes.

ALTER TABLE "admins" ADD COLUMN "pending_recovery_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
