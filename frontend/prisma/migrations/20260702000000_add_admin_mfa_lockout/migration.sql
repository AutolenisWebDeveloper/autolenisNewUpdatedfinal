-- Add rate-limiting and operational-reset tracking fields to admins table
-- NOTE: mfa_failed_attempts was already added by add_admin_mfa_rate_limit migration
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'admins')) IS NOT NULL THEN
    ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "mfa_failed_attempts" INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'admins')) IS NOT NULL THEN
    ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "mfa_locked_until" TIMESTAMP(3);
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'admins')) IS NOT NULL THEN
    ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "mfa_reset_at" TIMESTAMP(3);
  END IF;
END $$;

-- Add email confirmation token table for MFA setup gate
CREATE TABLE IF NOT EXISTS "admin_mfa_email_tokens" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "admin_mfa_email_tokens_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'admin_mfa_email_tokens')) IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS "admin_mfa_email_tokens_admin_id_idx" ON "admin_mfa_email_tokens"("admin_id");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'admin_mfa_email_tokens_admin_id_fkey'
  ) THEN
    ALTER TABLE "admin_mfa_email_tokens"
      ADD CONSTRAINT "admin_mfa_email_tokens_admin_id_fkey"
      FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
