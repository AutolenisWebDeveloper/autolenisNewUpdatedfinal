-- Migration: add_affiliate_inactive_nudge
-- Adds a timestamp tracking the last time an affiliate was sent the
-- inactivity re-engagement nudge, so the weekly cron does not re-dispatch
-- the same affiliate every run.
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'affiliates')) IS NOT NULL THEN
    ALTER TABLE "affiliates" ADD COLUMN IF NOT EXISTS "last_inactive_nudge_at" TIMESTAMP(3);
  END IF;
END $$;
