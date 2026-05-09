-- Add per-admin MFA rate limiting fields
-- mfa_failed_attempts: incremented on each failed TOTP/backup-code attempt; reset on success
-- mfa_locked_until:    set to NOW() + 15 min after 5 consecutive failures; NULL when not locked

ALTER TABLE "admins" ADD COLUMN "mfa_failed_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "admins" ADD COLUMN "mfa_locked_until" TIMESTAMP(3);
