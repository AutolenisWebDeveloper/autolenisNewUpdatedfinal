-- AlterTable
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'inventory_items')) IS NOT NULL THEN
    ALTER TABLE "inventory_items" ADD COLUMN "source_adapter" TEXT;
  END IF;
END $$;

-- CreateIndex
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'inventory_items')) IS NOT NULL THEN
    CREATE INDEX "inventory_items_source_adapter_idx" ON "inventory_items"("source_adapter");
  END IF;
END $$;
