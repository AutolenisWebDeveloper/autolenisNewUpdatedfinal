-- Make.com cutover, Tranche T6 — allow the spine's 'domain_event' timeline type.
-- BLOCKER found by the T6-B dry-run: emitDomainEvent writes
-- contact_timeline_events.event_type = 'domain_event' (lib/events/emit.ts:149),
-- but contact_timeline_events_event_type_check did NOT include 'domain_event'.
-- The insert is wrapped in try/catch, so without this fix the spine would deploy
-- and silently fail every timeline write — the event layer would stay dark.
-- Idempotent: drop-then-add. Preserves all previously-allowed event types and
-- adds 'domain_event'. Raw Supabase table (CRM plane) — no Prisma migration.

ALTER TABLE contact_timeline_events
  DROP CONSTRAINT IF EXISTS contact_timeline_events_event_type_check;

ALTER TABLE contact_timeline_events
  ADD CONSTRAINT contact_timeline_events_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'email_sent','email_opened','email_clicked','email_bounced','email_unsubscribed',
    'sms_sent','sms_delivered','sms_failed','sms_received','sms_stopped',
    'call_logged','note_added','stage_changed','task_created','task_completed',
    'deposit_initiated','deposit_paid','deposit_refunded',
    'auction_started','auction_closed','offer_received','offer_selected','offer_expired',
    'contract_sent','docusign_signed','docusign_declined',
    'dealer_action','affiliate_action','admin_action',
    'automation_triggered','automation_completed','automation_exited',
    'campaign_sent','campaign_opened','campaign_clicked',
    'domain_event'
  ]::text[]));
