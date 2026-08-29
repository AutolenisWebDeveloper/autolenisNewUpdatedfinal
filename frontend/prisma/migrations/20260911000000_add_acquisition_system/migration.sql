-- Migration: add_acquisition_system
-- Adds AI buyer acquisition surface area:
--   1. Buyer lead-scoring + SMS opt-out fields
--   2. Conversation, LeadScore, SmsOptOut tables backing the
--      conversational vehicle finder and Twilio inbound webhook
-- IF NOT EXISTS guards keep this migration idempotent for envs where
-- partial rollouts may have introduced columns out of band.

ALTER TABLE "buyers"
  ADD COLUMN IF NOT EXISTS "lead_score"       INTEGER,
  ADD COLUMN IF NOT EXISTS "lead_temperature" TEXT,
  ADD COLUMN IF NOT EXISTS "sequence_paused"  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "opted_out_sms"    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "timezone"         TEXT;

-- NAME CORRECTION (Batch 7): this block originally created its table under the
-- bare name "conversations". The Conversation model maps to
-- "acquisition_conversations" (schema.prisma @@map), which
-- 20260423999999_baseline_manual_provisioned_tables already creates together
-- with its session_id unique index — so the bare table was an orphan no model
-- or code path ever touched on a chain-built database. Worse, it squatted on
-- the name the CRM provisioning runbook (frontend/migrations/01) needs for the
-- live admin-CRM inbox table, which made 14 of the 15 documented provisioning
-- files fail on a fresh database. In production, where the CRM table existed
-- first, the CREATE below silently no-opped — so this rewrite changes nothing
-- there. What this block still owns is the buyer foreign key the model
-- declares; it now targets the real table.

DO $$
BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'acquisition_conversations')) IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint WHERE conname = 'acquisition_conversations_buyer_id_fkey'
     ) THEN
    ALTER TABLE "acquisition_conversations"
      ADD CONSTRAINT "acquisition_conversations_buyer_id_fkey"
      FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "lead_scores" (
  "id"          TEXT NOT NULL,
  "buyer_id"    TEXT,
  "session_id"  TEXT,
  "score"       INTEGER NOT NULL,
  "temperature" TEXT NOT NULL,
  "signals"     JSONB NOT NULL,
  "reasoning"   TEXT NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_scores_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sms_opt_outs" (
  "id"         TEXT NOT NULL,
  "phone"      TEXT NOT NULL,
  "reason"     TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sms_opt_outs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "sms_opt_outs_phone_key"
  ON "sms_opt_outs"("phone");
