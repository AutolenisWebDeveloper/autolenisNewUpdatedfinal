-- ============================================================================
-- AutoLenis CRM — Make.com cutover: CONSOLIDATED prod SQL (idempotent, ordered).
-- Apply to Supabase prod ref aieybibvewmvrubcpthm ONLY. Safe to re-run.
-- Run top-to-bottom. Each block is independently idempotent.
-- Sections: T3 schema (06,10,13) -> T6 constraint -> T1 data -> T2 data -> T4 templates.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- T3 / migration 06 — contacts.lead_score + lead_temperature (prereq for 10)
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS lead_score       INT,
  ADD COLUMN IF NOT EXISTS lead_temperature TEXT;

CREATE INDEX IF NOT EXISTS idx_contacts_lead_score
  ON contacts(lead_score DESC) WHERE deleted_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_lead_temperature_chk') THEN
    ALTER TABLE contacts ADD CONSTRAINT contacts_lead_temperature_chk
      CHECK (lead_temperature IS NULL OR lead_temperature IN ('hot','warm','cold'));
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- T3 / migration 10 — lead_scoring_events ledger (action-based lead scoring)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lead_scoring_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id      UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  action          TEXT NOT NULL,
  points          INT  NOT NULL,
  source          TEXT,
  idempotency_key TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_scoring_events_contact
  ON lead_scoring_events(contact_id, occurred_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_scoring_events_idem
  ON lead_scoring_events(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- T3 / migration 13 — contacts.nurture_status + last_contacted_at + index
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS nurture_status TEXT NOT NULL DEFAULT 'none'
    CHECK (nurture_status IN ('none', 'active', 'suppressed', 'reengagement'));
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_nurture_coverage
  ON contacts (nurture_status, last_contacted_at)
  WHERE deleted_at IS NULL AND do_not_contact = false;

-- ─────────────────────────────────────────────────────────────────────────
-- T6 — allow the spine's 'domain_event' timeline type (BLOCKER FIX).
-- emitDomainEvent writes event_type='domain_event'; the CHECK rejected it, so
-- the spine would deploy and silently fail every timeline write. Drop+add is
-- idempotent and preserves all previously-allowed values.
-- ─────────────────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────────────
-- T1 — double-send fuse: archive every in-app workflow (Make is sole sender).
-- workflows_status_check allows draft|active|paused|archived; 'archived' is the
-- explicit retired state. Engine treats any status<>'active' as non-dispatching.
-- ─────────────────────────────────────────────────────────────────────────
UPDATE workflows SET status = 'archived', updated_at = now()
WHERE status <> 'archived';

-- ─────────────────────────────────────────────────────────────────────────
-- T2 (H1) — unify SMS opt-out: backfill legacy sms_opt_outs into the canonical
-- sms_suppression store (read by every send path). No-op if nothing to migrate.
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO sms_suppression (phone, reason, suppressed_at)
SELECT o.phone, 'stop', COALESCE(o.created_at, now())
FROM sms_opt_outs o
WHERE NOT EXISTS (SELECT 1 FROM sms_suppression s WHERE s.phone = o.phone)
ON CONFLICT (phone) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────
-- T4 — seed the 3 campaigns that had NO templates (Financing, Dealer/Affiliate
-- Reactivation). CAN-SPAM footer is appended at render time, not baked here.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS template_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_templates_template_key
  ON email_templates(template_key) WHERE template_key IS NOT NULL;

INSERT INTO email_templates (template_key, name, subject, category, status, html_body, text_body, variables)
VALUES
  ('fin_intro','Financing — intro','{{firstName}}, financing that fits your budget','automation','active',
   $html$<!doctype html><html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;"><table role="presentation" width="100%" style="background:#f8fafc;"><tr><td align="center" style="padding:32px 16px;"><table role="presentation" width="560" style="max-width:560px;background:#fff;border-radius:16px;padding:32px;"><tr><td><p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p><h1 style="margin:0 0 16px;font-size:24px;font-weight:700;">Financing that fits, {{firstName}}</h1><p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">You don't have to use the dealer's lender. AutoLenis helps you line up competitive financing so your monthly payment works for you — before you ever pick an offer.</p><p style="margin:0 0 8px;"><a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#fff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Explore my financing</a></p></td></tr></table></td></tr></table></body></html>$html$,
   $txt${{firstName}}, financing that fits your budget. Line up a competitive rate before you pick an offer: {{dashboardUrl}}$txt$, ARRAY['firstName','dashboardUrl']),
  ('fin_options','Financing — compare options','Compare your financing options, {{firstName}}','automation','active',
   $html$<!doctype html><html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;"><table role="presentation" width="100%" style="background:#f8fafc;"><tr><td align="center" style="padding:32px 16px;"><table role="presentation" width="560" style="max-width:560px;background:#fff;border-radius:16px;padding:32px;"><tr><td><p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p><h1 style="margin:0 0 16px;font-size:24px;font-weight:700;">Two minutes to a better rate</h1><p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">{{firstName}}, a lower APR can save you thousands over the life of the loan. Compare term lengths and see how each changes your monthly payment — no impact to your credit to look.</p><p style="margin:0 0 8px;"><a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#fff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Compare options</a></p></td></tr></table></td></tr></table></body></html>$html$,
   $txt${{firstName}}, a lower APR can save you thousands. Compare terms — no credit impact to look: {{dashboardUrl}}$txt$, ARRAY['firstName','dashboardUrl']),
  ('fin_secure','Financing — secure your rate','Lock in your rate before the auction closes','automation','active',
   $html$<!doctype html><html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;"><table role="presentation" width="100%" style="background:#f8fafc;"><tr><td align="center" style="padding:32px 16px;"><table role="presentation" width="560" style="max-width:560px;background:#fff;border-radius:16px;padding:32px;"><tr><td><p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p><h1 style="margin:0 0 16px;font-size:24px;font-weight:700;">Ready when your offer is, {{firstName}}</h1><p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">When you choose a winning offer, having financing ready means you can close fast and confident. Secure your rate now so nothing slows you down at the finish line.</p><p style="margin:0 0 8px;"><a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#fff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Secure my rate</a></p></td></tr></table></td></tr></table></body></html>$html$,
   $txt${{firstName}}, have financing ready so you can close fast when you pick a winner. Secure your rate: {{dashboardUrl}}$txt$, ARRAY['firstName','dashboardUrl']),
  ('dealer_reactivation_1','Dealer Reactivation — buyers waiting','New buyers are competing — are you in?','automation','active',
   $html$<!doctype html><html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;"><table role="presentation" width="100%" style="background:#f8fafc;"><tr><td align="center" style="padding:32px 16px;"><table role="presentation" width="560" style="max-width:560px;background:#fff;border-radius:16px;padding:32px;"><tr><td><p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis for Dealers</p><h1 style="margin:0 0 16px;font-size:24px;font-weight:700;">There are active buyers in your market</h1><p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">{{firstName}}, real buyers are running auctions right now for vehicles you carry. You haven't placed an offer in a while — and every auction you sit out is a sale going to another dealer.</p><p style="margin:0 0 8px;"><a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#fff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">See open auctions</a></p></td></tr></table></td></tr></table></body></html>$html$,
   $txt${{firstName}}, active buyers are running auctions for vehicles you carry. See open auctions: {{dashboardUrl}}$txt$, ARRAY['firstName','dashboardUrl']),
  ('dealer_reactivation_2','Dealer Reactivation — one click back','Reactivate your AutoLenis dealer account','automation','active',
   $html$<!doctype html><html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;"><table role="presentation" width="100%" style="background:#f8fafc;"><tr><td align="center" style="padding:32px 16px;"><table role="presentation" width="560" style="max-width:560px;background:#fff;border-radius:16px;padding:32px;"><tr><td><p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis for Dealers</p><h1 style="margin:0 0 16px;font-size:24px;font-weight:700;">Your seat is still here, {{firstName}}</h1><p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">No setup, no fees to come back. Open your dashboard and you'll see live auctions matched to your inventory — bid on the ones that fit and win the buyer.</p><p style="margin:0 0 8px;"><a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#fff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Reactivate now</a></p></td></tr></table></td></tr></table></body></html>$html$,
   $txt${{firstName}}, no setup, no fees to come back. Live auctions matched to your inventory: {{dashboardUrl}}$txt$, ARRAY['firstName','dashboardUrl']),
  ('aff_reactivation_1','Affiliate Reactivation — link still earning','{{firstName}}, your referral link is still live','automation','active',
   $html$<!doctype html><html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;"><table role="presentation" width="100%" style="background:#f8fafc;"><tr><td align="center" style="padding:32px 16px;"><table role="presentation" width="560" style="max-width:560px;background:#fff;border-radius:16px;padding:32px;"><tr><td><p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis Affiliates</p><h1 style="margin:0 0 16px;font-size:24px;font-weight:700;">Your link never expired, {{firstName}}</h1><p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">Every buyer who signs up through your referral still earns you commission across three levels. One share this week could put money back in your pocket.</p><p style="margin:0 0 8px;"><a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#fff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Get my link</a></p></td></tr></table></td></tr></table></body></html>$html$,
   $txt${{firstName}}, your referral link still earns commission across three levels: {{dashboardUrl}}$txt$, ARRAY['firstName','dashboardUrl']),
  ('aff_reactivation_2','Affiliate Reactivation — restart earnings','Restart your AutoLenis earnings today','automation','active',
   $html$<!doctype html><html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;"><table role="presentation" width="100%" style="background:#f8fafc;"><tr><td align="center" style="padding:32px 16px;"><table role="presentation" width="560" style="max-width:560px;background:#fff;border-radius:16px;padding:32px;"><tr><td><p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis Affiliates</p><h1 style="margin:0 0 16px;font-size:24px;font-weight:700;">Pick up where you left off</h1><p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">{{firstName}}, the people you know are buying cars anyway — make sure your link is the one they use. Your dashboard has fresh share copy and your latest stats ready to go.</p><p style="margin:0 0 8px;"><a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#fff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Open my dashboard</a></p></td></tr></table></td></tr></table></body></html>$html$,
   $txt${{firstName}}, make sure your link is the one they use. Fresh share copy is ready: {{dashboardUrl}}$txt$, ARRAY['firstName','dashboardUrl'])
ON CONFLICT (template_key) WHERE template_key IS NOT NULL DO NOTHING;

INSERT INTO email_template_versions (template_id, version, subject, html_body, text_body)
SELECT t.id, t.version, t.subject, t.html_body, t.text_body
FROM email_templates t
WHERE t.template_key IN ('fin_intro','fin_options','fin_secure','dealer_reactivation_1','dealer_reactivation_2','aff_reactivation_1','aff_reactivation_2')
ON CONFLICT (template_id, version) DO NOTHING;

-- ============================================================================
-- VERIFICATION (expected results in comments)
-- ============================================================================
-- 1) schema present:
SELECT
  to_regclass('public.lead_scoring_events')                                                                  AS lead_scoring_events_tbl,   -- lead_scoring_events
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='contacts' AND column_name='lead_score')   AS has_lead_score,            -- t
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='contacts' AND column_name='nurture_status')AS has_nurture_status,        -- t
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='contacts' AND column_name='last_contacted_at') AS has_last_contacted_at; -- t
-- 2) domain_event now allowed (expect no error):
--    INSERT ... event_type='domain_event' would succeed.
-- 3) no active workflows (expect 0):
SELECT count(*) AS active_workflows FROM workflows WHERE status='active';
-- 4) templates seeded (expect 7 rows):
SELECT count(*) AS new_templates FROM email_templates
WHERE template_key IN ('fin_intro','fin_options','fin_secure','dealer_reactivation_1','dealer_reactivation_2','aff_reactivation_1','aff_reactivation_2');
