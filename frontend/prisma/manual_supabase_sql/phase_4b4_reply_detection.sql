-- AutoLenis Phase 4B-4 — Reply Detection + Follow-Up Sequencing
--
-- Adds multi-touch follow-up bookkeeping to dealer_outreach_log and
-- reply/pause tracking to dealer_prospects. The follow-up cron uses these
-- columns to decide who is due for a nudge and to stop the cadence once a
-- dealer replies, bounces, or opts out.
--
-- Run in the Supabase SQL editor. Safe to re-run (all statements are guarded).

-- dealer_outreach_log: track which step of the sequence each row represents.
ALTER TABLE dealer_outreach_log
  ADD COLUMN IF NOT EXISTS outreach_sequence_step INTEGER DEFAULT 1;
ALTER TABLE dealer_outreach_log
  ADD COLUMN IF NOT EXISTS follow_up_scheduled_at TIMESTAMP;
ALTER TABLE dealer_outreach_log
  ADD COLUMN IF NOT EXISTS reply_detected_at TIMESTAMP;

-- dealer_prospects: reply detection + sequence pause state.
ALTER TABLE dealer_prospects
  ADD COLUMN IF NOT EXISTS reply_detected_at TIMESTAMP;
ALTER TABLE dealer_prospects
  ADD COLUMN IF NOT EXISTS sequence_paused_at TIMESTAMP;
ALTER TABLE dealer_prospects
  ADD COLUMN IF NOT EXISTS sequence_pause_reason TEXT;

CREATE INDEX IF NOT EXISTS outreach_log_sequence_step_idx
  ON dealer_outreach_log (outreach_sequence_step);
CREATE INDEX IF NOT EXISTS dealer_prospects_reply_idx
  ON dealer_prospects (reply_detected_at)
  WHERE reply_detected_at IS NOT NULL;

-- Backfill: existing rows predate the column and should count as step 1.
UPDATE dealer_outreach_log
  SET outreach_sequence_step = 1
  WHERE outreach_sequence_step IS NULL;
