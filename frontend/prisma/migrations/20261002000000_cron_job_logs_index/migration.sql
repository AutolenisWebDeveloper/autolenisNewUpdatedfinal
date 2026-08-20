-- D3a — cron observability: index cron_job_logs for dead-cron detection.
--
-- Additive + idempotent. Dead-cron detection groups by cron_name and reads the
-- latest started_at per cron; the ops widget and the retention purge also scan by
-- these columns. As cron_job_logs grows (every wired cron writes a run row every
-- few minutes), an unindexed groupBy/scan degrades — this composite index keeps it
-- fast. Uses IF NOT EXISTS so re-applying is a no-op.
--
-- ⚠️ REQUIRED PRE-LIVE STEP: apply to production with `prisma migrate deploy`.
--    The Vercel build does NOT run migrations.
--
-- NOTE: created NON-CONCURRENTLY (inside Prisma's migration transaction). The
-- table is small at deploy time and the write path (withCronRun) tolerates the
-- brief lock; a CONCURRENTLY build would have to run outside a transaction.
--
-- Rollback:
--   DROP INDEX IF EXISTS "cron_job_logs_cron_name_started_at_idx";

CREATE INDEX IF NOT EXISTS "cron_job_logs_cron_name_started_at_idx"
  ON "cron_job_logs"("cron_name", "started_at");
