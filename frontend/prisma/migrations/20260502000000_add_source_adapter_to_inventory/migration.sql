-- AlterTable
ALTER TABLE "inventory_items" ADD COLUMN "source_adapter" TEXT;

-- CreateIndex
CREATE INDEX "inventory_items_source_adapter_idx" ON "inventory_items"("source_adapter");
