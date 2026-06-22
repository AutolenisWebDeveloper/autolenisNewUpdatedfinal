-- Migration: add_dlq_auto_retry_count
-- F-035 — bound the automated dead-letter drainer so a poison job cannot
-- hot-loop. auto_retry_count caps how many times the drain cron will
-- automatically re-emit a given DLQ row before leaving it for manual review.
-- Idempotent.

DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'jobs_dead_letter')) IS NOT NULL THEN
    ALTER TABLE "jobs_dead_letter" ADD COLUMN IF NOT EXISTS "auto_retry_count" INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;
