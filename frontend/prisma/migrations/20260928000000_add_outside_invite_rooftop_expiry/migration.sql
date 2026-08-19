-- C — outside-auction-invite rooftop dedup key + token expiry.
--
-- Additive + idempotent. rooftop_id is a soft key (no FK) so deleting a rooftop
-- never cascades into offer history. The UNIQUE(auction_id, rooftop_id) is the DB
-- backstop for the "one physical rooftop invited to an auction at most once" dedup
-- invariant (Postgres treats NULLs as distinct, so manual null-rooftop invites are
-- never blocked — only a repeated non-null rooftop on the same auction collides).
-- expires_at bounds token replay independently of auction status. The unique index
-- name matches the Prisma default (@@unique([auctionId, rooftopId]) ->
-- outside_auction_invites_auction_id_rooftop_id_key) to avoid drift.
--
-- Rollback:
--   DROP INDEX IF EXISTS "outside_auction_invites_auction_id_rooftop_id_key";
--   ALTER TABLE "outside_auction_invites" DROP COLUMN IF EXISTS "expires_at";
--   ALTER TABLE "outside_auction_invites" DROP COLUMN IF EXISTS "rooftop_id";

ALTER TABLE "outside_auction_invites" ADD COLUMN IF NOT EXISTS "rooftop_id" TEXT;
ALTER TABLE "outside_auction_invites" ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "outside_auction_invites_auction_id_rooftop_id_key" ON "outside_auction_invites"("auction_id", "rooftop_id");
