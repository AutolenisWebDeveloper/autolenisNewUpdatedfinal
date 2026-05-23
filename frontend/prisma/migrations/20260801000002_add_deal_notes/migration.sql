-- Migration: add_deal_notes
-- Creates deal_notes table for admin-only internal notes on deals
CREATE TABLE IF NOT EXISTS "deal_notes" (
  "id"          TEXT NOT NULL,
  "deal_id"     TEXT NOT NULL,
  "admin_id"    TEXT NOT NULL,
  "admin_email" TEXT NOT NULL,
  "content"     TEXT NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "deal_notes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "deal_notes_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'deal_notes')) IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS "deal_notes_deal_id_idx" ON "deal_notes"("deal_id");
  END IF;
END $$;
