-- Add lat/lon coordinates to inventory_items
ALTER TABLE "inventory_items"
  ADD COLUMN "latitude" DECIMAL(10,7),
  ADD COLUMN "longitude" DECIMAL(10,7);
