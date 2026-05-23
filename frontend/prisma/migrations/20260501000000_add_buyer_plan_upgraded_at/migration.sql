-- AlterTable: add plan_upgraded_at to buyers
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'buyers')) IS NOT NULL THEN
    ALTER TABLE "buyers" ADD COLUMN IF NOT EXISTS "plan_upgraded_at" TIMESTAMP(3);
  END IF;
END $$;
