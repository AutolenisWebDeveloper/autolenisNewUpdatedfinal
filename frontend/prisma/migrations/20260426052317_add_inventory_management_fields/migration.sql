-- Migration: add vehicle detail fields + upload batch tracking

-- New columns for inventory_items
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'inventory_items')) IS NOT NULL THEN
    ALTER TABLE "inventory_items"
      ADD COLUMN IF NOT EXISTS "condition"        TEXT,
      ADD COLUMN IF NOT EXISTS "body_type"        TEXT,
      ADD COLUMN IF NOT EXISTS "exterior_color"   TEXT,
      ADD COLUMN IF NOT EXISTS "interior_color"   TEXT,
      ADD COLUMN IF NOT EXISTS "engine"           TEXT,
      ADD COLUMN IF NOT EXISTS "transmission"     TEXT,
      ADD COLUMN IF NOT EXISTS "drivetrain"       TEXT,
      ADD COLUMN IF NOT EXISTS "fuel_type"        TEXT,
      ADD COLUMN IF NOT EXISTS "city"             TEXT,
      ADD COLUMN IF NOT EXISTS "state"            TEXT,
      ADD COLUMN IF NOT EXISTS "zip"              TEXT,
      ADD COLUMN IF NOT EXISTS "added_by_admin_id" TEXT;
  END IF;
END $$;

-- New table for upload batch tracking
CREATE TABLE IF NOT EXISTS "inventory_upload_batches" (
  "id"            TEXT        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "admin_id"      TEXT        NOT NULL,
  "admin_email"   TEXT        NOT NULL,
  "filename"      TEXT,
  "total_rows"    INTEGER     NOT NULL DEFAULT 0,
  "success_count" INTEGER     NOT NULL DEFAULT 0,
  "failure_count" INTEGER     NOT NULL DEFAULT 0,
  "status"        TEXT        NOT NULL DEFAULT 'COMPLETED',
  "errors"        JSONB       NOT NULL DEFAULT '[]',
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'inventory_upload_batches')) IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS "inventory_upload_batches_admin_id_idx"
      ON "inventory_upload_batches" ("admin_id");
  END IF;
END $$;
