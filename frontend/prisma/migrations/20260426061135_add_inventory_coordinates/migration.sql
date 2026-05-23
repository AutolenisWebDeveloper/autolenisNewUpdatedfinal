-- Add lat/lon coordinates to inventory_items
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'inventory_items')) IS NOT NULL THEN
    ALTER TABLE "inventory_items"
      ADD COLUMN "latitude" DECIMAL(10,7),
      ADD COLUMN "longitude" DECIMAL(10,7);
  END IF;
END $$;
