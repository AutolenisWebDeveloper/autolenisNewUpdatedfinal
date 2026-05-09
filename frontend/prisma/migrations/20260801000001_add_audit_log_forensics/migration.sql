-- Migration: add_audit_log_forensics
-- Adds forensic fields to admin_audit_logs for richer audit trails
ALTER TABLE "admin_audit_logs" ADD COLUMN IF NOT EXISTS "previous_state" JSONB;
ALTER TABLE "admin_audit_logs" ADD COLUMN IF NOT EXISTS "new_state"      JSONB;
ALTER TABLE "admin_audit_logs" ADD COLUMN IF NOT EXISTS "ip_address"     TEXT;
ALTER TABLE "admin_audit_logs" ADD COLUMN IF NOT EXISTS "session_id"     TEXT;
