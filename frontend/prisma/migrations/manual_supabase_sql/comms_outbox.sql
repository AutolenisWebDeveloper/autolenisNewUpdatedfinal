-- Internal comms-dispatch queue (Inngest email.send / sms.send retirement).
--
-- PRODUCTION CUTOVER REQUIRES applying this SQL to Supabase — OWNER-GATED.
-- (comms_outbox is a Supabase-managed table; raw Supabase migration, not
--  `prisma migrate deploy`.) Branch-only, additive, idempotent — safe to run
--  multiple times; a no-op once applied.
--
-- WHY: the Inngest `emailSendFn` / `smsSendFn` workers are the central comms
-- dispatchers. Retiring Inngest requires an internal durable send queue. This
-- table IS that queue: producers INSERT a row (ON CONFLICT (dedup_key) DO
-- NOTHING) and the `comms-outbox-drain` Vercel Cron claims + delivers each row,
-- reproducing every consent/DNC/suppression/TCPA gate the workers applied.
--
-- HARD INVARIANT — zero duplicate production comms:
--   • dedup_key is UNIQUE → a retried/duplicate emit (dup-event, dup-cron,
--     producer retry) inserts nothing: the message is enqueued AT MOST ONCE.
--   • the drain claims each row with a status compare-and-set (pending →
--     sending), so exactly one drain delivers it.
--   • terminal FAILED is COLUMNS-ONLY (status='failed') — nothing to
--     jobs_dead_letter, so the Inngest DLQ drainer can never re-emit a comms job.

CREATE TABLE IF NOT EXISTS comms_outbox (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  channel     text        NOT NULL CHECK (channel IN ('email','sms')),
  -- The idempotency identity. Equal to the producer's idempotencyKey when given,
  -- else derived (recipient + kind + day) exactly as the retired workers derived it.
  dedup_key   text        NOT NULL,
  status      text        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','sending','sent','failed','suppressed','skipped')),
  payload     jsonb       NOT NULL,
  attempts    int         NOT NULL DEFAULT 0,
  last_error  text,
  -- Typed delivery outcome for observability (SUCCESS / SUPPRESSED / GATED /
  -- CONSENT_GATED / TCPA_GATED / INVALID_PHONE / DUPLICATE / FAILED).
  last_result text,
  provider_id text,       -- Resend id / Twilio sid
  run_at      timestamptz NOT NULL DEFAULT now(),  -- delay support (send at/after)
  claimed_at  timestamptz,                         -- stale-claim reclaim cursor
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- The HARD dedup: at most one outbox row per logical message.
CREATE UNIQUE INDEX IF NOT EXISTS uq_comms_outbox_dedup_key ON comms_outbox (dedup_key);

-- Drain hot-path: due, not-yet-terminal rows.
CREATE INDEX IF NOT EXISTS idx_comms_outbox_drain
  ON comms_outbox (run_at)
  WHERE status IN ('pending','sending');

-- Verification:
--   SELECT to_regclass('public.comms_outbox');            -- expect: comms_outbox
--   SELECT indexname FROM pg_indexes WHERE tablename='comms_outbox';
