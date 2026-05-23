DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'admins')) IS NOT NULL THEN
    ALTER TABLE "admins" ADD COLUMN "last_recovery_code_used_at" TIMESTAMP(3);
  END IF;
END $$;
