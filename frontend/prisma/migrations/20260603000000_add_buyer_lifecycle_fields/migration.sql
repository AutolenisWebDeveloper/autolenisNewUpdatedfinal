-- AlterTable: add lifecycle tracking fields to buyers
-- archivedAt: set when buyer is archived by admin; cleared on restore
-- disabledAt: set when buyer login access is disabled by admin; cleared on reactivate
-- purgedAt:   set when buyer PII is anonymized via privacy-safe purge
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'buyers')) IS NOT NULL THEN
    ALTER TABLE "buyers" ADD COLUMN IF NOT EXISTS "archived_at"  TIMESTAMP(3);
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'buyers')) IS NOT NULL THEN
    ALTER TABLE "buyers" ADD COLUMN IF NOT EXISTS "disabled_at"  TIMESTAMP(3);
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'buyers')) IS NOT NULL THEN
    ALTER TABLE "buyers" ADD COLUMN IF NOT EXISTS "purged_at"    TIMESTAMP(3);
  END IF;
END $$;
