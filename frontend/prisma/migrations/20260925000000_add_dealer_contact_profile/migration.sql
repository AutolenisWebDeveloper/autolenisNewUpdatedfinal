-- Block B / B1 — DealerContactProfile: person-level contact identity keyed to the
-- canonical A2 DealerRooftop, so a registered Dealer and its prospect twin share
-- ONE contact history. Reconciled from the denormalized DealerProspect contact.*
-- fields. New table gets RLS enabled with no policy = deny-all for anon/
-- authenticated (all access is server-side via Prisma / service role).
--
-- Additive + idempotent. Rollback:
--   DROP TABLE IF EXISTS "dealer_contact_profiles";

CREATE TABLE IF NOT EXISTS "dealer_contact_profiles" (
  "id"                        TEXT NOT NULL,
  "rooftop_id"                TEXT NOT NULL,
  "name"                      TEXT,
  "name_key"                  TEXT,
  "title"                     TEXT,
  "email"                     TEXT,
  "email_key"                 TEXT,
  "phone"                     TEXT,
  "phone_key"                 TEXT,
  "email_source"              TEXT,
  "email_verification_status" TEXT,
  "email_verified_at"         TIMESTAMP(3),
  "contact_source"            TEXT,
  "contact_confidence"        TEXT,
  "last_verified_at"          TIMESTAMP(3),
  "created_at"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                TIMESTAMP(3) NOT NULL,
  CONSTRAINT "dealer_contact_profiles_pkey" PRIMARY KEY ("id")
);

-- Composite serves the FK (rooftop_id prefix) + in-rooftop email dedup;
-- email_key alone serves cross-rooftop shared-inbox scans (Block B).
CREATE INDEX IF NOT EXISTS "dealer_contact_profiles_rooftop_id_email_key_idx"
  ON "dealer_contact_profiles"("rooftop_id", "email_key");
CREATE INDEX IF NOT EXISTS "dealer_contact_profiles_email_key_idx"
  ON "dealer_contact_profiles"("email_key");

-- RLS: enable with no policy → deny-all for anon/authenticated (server-side only).
ALTER TABLE "dealer_contact_profiles" ENABLE ROW LEVEL SECURITY;

-- A contact profile is owned by its rooftop — cascade-delete with it.
DO $$
BEGIN
  IF to_regclass('"dealer_rooftops"') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dealer_contact_profiles_rooftop_id_fkey') THEN
    ALTER TABLE "dealer_contact_profiles"
      ADD CONSTRAINT "dealer_contact_profiles_rooftop_id_fkey"
      FOREIGN KEY ("rooftop_id") REFERENCES "dealer_rooftops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
