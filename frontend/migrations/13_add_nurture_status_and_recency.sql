-- migrations/13_add_nurture_status_and_recency.sql
-- PHASE B (nurture_status mirror) + PHASE A support (recency signal).
-- Idempotent. Pattern matches existing migrations (IF NOT EXISTS, CHECK, partial index).
-- Grounding: contacts table defined in 01_phase1_foundation.sql:22; this only ADDS columns.

BEGIN;

-- nurture_status mirrors Make enrollment state so reconciliation + the coverage
-- dashboard are pure app SQL (no Make read on the request path). Default 'none'
-- = the contact is NOT in any active campaign and NOT in re-engagement, i.e. the
-- NLLB ("no lead left behind") candidate state the sweep targets.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS nurture_status TEXT NOT NULL DEFAULT 'none'
    CHECK (nurture_status IN ('none', 'active', 'suppressed', 'reengagement'));

-- last_contacted_at: stamped by the dispatch rail on a verified send. Used by the
-- reconcile sweep to find dormant-but-uncovered contacts. NULL = never contacted.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ DEFAULT NULL;

-- Coverage/sweep index: the NLLB query filters on (nurture_status, do_not_contact,
-- deleted_at, last_contacted_at). Partial on live, contactable rows only.
CREATE INDEX IF NOT EXISTS idx_contacts_nurture_coverage
  ON contacts (nurture_status, last_contacted_at)
  WHERE deleted_at IS NULL AND do_not_contact = false;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- NEXT (separate change, not in this migration): have the dispatch rail set
-- last_contacted_at = now() on a verified email/SMS send, and the Router/Processor
-- (or a dispatch webhook) set nurture_status='active' on enrollment and
-- 'reengagement' on a re-engagement enrollment. Until then last_contacted_at is
-- backfilled from contact_timeline_events by the sweep's recency fallback.
