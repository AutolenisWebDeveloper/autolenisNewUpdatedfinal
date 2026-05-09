-- AlterTable: add lifecycle tracking fields to buyers
-- archivedAt: set when buyer is archived by admin; cleared on restore
-- disabledAt: set when buyer login access is disabled by admin; cleared on reactivate
-- purgedAt:   set when buyer PII is anonymized via privacy-safe purge
ALTER TABLE "buyers" ADD COLUMN IF NOT EXISTS "archived_at"  TIMESTAMP(3);
ALTER TABLE "buyers" ADD COLUMN IF NOT EXISTS "disabled_at"  TIMESTAMP(3);
ALTER TABLE "buyers" ADD COLUMN IF NOT EXISTS "purged_at"    TIMESTAMP(3);
