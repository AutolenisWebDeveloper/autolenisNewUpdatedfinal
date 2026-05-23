-- Idempotent: makes deals.offer_id nullable and adds the
-- vehicle_request_offer_id link. Wrapped in a DO block that no-ops if the
-- deals table doesn't exist yet (so this file can be safely re-applied or
-- run against a fresh shadow DB without crashing).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'deals' AND n.nspname = current_schema()
  ) THEN
    RAISE NOTICE 'Skipping: deals table not present yet';
    RETURN;
  END IF;

  -- Drop NOT NULL on offer_id (no-op if already nullable).
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'deals'
      AND column_name = 'offer_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE deals ALTER COLUMN offer_id DROP NOT NULL;
  END IF;

  -- Add vehicle_request_offer_id column if not already there.
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'deals'
      AND column_name = 'vehicle_request_offer_id'
  ) THEN
    ALTER TABLE deals ADD COLUMN vehicle_request_offer_id TEXT;
  END IF;

  -- Unique constraint on the new column.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema()
      AND t.relname = 'deals'
      AND c.conname = 'deals_vehicle_request_offer_id_key'
  ) THEN
    ALTER TABLE deals ADD CONSTRAINT deals_vehicle_request_offer_id_key
      UNIQUE (vehicle_request_offer_id);
  END IF;

  -- Foreign key — added only if the referenced table exists and the FK
  -- isn't already in place. ON DELETE SET NULL matches the Prisma schema.
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'vehicle_request_offers' AND n.nspname = current_schema()
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema()
      AND t.relname = 'deals'
      AND c.conname = 'deals_vehicle_request_offer_id_fkey'
  ) THEN
    ALTER TABLE deals
      ADD CONSTRAINT deals_vehicle_request_offer_id_fkey
      FOREIGN KEY (vehicle_request_offer_id)
      REFERENCES vehicle_request_offers(id)
      ON DELETE SET NULL
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END
$$;
