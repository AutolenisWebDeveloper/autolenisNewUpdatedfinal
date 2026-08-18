-- A2 (Block A / unified sourcing) — canonical DealerRooftop + cross-pool links.
--
-- One row per real dealership location; registered Dealers and DealerProspects
-- resolve to it via the shared dealer-identity keys (persisted, indexed). New
-- table gets RLS enabled with no policy = deny-all for anon/authenticated (all
-- access is server-side via Prisma / service role, which bypass RLS).
--
-- Additive + idempotent. Rollback:
--   ALTER TABLE "dealers" DROP CONSTRAINT IF EXISTS "dealers_rooftop_id_fkey";
--   ALTER TABLE "dealers" DROP COLUMN IF EXISTS "rooftop_id";
--   ALTER TABLE "dealer_prospects" DROP CONSTRAINT IF EXISTS "dealer_prospects_rooftop_id_fkey";
--   ALTER TABLE "dealer_prospects" DROP COLUMN IF EXISTS "rooftop_id";
--   DROP TABLE IF EXISTS "dealer_rooftops";

CREATE TABLE IF NOT EXISTS "dealer_rooftops" (
  "id"                  TEXT NOT NULL,
  "display_name"        TEXT NOT NULL,
  "name_key"            TEXT NOT NULL,
  "website_host"        TEXT,
  "phone_key"           TEXT,
  "name_zip_key"        TEXT,
  "name_city_state_key" TEXT,
  "zip"                 TEXT,
  "city"                TEXT,
  "state"               TEXT,
  "latitude"            DOUBLE PRECISION,
  "longitude"           DOUBLE PRECISION,
  "makes"               TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "makes_source"        TEXT,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "dealer_rooftops_pkey" PRIMARY KEY ("id")
);

-- websiteHost is the strongest key: unique so two candidates on the same real
-- domain cannot create two rooftops (NULLs are distinct in Postgres).
CREATE UNIQUE INDEX IF NOT EXISTS "dealer_rooftops_website_host_key" ON "dealer_rooftops"("website_host");
CREATE INDEX IF NOT EXISTS "dealer_rooftops_phone_key_idx" ON "dealer_rooftops"("phone_key");
CREATE INDEX IF NOT EXISTS "dealer_rooftops_name_zip_key_idx" ON "dealer_rooftops"("name_zip_key");
CREATE INDEX IF NOT EXISTS "dealer_rooftops_name_city_state_key_idx" ON "dealer_rooftops"("name_city_state_key");

-- RLS: enable with no policy → deny-all for anon/authenticated (server-side only).
ALTER TABLE "dealer_rooftops" ENABLE ROW LEVEL SECURITY;

-- Cross-pool link columns (nullable; SetNull on rooftop delete).
ALTER TABLE "dealers" ADD COLUMN IF NOT EXISTS "rooftop_id" TEXT;
ALTER TABLE "dealer_prospects" ADD COLUMN IF NOT EXISTS "rooftop_id" TEXT;

CREATE INDEX IF NOT EXISTS "dealers_rooftop_id_idx" ON "dealers"("rooftop_id");
CREATE INDEX IF NOT EXISTS "dealer_prospects_rooftop_id_idx" ON "dealer_prospects"("rooftop_id");

DO $$
BEGIN
  IF to_regclass('"dealer_rooftops"') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dealers_rooftop_id_fkey') THEN
    ALTER TABLE "dealers"
      ADD CONSTRAINT "dealers_rooftop_id_fkey"
      FOREIGN KEY ("rooftop_id") REFERENCES "dealer_rooftops"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF to_regclass('"dealer_rooftops"') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dealer_prospects_rooftop_id_fkey') THEN
    ALTER TABLE "dealer_prospects"
      ADD CONSTRAINT "dealer_prospects_rooftop_id_fkey"
      FOREIGN KEY ("rooftop_id") REFERENCES "dealer_rooftops"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
