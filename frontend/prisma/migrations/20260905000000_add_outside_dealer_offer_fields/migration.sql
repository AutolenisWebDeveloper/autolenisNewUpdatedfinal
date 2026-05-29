-- Migration: add_outside_dealer_offer_fields
-- Adds outside / unregistered dealer support to the Offer model so that
-- offers from outside dealers (and admin manual entries) flow through the
-- best-price engine and buyer comparison panel. Also links an
-- outside_auction_invite back to the Offer record it produced.

ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "external_dealer_name"  TEXT;
ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "external_dealer_email" TEXT;
ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "external_dealer_phone" TEXT;
ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "notes"                 TEXT;
ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "submitted_by_admin_id" TEXT;

-- Flag the system "Outside Dealer" placeholder so it can be excluded from
-- dealer-facing matching and public-facing dealer stats.
ALTER TABLE "dealers" ADD COLUMN IF NOT EXISTS "is_system_placeholder" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "outside_auction_invites" ADD COLUMN IF NOT EXISTS "offer_id" TEXT;

DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'outside_auction_invites')) IS NOT NULL THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "outside_auction_invites_offer_id_key"
      ON "outside_auction_invites"("offer_id");
  END IF;
END $$;
