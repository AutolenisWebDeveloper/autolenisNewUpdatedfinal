-- Refinance-outreach durable single-touch scheduler — internal parity for the
-- QStash `/api/jobs/refinance-outreach` job (NON-deal-path QStash retirement,
-- reference implementation of the non-deal set).
--
-- PRODUCTION CUTOVER REQUIRES applying this SQL to Supabase — OWNER-GATED.
-- (Raw Supabase migration, not `prisma migrate deploy`.) Additive, idempotent.
--
-- DORMANT until the owner-gated atomic cutover: this table has NO producer yet.
-- The refinance-outreach touch is still enqueued to QStash from the
-- `review-request` job (`dispatch({ path:'/api/jobs/refinance-outreach',
-- delaySeconds: 5184000 })`, ~60 days). The cutover swaps that single call for
-- `enqueueRefinanceOutreach({ ..., runAt: now + 60d })` and retires the QStash
-- route — one authority at all times (QStash today, the cron after cutover),
-- never both. The `refinance-outreach-drain` cron already runs but no-ops
-- (NO_DUE / NO_TABLE) while this table is empty/absent, so deploying the code
-- before the cutover is safe.
--
-- WHY internal parity is safe here: the QStash job is already fully idempotent
-- via a `BuyerActivityEvent` (REFINANCE_EMAIL_SENT / REFINANCE_LINK_CLICKED)
-- send-guard, and it mutates NO money/deal state — it only sends one
-- consent-gated notification. The internal drain re-checks the SAME guards
-- (completed-purchase count + BuyerActivityEvent) at send time and sends through
-- the SAME `notifyContact` layer (TCPA/suppression gated), so parity is exact.
--
-- Improvements over the QStash job: (1) enqueue-once via UNIQUE(dedup_key)
-- closes the "review-request fires twice → two dispatches" gap; (2) a terminal
-- failure is COLUMNS-ONLY (status='failed') — nothing to jobs_dead_letter, so
-- neither the QStash re-publish nor the Inngest re-emit DLQ branch can resurrect
-- a refinance touch.

CREATE TABLE IF NOT EXISTS refinance_outreach_schedule (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id       text        NOT NULL,
  first_name     text,
  email          text        NOT NULL,
  lead_id        text        NOT NULL,
  -- Enqueue-once key (one refinance touch per buyer): `refinance-outreach:{buyerId}`.
  dedup_key      text        NOT NULL,
  run_at         timestamptz NOT NULL,
  status         text        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','sending','done','skipped','failed')),
  attempts       int         NOT NULL DEFAULT 0,
  last_error     text,
  claimed_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Enqueue-once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_refinance_outreach_dedup
  ON refinance_outreach_schedule (dedup_key);

-- Drain hot-path: due, not-yet-terminal touches.
CREATE INDEX IF NOT EXISTS idx_refinance_outreach_due
  ON refinance_outreach_schedule (run_at)
  WHERE status IN ('pending','sending');

-- Verification:
--   SELECT to_regclass('public.refinance_outreach_schedule');
