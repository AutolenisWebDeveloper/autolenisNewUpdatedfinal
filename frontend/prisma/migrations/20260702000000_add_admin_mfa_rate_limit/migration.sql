-- Add per-admin MFA rate limiting fields
-- mfa_failed_attempts: incremented on each failed TOTP/backup-code attempt; reset on success
-- mfa_locked_until:    set to NOW() + 15 min after 5 consecutive failures; NULL when not locked

DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'admins')) IS NOT NULL THEN
    ALTER TABLE "admins" ADD COLUMN "mfa_failed_attempts" INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'admins')) IS NOT NULL THEN
    ALTER TABLE "admins" ADD COLUMN "mfa_locked_until" TIMESTAMP(3);
  END IF;
END $$;
