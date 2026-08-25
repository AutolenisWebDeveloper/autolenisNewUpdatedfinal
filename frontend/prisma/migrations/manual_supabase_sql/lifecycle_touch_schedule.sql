-- Lifecycle communications scheduler — internal parity for the 12 deferred
-- QStash lifecycle-notification jobs (deposit-reminder, auction-active/-midpoint/
-- -closing, dealer-invited, offer-received, offer-follow-up, deal-complete,
-- form-submitted, check-form-completion, review-request). Consolidated,
-- sequence-discriminated (the SAME multi-sequence shape as
-- outreach_touch_schedule / lead_nurture_schedule), NOT a generalized queue: it
-- holds exactly the fixed lifecycle touches enumerated in the CHECK below.
--
-- PRODUCTION CUTOVER REQUIRES applying this SQL to Supabase — OWNER-GATED.
-- (Raw Supabase migration, not `prisma migrate deploy`.) Additive, idempotent.
--
-- DORMANT until the owner-gated atomic cutover: this table has NO producer yet.
-- Every lifecycle touch is still dispatched to QStash from its existing producer
-- (the Stripe webhook, dealer-invitation.service, dealer/offers, request-vehicle,
-- buyer/deposit, admin pickup-complete, and the intra-chain job routes). The
-- cutover swaps each `dispatch()` for `enqueueLifecycleTouch(...)` and retires the
-- QStash route — one authority at all times, never both. The
-- `lifecycle-touch-drain` cron runs now but no-ops (NO_DUE / NO_TABLE) while this
-- table is empty/absent, so deploying this code before cutover is safe.
--
-- Parity notes vs the QStash jobs:
--   • Message bodies are ported VERBATIM from app/api/jobs/<name>/route.ts so
--     cutover is behaviour-neutral.
--   • Conversion guards (hasPaidDeposit / hasSelectedOffer) are re-checked at
--     drain time, exactly as the QStash jobs re-read state on each delivery — a
--     converted buyer is marked 'canceled' (no send, no chain), never chased.
--   • FIX: `auction_closing` gains the `hasSelectedOffer` guard the QStash
--     `auction-closing` job was missing (it sent unconditionally).
--   • CONSOLIDATION: `dealer_invited` does NOT chain a bid reminder here — the
--     existing endsAt-driven, idempotent `cron/dealer-invitation-reminder`
--     already nudges non-bidding invited dealers, so QStash `dealer-bid-reminder`
--     is retired at cutover rather than ported.
--   • COUPLED CUTOVER: `review_request`, on send, enqueues the day-60 refinance
--     outreach (`refinance_outreach_schedule`) and the day-27 referral nudge
--     (`outreach_touch_schedule`) — replacing the two QStash `dispatch()` calls in
--     the review-request job with the dormant internal enqueue functions.
--
-- Improvement over the QStash jobs (which have NO message-level dedup and
-- double-send on a producer/redelivery retry): UNIQUE(base_key, sequence) makes
-- each touch enqueue-once; a terminal failure is COLUMNS-ONLY (status='failed') —
-- nothing to jobs_dead_letter, so neither the QStash re-publish nor the Inngest
-- re-emit DLQ branch can resurrect a touch.

CREATE TABLE IF NOT EXISTS lifecycle_touch_schedule (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stable per-enrollment key (e.g. `deposit-reminder:{buyerId}`,
  -- `auction:{auctionId}`, `dealer-invited:{auctionId}:{dealerId}`); the chain
  -- reuses it across the sequence's touches.
  base_key       text        NOT NULL,
  sequence       text        NOT NULL
                             CHECK (sequence IN (
                               'deposit_reminder_1','deposit_reminder_2','deposit_reminder_3',
                               'auction_active','auction_midpoint','auction_closing',
                               'dealer_invited',
                               'offer_received','offer_follow_up_1','offer_follow_up_2',
                               'deal_complete','review_request',
                               'form_submitted','check_form_completion_1','check_form_completion_2','check_form_completion_3'
                             )),
  entity_id      text        NOT NULL,
  first_name     text,
  email          text        NOT NULL,
  -- Optional SMS fallback target (form_submitted seeds a buyer who may not yet
  -- have a resolvable contact phone); notifyContact resolves by entity_id first.
  phone          text,
  run_at         timestamptz NOT NULL,
  status         text        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','sending','done','canceled','failed')),
  attempts       int         NOT NULL DEFAULT 0,
  last_error     text,
  claimed_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Enqueue-once per (enrollment, sequence).
CREATE UNIQUE INDEX IF NOT EXISTS uq_lifecycle_touch_key_sequence
  ON lifecycle_touch_schedule (base_key, sequence);

-- Drain hot-path: due, not-yet-terminal touches.
CREATE INDEX IF NOT EXISTS idx_lifecycle_touch_due
  ON lifecycle_touch_schedule (run_at)
  WHERE status IN ('pending','sending');

-- Verification:
--   SELECT to_regclass('public.lifecycle_touch_schedule');
