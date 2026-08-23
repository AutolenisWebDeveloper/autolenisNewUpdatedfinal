-- Dealer-award dispatch durable marker (Inngest dealer.award retirement).
--
-- Additive + defensive (IF NOT EXISTS, nullable → no destructive op). Production's
-- Prisma ledger is known to drift from the repo, so the guard makes this safe to
-- apply even if the column was added out of band.
--
-- dealer_award_dispatched_at — NULL until the internal dealer-award-dispatch cron
--   dispatches the winner-award + non-award close-outs for an offer-accepted deal,
--   then stamped so it is never re-dispatched.
ALTER TABLE "deals"
  ADD COLUMN IF NOT EXISTS "dealer_award_dispatched_at" TIMESTAMP(3);

-- Bounded-retry counter: at MAX the drain stamps the marker terminal and leaves
-- this >= MAX as a queryable recovery handle for a still-undelivered award (no
-- silent 7-day retry loop, no jobs_dead_letter re-emit loop).
ALTER TABLE "deals"
  ADD COLUMN IF NOT EXISTS "dealer_award_attempts" INTEGER NOT NULL DEFAULT 0;

-- HISTORICAL SAFETY: mark every EXISTING offer-accepted deal as already-dispatched
-- so the cron can NEVER mass-notify dealers about historical auctions on first run.
-- Only NEW acceptances (created after this migration) will have a NULL marker.
-- Idempotent: re-running only affects rows still NULL.
UPDATE "deals"
  SET "dealer_award_dispatched_at" = "created_at"
  WHERE "dealer_award_dispatched_at" IS NULL
    AND "offer_id" IS NOT NULL;
