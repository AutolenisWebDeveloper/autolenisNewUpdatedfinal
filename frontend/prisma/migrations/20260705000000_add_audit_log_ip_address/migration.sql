-- Add ip_address column to admin_audit_logs for forensic audit trail.
-- Nullable so existing rows remain valid; new writes populate via getClientIp().
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'admin_audit_logs')) IS NOT NULL THEN
    ALTER TABLE "admin_audit_logs" ADD COLUMN "ip_address" TEXT;
  END IF;
END $$;
