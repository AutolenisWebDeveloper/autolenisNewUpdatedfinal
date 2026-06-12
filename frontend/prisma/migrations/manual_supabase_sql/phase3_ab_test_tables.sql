-- Phase 3 — A/B Testing tables.
-- Run this in the Supabase SQL editor after merging. Idempotent.

CREATE TABLE IF NOT EXISTS ab_test_groups (
  id            TEXT        NOT NULL PRIMARY KEY,
  name          TEXT        NOT NULL,
  platform      TEXT        NOT NULL,
  franchise_slug TEXT       NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'RUNNING',
  winner_id     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ab_test_groups_platform_status_idx
  ON ab_test_groups(platform, status);

CREATE TABLE IF NOT EXISTS ab_test_variants (
  id            TEXT        NOT NULL PRIMARY KEY,
  group_id      TEXT        NOT NULL REFERENCES ab_test_groups(id) ON DELETE CASCADE,
  post_id       TEXT        NOT NULL,
  hook_type     TEXT        NOT NULL,
  hook          TEXT        NOT NULL,
  variant_label TEXT        NOT NULL,
  is_winner     BOOLEAN     NOT NULL DEFAULT false,
  score         FLOAT       NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ab_test_variants_group_post_idx
  ON ab_test_variants(group_id, post_id);
