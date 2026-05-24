-- Migration: add_admin_is_active
-- Adds soft-delete fields to admins table so admin accounts can be deactivated
-- (isActive = false) instead of hard-deleted, preserving audit history.
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'admins')) IS NOT NULL THEN
    ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "isActive"        BOOLEAN NOT NULL DEFAULT true;
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'admins')) IS NOT NULL THEN
    ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "deactivated_at"  TIMESTAMP(3);
  END IF;
END $$;
