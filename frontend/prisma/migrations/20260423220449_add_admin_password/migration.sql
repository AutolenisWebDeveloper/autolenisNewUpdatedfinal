-- AlterTable
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'admins')) IS NOT NULL THEN
    ALTER TABLE "admins" ADD COLUMN     "password_hash" TEXT;
  END IF;
END $$;
