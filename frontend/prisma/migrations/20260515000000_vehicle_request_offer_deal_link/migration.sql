-- Make offerId nullable on deals
ALTER TABLE deals ALTER COLUMN offer_id DROP NOT NULL;

-- Add vehicle_request_offer_id column to deals
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS vehicle_request_offer_id TEXT UNIQUE;

-- Add foreign key constraint
ALTER TABLE deals
  ADD CONSTRAINT deals_vehicle_request_offer_id_fkey
  FOREIGN KEY (vehicle_request_offer_id)
  REFERENCES vehicle_request_offers(id)
  ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;
