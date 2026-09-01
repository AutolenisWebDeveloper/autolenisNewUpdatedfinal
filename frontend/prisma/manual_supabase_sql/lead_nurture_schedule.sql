-- LP lead-nurture durable multi-touch scheduler (Inngest form_abandoned /
-- exit_intent_captured retirement).
--
-- PRODUCTION CUTOVER REQUIRES applying this SQL to Supabase — OWNER-GATED.
-- (Raw Supabase migration, not `prisma migrate deploy`.) Additive, idempotent.
--
-- WHY: the LP form-abandonment (3-touch) and exit-intent (1-touch) sequences used
-- Inngest's step.sleep for the inter-touch delays (1h → 23h → 72h; 30m). To retire
-- Inngest, each touch is now a durable row: `run_at` holds WHEN the touch fires,
-- and the `lead-nurture-drain` Vercel Cron sends the due touch (re-checking the
-- lead's completion + suppression) and schedules the NEXT touch — DB-scheduled
-- state, no Inngest, no setTimeout.
--
-- Zero duplicate touches: UNIQUE(idempotency_key, step) makes scheduling a touch
-- enqueue-once; the touch email itself carries the outbox dedup_key
-- `${idempotency_key}-touch{N}` / `-recovery`, so even an overlapping re-drive
-- never double-sends.

CREATE TABLE IF NOT EXISTS lead_nurture_schedule (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence       text        NOT NULL CHECK (sequence IN ('form_abandonment','exit_intent')),
  step           int         NOT NULL,
  contact_id     text        NOT NULL,
  contact_email  text        NOT NULL,
  first_name     text,
  campaign       text,
  -- Base key from the emitter; the touch's outbox dedup_key derives from it.
  idempotency_key text       NOT NULL,
  run_at         timestamptz NOT NULL,
  status         text        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','sending','done','canceled','failed')),
  attempts       int         NOT NULL DEFAULT 0,
  last_error     text,
  claimed_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Enqueue-once per touch.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_nurture_key_step
  ON lead_nurture_schedule (idempotency_key, step);

-- Drain hot-path: due, not-yet-terminal touches.
CREATE INDEX IF NOT EXISTS idx_lead_nurture_due
  ON lead_nurture_schedule (run_at)
  WHERE status IN ('pending','sending');

-- Verification:
--   SELECT to_regclass('public.lead_nurture_schedule');
