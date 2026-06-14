-- ============================================================================
-- 08_welcome_templates.sql
-- Buyer Welcome onboarding series (3 touches) seeded into email_templates.
-- Shares the branded shell used by 05 (LP recovery) and 09 (nurture) so the
-- whole lifecycle reads as one voice. welcome_touch_1 is the key referenced by
-- the CRM copilot example (lib/ai/crm-copilot.ts).
-- Idempotent; CAN-SPAM footer (unsubscribe + physical address) is appended at
-- render time by TemplateService.renderInline, so no footer is baked in here.
-- ============================================================================

BEGIN;

-- template_key may already exist (added in 05); keep idempotent.
ALTER TABLE email_templates
  ADD COLUMN IF NOT EXISTS template_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_templates_template_key
  ON email_templates(template_key)
  WHERE template_key IS NOT NULL;

INSERT INTO email_templates
  (template_key, name, subject, category, status, html_body, text_body, variables)
VALUES
  (
    'welcome_touch_1',
    'Welcome — Touch 1 (intro)',
    'Welcome to AutoLenis, {{firstName}}',
    'automation',
    'active',
    $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">Welcome — here's how dealers compete for your business on AutoLenis.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">Welcome to AutoLenis, {{firstName}}</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">Thanks for joining. AutoLenis flips car buying around: instead of negotiating dealer by dealer, you tell us what you want and verified dealers compete for your business on the out-the-door price.</p>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">You stay anonymous until you choose an offer — no calls, no pressure. Your dashboard is where everything happens.</p>
          <p style="margin:0 0 8px;">
            <a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Go to my dashboard</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
    $txt$Welcome to AutoLenis, {{firstName}}. Tell us what you want and verified dealers compete for your business on out-the-door price — you stay anonymous until you choose. Dashboard: {{dashboardUrl}}$txt$,
    ARRAY['firstName','dashboardUrl']
  ),
  (
    'welcome_touch_2',
    'Welcome — Touch 2 (how it works)',
    'How AutoLenis works for you, {{firstName}}',
    'automation',
    'active',
    $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">Three steps: request, dealers compete, you compare and choose.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">How it works, {{firstName}}</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">It's three steps. First, you tell us the vehicle you want. Then verified dealers compete in an auction and submit their best out-the-door offers. Finally, you compare them side by side and pick the one that fits — on your terms.</p>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">There's never an obligation to accept an offer, and nothing finalizes without your sign-off.</p>
          <p style="margin:0 0 8px;">
            <a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">See how it works</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
    $txt${{firstName}}, AutoLenis in three steps: request a vehicle, verified dealers compete with out-the-door offers, you compare and choose. No obligation. See how: {{dashboardUrl}}$txt$,
    ARRAY['firstName','dashboardUrl']
  ),
  (
    'welcome_touch_3',
    'Welcome — Touch 3 (first request)',
    'Ready to start, {{firstName}}?',
    'automation',
    'active',
    $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">Start your first request and let dealers compete in about 60 seconds.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">Ready to start, {{firstName}}?</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">Starting a request takes about 60 seconds. Your vehicle type and budget are what tell us which verified dealers to invite to compete for you — the sooner you start, the sooner offers come in.</p>
          <p style="margin:0 0 8px;">
            <a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Start my request</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
    $txt${{firstName}}, starting a request takes about 60 seconds and tells us which verified dealers to invite to compete for you. Start: {{dashboardUrl}}$txt$,
    ARRAY['firstName','dashboardUrl']
  )
ON CONFLICT (template_key) WHERE template_key IS NOT NULL DO NOTHING;

-- Seed v1 of the version history for any rows we just inserted. Skipped for
-- rows that already existed (the version row already exists too).
INSERT INTO email_template_versions (template_id, version, subject, html_body, text_body)
SELECT t.id, t.version, t.subject, t.html_body, t.text_body
FROM email_templates t
WHERE t.template_key IN (
  'welcome_touch_1',
  'welcome_touch_2',
  'welcome_touch_3'
)
ON CONFLICT (template_id, version) DO NOTHING;

COMMIT;
