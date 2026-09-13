-- Migration 110 — let a REPLACED invitation stop occupying its rooftop's and dealer's slot.
--
-- WHY. §8.2's contact-replacement path marks the bounced invitation `REPLACED` and then issues a
-- new one for the same rooftop. Both unique indexes on `auction_invitations` are blind to status,
-- so the second insert collides with the row that was just retired:
--
--   auction_invitations_auction_rooftop_key       (auction_id, rooftop_id) WHERE rooftop_id IS NOT NULL
--     -- 20261106000100_transaction_spine_foundation:1093, raw SQL, invisible to the Prisma DSL.
--        This is the one that bites the COMMON case: every rooftop-bound invitation.
--
--   auction_invitations_auction_id_dealer_id_key  (auction_id, dealer_id)
--     -- 20260423003354_init:771. `dealer_id` is nullable and PostgreSQL treats NULLs as distinct,
--        so outside rooftops slipped past this one; registered dealers did not.
--
-- `reflectInvitationDeliveryEvent` -> `INVITATION_BOUNCED` -> contact replacement was wired up in
-- §8.2 from having had no caller at all, so the path has never run in production: production holds
-- zero sourcing cases and no invitation has ever gone through the Phase 5 rail. This lands before
-- anything can hit it rather than after.
--
-- WHAT CHANGES. Each index gains `AND "status" <> 'REPLACED'`. Nothing else: the columns, the
-- NULL handling and the uniqueness guarantee for live invitations are identical.
--
-- WHAT DELIBERATELY DOES NOT CHANGE. `EXPIRED` and `DECLINED` stay INSIDE the index. `REPLACED` is
-- the only status the replacement path writes, and re-inviting a dealership that declined, or whose
-- invitation expired, is a different decision with a different owner. Widening the exclusion to
-- every terminal state would quietly grant it.
--
-- ORDER. Create the replacement index BEFORE dropping the one it supersedes. Prisma runs a
-- migration inside one transaction, so there is no window in which the table is unprotected, and
-- if the transaction fails partway the original index is still standing.
--
-- LOCKING. `CREATE UNIQUE INDEX` without CONCURRENTLY takes ACCESS EXCLUSIVE on the table.
-- `auction_invitations` holds single digits of rows (see the proof package's census), so the lock
-- is held for microseconds. CONCURRENTLY is not an option here anyway: it cannot run inside a
-- transaction block, and the ordering above is what makes this safe.
--
-- SCHEMA. `schema.prisma` loses `@@unique([auctionId, dealerId])` because the Prisma DSL cannot
-- express a partial index. Both indexes now live only in SQL, the same position the rooftop one has
-- held since the spine migration, and `prisma/drift-baseline.json` carries the enumerated exception.

CREATE UNIQUE INDEX IF NOT EXISTS "auction_invitations_auction_rooftop_active_key"
  ON "auction_invitations" ("auction_id", "rooftop_id")
  WHERE "rooftop_id" IS NOT NULL AND "status" <> 'REPLACED';

DROP INDEX IF EXISTS "auction_invitations_auction_rooftop_key";

CREATE UNIQUE INDEX IF NOT EXISTS "auction_invitations_auction_id_dealer_active_key"
  ON "auction_invitations" ("auction_id", "dealer_id")
  WHERE "dealer_id" IS NOT NULL AND "status" <> 'REPLACED';

DROP INDEX IF EXISTS "auction_invitations_auction_id_dealer_id_key";
