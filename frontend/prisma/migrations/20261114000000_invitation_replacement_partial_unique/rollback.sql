-- Rollback for 20261114000000_invitation_replacement_partial_unique.
--
-- NOT run by Prisma. This file is the documented reverse, kept beside the migration the way
-- eight other directories in this chain do, for an owner who needs to undo it by hand.
--
-- SAFE ONLY WHILE NO REPLACEMENT HAS HAPPENED. Restoring the status-blind indexes will FAIL with
-- 23505 if any (auction_id, rooftop_id) or (auction_id, dealer_id) pair has both a REPLACED row and
-- a live one — which is exactly the state the forward migration exists to permit. Check first:
--
--   SELECT auction_id, rooftop_id, count(*) FROM auction_invitations
--    WHERE rooftop_id IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1;
--
-- A non-empty result means this rollback cannot run without deciding which row to delete, and that
-- is a business decision about a dealership's invitation, not a schema step.

CREATE UNIQUE INDEX IF NOT EXISTS "auction_invitations_auction_rooftop_key"
  ON "auction_invitations" ("auction_id", "rooftop_id")
  WHERE "rooftop_id" IS NOT NULL;

DROP INDEX IF EXISTS "auction_invitations_auction_rooftop_active_key";

CREATE UNIQUE INDEX IF NOT EXISTS "auction_invitations_auction_id_dealer_id_key"
  ON "auction_invitations" ("auction_id", "dealer_id");

DROP INDEX IF EXISTS "auction_invitations_auction_id_dealer_active_key";
