-- Phase 10 — the two words §24's cancellation orchestration had no way to say.
--
-- STATUS: AUTHORED, NOT APPLIED. Applying it is the owner's, per run, under CLAUDE.md's
-- production-database protocol. §13-D14 is UNSATISFIED as of 2026-09-17, so this phase deletes
-- nothing; these are additions.
--
-- THE GAP. §24 requires that a cancellation "stops unsent sourcing and outreach, closes auction
-- activity, notifies affected dealerships, voids unsigned envelopes, cancels pickup and revokes
-- release tokens". Two of those have no vocabulary to record the result:
--
--   · `AuctionInvitationStatus` had QUEUED, SENT, DELIVERED, OPENED, BOUNCED, DECLINED,
--     RESPONDED, OFFER_SUBMITTED, EXPIRED, REPLACED — every one of which describes something
--     the DEALERSHIP did, or time passing. None says "AutoLenis withdrew this". EXPIRED was the
--     nearest, and it would have been a lie: an invitation withdrawn because the buyer cancelled
--     did not run out of time, and a dealership reading its own history would see a deadline it
--     never missed.
--
--   · `PickupStatus` had NOT_SCHEDULED, PROPOSED, DEALER_COUNTERED, SCHEDULED, CHECKED_IN,
--     COMPLETED, RESCHEDULED, EXCEPTION, NO_SHOW, RELEASED. Same problem: reverting a cancelled
--     appointment to NOT_SCHEDULED would erase the fact that one existed, and RESCHEDULED claims
--     another is coming.
--
-- WHY THIS IS ITS OWN DIRECTORY, adding labels and nothing else. PostgreSQL refuses to USE an
-- enum label inside the transaction that added it, and Prisma wraps each migration file in one
-- transaction. The Phase 1 wave split for exactly this reason (20261106000000, its header), and
-- the same constraint applies to anything later that writes these values. Nothing here reads
-- them; the code that does ships behind this migration.
--
-- IDEMPOTENT: ADD VALUE IF NOT EXISTS is a no-op on re-apply. Enum labels are append-only and no
-- rollback removes them — reverting the Phase 10 commit leaves two unused labels, which is inert.

-- ── §24: an invitation AutoLenis withdrew ───────────────────────────────────────────────────────
ALTER TYPE "AuctionInvitationStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- ── §24: "pickup cancelled and release tokens revoked" ──────────────────────────────────────────
ALTER TYPE "PickupStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
