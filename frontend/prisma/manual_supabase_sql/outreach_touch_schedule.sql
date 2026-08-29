-- Non-deal outreach touch scheduler — internal parity for the NON-deal-path
-- QStash notification jobs `referral-nudge`, `affiliate-inactive`, and
-- `affiliate-reengagement-2` (QStash non-deal retirement). Consolidated,
-- sequence-discriminated (the same multi-sequence shape as lead_nurture_schedule),
-- NOT a generalized queue: it holds exactly these three fixed marketing touches.
--
-- PRODUCTION CUTOVER REQUIRES applying this SQL to Supabase — OWNER-GATED.
-- (Raw Supabase migration, not `prisma migrate deploy`.) Additive, idempotent.
--
-- DORMANT until the owner-gated atomic cutover: this table has NO producer yet.
--   • affiliate_inactive is still dispatched to QStash from the
--     `cron/affiliate-inactive` Vercel cron (with the recent-activity + weekly
--     `lastInactiveNudgeAt` guard UNCHANGED — that guard stays on the producer);
--     the QStash `affiliate-inactive` job then chains `affiliate-reengagement-2`.
--   • referral_nudge is still dispatched to QStash from the `review-request` job.
-- The cutover swaps those `dispatch()` calls for `enqueueOutreachTouch(...)` and
-- retires the QStash routes — one authority at all times, never both. The
-- `outreach-touch-drain` cron runs now but no-ops (NO_DUE / NO_TABLE) while this
-- table is empty/absent, so deploying the code before cutover is safe.
--
-- WHY these three are safe to migrate here: each is a pure consent-gated
-- notification with NO money/deal/auction/offer/deposit state read or write. They
-- send through the SAME `notifyContact` layer (TCPA/DNC/suppression/STOP gated).
--
-- Improvement over the QStash jobs (which have NO message-level dedup and
-- double-send on a retry): UNIQUE(base_key, sequence) makes each touch
-- enqueue-once; a terminal failure is COLUMNS-ONLY (status='failed') — nothing to
-- jobs_dead_letter, so neither the QStash re-publish nor the Inngest re-emit DLQ
-- branch can resurrect a touch.

CREATE TABLE IF NOT EXISTS outreach_touch_schedule (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stable per-enrollment key (e.g. `affiliate-nudge:{affiliateId}:{date}` /
  -- `referral-nudge:{buyerId}:{date}`); the chain reuses it across sequences.
  base_key       text        NOT NULL,
  sequence       text        NOT NULL
                             CHECK (sequence IN ('affiliate_inactive','affiliate_reengagement_2','referral_nudge')),
  entity_id      text        NOT NULL,
  first_name     text,
  email          text        NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS uq_outreach_touch_key_sequence
  ON outreach_touch_schedule (base_key, sequence);

-- Drain hot-path: due, not-yet-terminal touches.
CREATE INDEX IF NOT EXISTS idx_outreach_touch_due
  ON outreach_touch_schedule (run_at)
  WHERE status IN ('pending','sending');

-- Verification:
--   SELECT to_regclass('public.outreach_touch_schedule');
