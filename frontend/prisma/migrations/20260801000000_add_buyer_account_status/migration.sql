-- Migration: add_buyer_account_status
-- Adds suspension fields to buyers table for admin suspend/unsuspend actions
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'buyers')) IS NOT NULL THEN
    ALTER TABLE "buyers" ADD COLUMN IF NOT EXISTS "is_suspended"      BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'buyers')) IS NOT NULL THEN
    ALTER TABLE "buyers" ADD COLUMN IF NOT EXISTS "suspended_at"      TIMESTAMP(3);
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'buyers')) IS NOT NULL THEN
    ALTER TABLE "buyers" ADD COLUMN IF NOT EXISTS "suspended_reason"  TEXT;
  END IF;
END $$;
