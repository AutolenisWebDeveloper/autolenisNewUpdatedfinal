-- Landing-page attribution columns on vehicle_requests.
-- Populated when the request originates from /lp/[campaign].
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'vehicle_requests')) IS NOT NULL THEN
    ALTER TABLE "vehicle_requests"
      ADD COLUMN IF NOT EXISTS "utm_source"   TEXT,
      ADD COLUMN IF NOT EXISTS "utm_medium"   TEXT,
      ADD COLUMN IF NOT EXISTS "utm_campaign" TEXT,
      ADD COLUMN IF NOT EXISTS "source_url"   TEXT,
      ADD COLUMN IF NOT EXISTS "ip_address"   TEXT;
  END IF;
END $$;
