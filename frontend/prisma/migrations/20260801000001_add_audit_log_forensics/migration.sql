-- Migration: add_audit_log_forensics
-- Adds forensic fields to admin_audit_logs for richer audit trails
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'admin_audit_logs')) IS NOT NULL THEN
    ALTER TABLE "admin_audit_logs" ADD COLUMN IF NOT EXISTS "previous_state" JSONB;
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'admin_audit_logs')) IS NOT NULL THEN
    ALTER TABLE "admin_audit_logs" ADD COLUMN IF NOT EXISTS "new_state"      JSONB;
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'admin_audit_logs')) IS NOT NULL THEN
    ALTER TABLE "admin_audit_logs" ADD COLUMN IF NOT EXISTS "ip_address"     TEXT;
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'admin_audit_logs')) IS NOT NULL THEN
    ALTER TABLE "admin_audit_logs" ADD COLUMN IF NOT EXISTS "session_id"     TEXT;
  END IF;
END $$;
