-- =====================================================
-- AutoLenis — AI Media Generation tracking table.
--
-- One row per Higgsfield (or future provider) media-generation job. Captures
-- the full input payload, lifecycle status, and resolved output URLs, keyed by
-- the provider request id for webhook/poll reconciliation.
--
-- Run this in the Supabase SQL Editor.
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- Mirrors prisma/schema.prisma (model AiMediaGeneration) exactly.
-- =====================================================

CREATE TABLE IF NOT EXISTS ai_media_generations (
  id                    TEXT        NOT NULL PRIMARY KEY,
  provider              TEXT        NOT NULL DEFAULT 'higgsfield',
  endpoint              TEXT        NOT NULL,
  generation_type       TEXT        NOT NULL,
  prompt                TEXT        NOT NULL,
  input_images          JSONB,
  input_audio           JSONB,
  input_payload         JSONB       NOT NULL DEFAULT '{}',
  higgsfield_request_id TEXT        UNIQUE,
  status                TEXT        NOT NULL DEFAULT 'queued',
  status_url            TEXT,
  cancel_url            TEXT,
  output_images         JSONB,
  output_video_url      TEXT,
  output_raw            JSONB,
  error_message         TEXT,
  nsfw_flagged          BOOLEAN     NOT NULL DEFAULT false,
  created_by_id         TEXT,
  vehicle_id            TEXT,
  article_id            TEXT,
  social_post_id        TEXT,
  campaign_id           TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ai_media_gen_status_idx
  ON ai_media_generations(status);
CREATE INDEX IF NOT EXISTS ai_media_gen_post_id_idx
  ON ai_media_generations(social_post_id);
CREATE INDEX IF NOT EXISTS ai_media_gen_request_id_idx
  ON ai_media_generations(higgsfield_request_id);
