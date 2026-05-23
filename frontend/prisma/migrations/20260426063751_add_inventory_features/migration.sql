DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'inventory_items')) IS NOT NULL THEN
    ALTER TABLE "inventory_items"
      ADD COLUMN "features" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
  END IF;
END $$;
