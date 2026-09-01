-- =====================================================
-- AutoLenis Group 5 — Unified Buyer Intake Foundation
-- =====================================================
-- NOTE: The VehicleRequest model maps to the snake_case table
-- "vehicle_requests" (see @@map in schema.prisma), so Part 2
-- targets vehicle_requests — NOT a PascalCase "VehicleRequest" table.

-- Part 1: Add source column to buyer_opportunities
ALTER TABLE buyer_opportunities
  ADD COLUMN IF NOT EXISTS source TEXT;

CREATE INDEX IF NOT EXISTS buyer_opportunities_source_idx
  ON buyer_opportunities (source);

-- Part 2: Add buyer_opportunity_id to vehicle_requests
ALTER TABLE vehicle_requests
  ADD COLUMN IF NOT EXISTS buyer_opportunity_id TEXT;

CREATE INDEX IF NOT EXISTS vehiclerequest_buyer_opportunity_idx
  ON vehicle_requests (buyer_opportunity_id);

-- Part 3: Foreign key (optional, soft)
-- Skipped intentionally — keeping the link soft so deletions
-- of either side don't cascade unexpectedly. Application
-- enforces consistency.
