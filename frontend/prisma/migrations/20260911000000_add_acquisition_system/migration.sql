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

CREATE TABLE IF NOT EXISTS "conversations" (
  "id"             TEXT NOT NULL,
  "session_id"     TEXT NOT NULL,
  "buyer_id"       TEXT,
  "transcript"     JSONB NOT NULL DEFAULT '[]',
  "completed"      BOOLEAN NOT NULL DEFAULT false,
  "extracted_data" JSONB,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "conversations_session_id_key"
  ON "conversations"("session_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversations_buyer_id_fkey'
  ) THEN
    ALTER TABLE "conversations"
      ADD CONSTRAINT "conversations_buyer_id_fkey"
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
