-- Add ip_address column to admin_audit_logs for forensic audit trail.
-- Nullable so existing rows remain valid; new writes populate via getClientIp().
ALTER TABLE "admin_audit_logs" ADD COLUMN "ip_address" TEXT;
