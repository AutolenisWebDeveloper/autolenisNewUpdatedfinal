-- Add pending_recovery_codes column to admins table for server-side MFA setup flow
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'admins')) IS NOT NULL THEN
    ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "pending_recovery_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
  END IF;
END $$;
