-- migrations/10_lead_scoring_events.sql
-- Layer 4 — action-based lead scoring. Append-only ledger of scoring actions;
-- each row accrues its `points` onto contacts.lead_score (migration 06) and
-- re-derives contacts.lead_temperature. Raw Supabase table (no Prisma
-- migration). Apply to prod ref aieybibvewmvrubcpthm ONLY.

CREATE TABLE IF NOT EXISTS lead_scoring_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id      UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  action          TEXT NOT NULL,
  points          INT  NOT NULL,
  source          TEXT,
  -- Dedup guard: a logical action (e.g. an emit() domain event keyed
  -- '<event>:<entityId>') accrues points exactly once even across retries.
  idempotency_key TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_scoring_events_contact
  ON lead_scoring_events(contact_id, occurred_at DESC);

-- Partial unique index: dedup applies ONLY to rows that carry a key. Manual /
-- untracked actions may legitimately repeat with a NULL key.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_scoring_events_idem
  ON lead_scoring_events(idempotency_key) WHERE idempotency_key IS NOT NULL;
