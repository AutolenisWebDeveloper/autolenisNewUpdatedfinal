-- Store server-generated bcrypt recovery code hashes while MFA setup/reset awaits confirmation.
-- The client only receives plaintext codes for display and never receives or submits hashes.

DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'admins')) IS NOT NULL THEN
    ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "pending_recovery_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
  END IF;
END $$;
