-- ============================================================================
-- AutoLenis Content Ops Platform — Phase 1 Foundation
-- Bulk Article → Enterprise Content Operations Platform
-- ============================================================================
-- Additive + reversible. Extends content_articles with scheduling/approval,
-- indexation, media, and refresh/validation lifecycle fields, and adds the
-- domain ledger tables (versions / generation jobs + items / validation results
-- / media assets / workflow events).
--
-- These ledger tables are OBSERVABILITY + HISTORY records written by the content
-- Inngest functions. They REUSE the existing queue infrastructure from
-- migrations/01_phase1_foundation.sql:
--   - idempotency_keys   (retry idempotency guard)
--   - jobs_dead_letter   (dead-letter on final failure)
-- They do NOT fork a second idempotency table, dead-letter table, or queue
-- runtime. There are no lockedAt/lockedBy/nextRunAt columns — Inngest owns
-- locking/retry/backoff.
--
-- Idempotent: safe to run repeatedly (IF NOT EXISTS / guarded ALTER TYPE).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. content_articles — additive column extensions (WO-1)
-- ----------------------------------------------------------------------------
-- Scheduling / approval. No SCHEDULED enum value is introduced: a scheduled
-- article is status DRAFT|REVIEW_NEEDED with non-null scheduled_at + approved_at,
-- flipped to PUBLISHED by the content-publisher cron. Keeps the public page +
-- sitemap PUBLISHED filters intact.
ALTER TABLE content_articles ADD COLUMN IF NOT EXISTS scheduled_at            TIMESTAMP(3);
ALTER TABLE content_articles ADD COLUMN IF NOT EXISTS approved_at             TIMESTAMP(3);
ALTER TABLE content_articles ADD COLUMN IF NOT EXISTS approved_by_admin_id    TEXT;
ALTER TABLE content_articles ADD COLUMN IF NOT EXISTS last_published_at       TIMESTAMP(3);
ALTER TABLE content_articles ADD COLUMN IF NOT EXISTS publish_failure_reason  TEXT;
ALTER TABLE content_articles ADD COLUMN IF NOT EXISTS publication_version     INTEGER NOT NULL DEFAULT 1;

-- Indexation governance.
ALTER TABLE content_articles ADD COLUMN IF NOT EXISTS canonical_url           TEXT;
ALTER TABLE content_articles ADD COLUMN IF NOT EXISTS noindex                 BOOLEAN NOT NULL DEFAULT false;

-- Featured media.
ALTER TABLE content_articles ADD COLUMN IF NOT EXISTS featured_image_url           TEXT;
ALTER TABLE content_articles ADD COLUMN IF NOT EXISTS featured_image_alt           TEXT;
ALTER TABLE content_articles ADD COLUMN IF NOT EXISTS featured_image_status        TEXT;
ALTER TABLE content_articles ADD COLUMN IF NOT EXISTS featured_image_prompt        TEXT;
ALTER TABLE content_articles ADD COLUMN IF NOT EXISTS featured_image_provider      TEXT;
ALTER TABLE content_articles ADD COLUMN IF NOT EXISTS featured_image_generated_at  TIMESTAMP(3);

-- Refresh / validation lifecycle (ported from AMIPS naming).
ALTER TABLE content_articles ADD COLUMN IF NOT EXISTS lifecycle_status   TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE content_articles ADD COLUMN IF NOT EXISTS refresh_due_at     TIMESTAMP(3);
ALTER TABLE content_articles ADD COLUMN IF NOT EXISTS last_validated_at  TIMESTAMP(3);
ALTER TABLE content_articles ADD COLUMN IF NOT EXISTS last_refreshed_at  TIMESTAMP(3);

-- Backfill safety: existing rows take the column DEFAULTs above. Be explicit so
-- a re-run on partially-migrated data converges.
UPDATE content_articles SET publication_version = 1 WHERE publication_version IS NULL;
UPDATE content_articles SET noindex = false         WHERE noindex IS NULL;
UPDATE content_articles SET lifecycle_status = 'ACTIVE' WHERE lifecycle_status IS NULL;

-- New indexes on content_articles.
CREATE INDEX IF NOT EXISTS content_articles_scheduled_at_idx     ON content_articles(scheduled_at);
CREATE INDEX IF NOT EXISTS content_articles_refresh_due_at_idx   ON content_articles(refresh_due_at);
CREATE INDEX IF NOT EXISTS content_articles_lifecycle_status_idx ON content_articles(lifecycle_status);
CREATE INDEX IF NOT EXISTS content_articles_cluster_status_idx   ON content_articles(cluster, status);
CREATE INDEX IF NOT EXISTS content_articles_metro_status_idx     ON content_articles(metro, status);
CREATE INDEX IF NOT EXISTS content_articles_noindex_idx          ON content_articles(noindex);

-- ----------------------------------------------------------------------------
-- 2. ContentJobStatus enum (guarded — CREATE TYPE has no IF NOT EXISTS)
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "ContentJobStatus" AS ENUM ('QUEUED','PROCESSING','SUCCEEDED','FAILED','CANCELED','PAUSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- 3. content_article_versions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_article_versions (
  id                     TEXT PRIMARY KEY,
  article_id             TEXT NOT NULL REFERENCES content_articles(id) ON DELETE CASCADE,
  version_number         INTEGER NOT NULL,
  title                  TEXT NOT NULL,
  h1                     TEXT NOT NULL,
  meta_description       TEXT NOT NULL,
  body                   TEXT NOT NULL,
  faq_json               TEXT,
  quality_score          INTEGER,
  compliance_result_json TEXT,
  generated_by_model     TEXT,
  created_by_admin_id    TEXT,
  created_by_job_id      TEXT,
  change_reason          TEXT,
  created_at             TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS content_article_versions_article_version_key
  ON content_article_versions(article_id, version_number);
CREATE INDEX IF NOT EXISTS content_article_versions_article_version_idx
  ON content_article_versions(article_id, version_number);

-- ----------------------------------------------------------------------------
-- 4. content_generation_jobs + content_generation_job_items
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_generation_jobs (
  id                  TEXT PRIMARY KEY,
  status              "ContentJobStatus" NOT NULL DEFAULT 'QUEUED',
  job_type            TEXT NOT NULL,
  total_items         INTEGER NOT NULL DEFAULT 0,
  succeeded_items     INTEGER NOT NULL DEFAULT 0,
  failed_items        INTEGER NOT NULL DEFAULT 0,
  created_by_admin_id TEXT,
  filter_json         TEXT,
  last_error          TEXT,
  started_at          TIMESTAMP(3),
  completed_at        TIMESTAMP(3),
  created_at          TIMESTAMP(3) NOT NULL DEFAULT now(),
  updated_at          TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_generation_jobs_status_idx   ON content_generation_jobs(status);
CREATE INDEX IF NOT EXISTS content_generation_jobs_job_type_idx ON content_generation_jobs(job_type);
CREATE INDEX IF NOT EXISTS content_generation_jobs_created_at_idx ON content_generation_jobs(created_at);

CREATE TABLE IF NOT EXISTS content_generation_job_items (
  id              TEXT PRIMARY KEY,
  job_id          TEXT NOT NULL REFERENCES content_generation_jobs(id) ON DELETE CASCADE,
  status          "ContentJobStatus" NOT NULL DEFAULT 'QUEUED',
  attempt_count   INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  idempotency_key TEXT NOT NULL,
  inngest_run_id  TEXT,
  article_id      TEXT REFERENCES content_articles(id) ON DELETE SET NULL,
  target_slug     TEXT,
  payload_json    TEXT,
  created_at      TIMESTAMP(3) NOT NULL DEFAULT now(),
  updated_at      TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_generation_job_items_job_status_idx ON content_generation_job_items(job_id, status);
CREATE INDEX IF NOT EXISTS content_generation_job_items_status_idx     ON content_generation_job_items(status);
CREATE INDEX IF NOT EXISTS content_generation_job_items_article_idx    ON content_generation_job_items(article_id);
CREATE INDEX IF NOT EXISTS content_generation_job_items_idem_idx       ON content_generation_job_items(idempotency_key);

-- ----------------------------------------------------------------------------
-- 5. content_validation_results
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_validation_results (
  id                    TEXT PRIMARY KEY,
  article_id            TEXT NOT NULL REFERENCES content_articles(id) ON DELETE CASCADE,
  check_results_json    TEXT NOT NULL,
  passed                BOOLEAN NOT NULL DEFAULT false,
  overridden_by_admin_id TEXT,
  override_reason       TEXT,
  created_at            TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_validation_results_article_idx         ON content_validation_results(article_id);
CREATE INDEX IF NOT EXISTS content_validation_results_article_created_idx ON content_validation_results(article_id, created_at);

-- ----------------------------------------------------------------------------
-- 6. content_media_assets
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_media_assets (
  id         TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES content_articles(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  alt        TEXT,
  provider   TEXT,
  status     TEXT NOT NULL DEFAULT 'PENDING',
  width      INTEGER,
  height     INTEGER,
  bytes      INTEGER,
  prompt     TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_media_assets_article_idx ON content_media_assets(article_id);
CREATE INDEX IF NOT EXISTS content_media_assets_status_idx  ON content_media_assets(status);

-- ----------------------------------------------------------------------------
-- 7. content_workflow_events
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_workflow_events (
  id           TEXT PRIMARY KEY,
  article_id   TEXT REFERENCES content_articles(id) ON DELETE SET NULL,
  job_id       TEXT,
  event_type   TEXT NOT NULL,
  actor        TEXT NOT NULL,
  payload_json TEXT,
  created_at   TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_workflow_events_article_idx    ON content_workflow_events(article_id);
CREATE INDEX IF NOT EXISTS content_workflow_events_job_idx        ON content_workflow_events(job_id);
CREATE INDEX IF NOT EXISTS content_workflow_events_event_type_idx ON content_workflow_events(event_type);
CREATE INDEX IF NOT EXISTS content_workflow_events_created_at_idx ON content_workflow_events(created_at);

COMMIT;

-- ============================================================================
-- ROLLBACK (manual, destructive — run only to fully revert this migration):
-- ----------------------------------------------------------------------------
-- BEGIN;
-- DROP TABLE IF EXISTS content_workflow_events;
-- DROP TABLE IF EXISTS content_media_assets;
-- DROP TABLE IF EXISTS content_validation_results;
-- DROP TABLE IF EXISTS content_generation_job_items;
-- DROP TABLE IF EXISTS content_generation_jobs;
-- DROP TABLE IF EXISTS content_article_versions;
-- DROP TYPE  IF EXISTS "ContentJobStatus";
-- ALTER TABLE content_articles
--   DROP COLUMN IF EXISTS scheduled_at, DROP COLUMN IF EXISTS approved_at,
--   DROP COLUMN IF EXISTS approved_by_admin_id, DROP COLUMN IF EXISTS last_published_at,
--   DROP COLUMN IF EXISTS publish_failure_reason, DROP COLUMN IF EXISTS publication_version,
--   DROP COLUMN IF EXISTS canonical_url, DROP COLUMN IF EXISTS noindex,
--   DROP COLUMN IF EXISTS featured_image_url, DROP COLUMN IF EXISTS featured_image_alt,
--   DROP COLUMN IF EXISTS featured_image_status, DROP COLUMN IF EXISTS featured_image_prompt,
--   DROP COLUMN IF EXISTS featured_image_provider, DROP COLUMN IF EXISTS featured_image_generated_at,
--   DROP COLUMN IF EXISTS lifecycle_status, DROP COLUMN IF EXISTS refresh_due_at,
--   DROP COLUMN IF EXISTS last_validated_at, DROP COLUMN IF EXISTS last_refreshed_at;
-- COMMIT;
-- ============================================================================
