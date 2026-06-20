-- Migration: add_outside_invite_offer_detail
-- The OutsideAuctionInvite model in schema.prisma carries the outside dealer's
-- structured offer (OTD / vehicle / tax / fees breakdown + free-form notes) so
-- a response can be reconstructed into a real Offer. These columns existed in
-- the Prisma datamodel but no migration ever created them, causing schema drift
-- (the DB was missing the columns). Additive and nullable — safe + reversible.
ALTER TABLE "outside_auction_invites" ADD COLUMN IF NOT EXISTS "offer_otd_cents" INTEGER;
ALTER TABLE "outside_auction_invites" ADD COLUMN IF NOT EXISTS "offer_vehicle_cents" INTEGER;
ALTER TABLE "outside_auction_invites" ADD COLUMN IF NOT EXISTS "offer_tax_cents" INTEGER;
ALTER TABLE "outside_auction_invites" ADD COLUMN IF NOT EXISTS "offer_fees_cents" INTEGER;
ALTER TABLE "outside_auction_invites" ADD COLUMN IF NOT EXISTS "offer_notes" TEXT;
