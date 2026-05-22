-- ============================================================================
-- AutoLenis Phase 5.1 — LP recovery email templates
-- Adds template_key + seeds the 4 templates driving the LP abandonment and
-- exit-intent recovery flows in lib/inngest/functions.ts.
-- ============================================================================
-- template_key gives Inngest a stable handle into email_templates so marketing
-- can edit subject/body in /admin/crm/templates without redeploying code.
-- The Inngest functions (formAbandonmentFn, exitIntentFn) look the row up by
-- this key, render via TemplateService.renderInline, and dispatch through the
-- standard autolenis/email.send pipeline (so suppression, DNC, and consent
-- gates still apply).
--
-- Seeds use ON CONFLICT (template_key) DO NOTHING so re-applying the migration
-- never overwrites edits an admin has made through the CRM UI.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. SCHEMA — template_key for keyed lookup
-- ---------------------------------------------------------------------------

ALTER TABLE email_templates
  ADD COLUMN IF NOT EXISTS template_key TEXT;

-- Partial unique index so NULLs are allowed (most admin-created templates have
-- no key; only system/automation templates do).
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_templates_template_key
  ON email_templates(template_key)
  WHERE template_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. SEED — 4 recovery templates
-- ---------------------------------------------------------------------------
-- All four share the same branded shell so the recovery sequence reads as one
-- voice. Footer carries the CAN-SPAM physical address and {{unsubscribeUrl}};
-- the FOOTER_SIGNATURE comment tells TemplateService.renderInline not to
-- double-stamp its own footer on top.

INSERT INTO email_templates
  (template_key, name, subject, category, status, html_body, text_body, variables)
VALUES
  (
    'abandonment_touch_1',
    'LP Abandonment — Touch 1 (1h)',
    '{{firstName}}, your auction request is waiting',
    'marketing',
    'active',
    $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">You started a request — finish it in 60 seconds and dealers can begin competing.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">Your auction request is waiting</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">Hi {{firstName}},</p>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.55;color:#334155;">You started a request on AutoLenis but did not finish. The form takes about 60 seconds to complete, and your vehicle type and budget are what tell us which verified dealers to invite to compete for your business.</p>
          <p style="margin:0 0 8px;">
            <a href="{{resumeUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Complete my request</a>
          </p>
        </td></tr>
      </table>
      <!-- autolenis:footer:v1 -->
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;margin-top:16px;">
        <tr><td style="padding:0 16px;font-size:11px;color:#6b7280;line-height:1.5;text-align:center;">
          <div><strong>AutoLenis</strong> · 1234 Main St, Suite 100, San Francisco CA 94105</div>
          <div style="margin-top:4px;"><a href="{{unsubscribeUrl}}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a></div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
    $text$Your auction request is waiting

Hi {{firstName}},

You started a request on AutoLenis but did not finish. The form takes about 60 seconds to complete, and your vehicle type and budget are what tell us which verified dealers to invite to compete for your business.

Complete my request: {{resumeUrl}}

—
AutoLenis · 1234 Main St, Suite 100, San Francisco CA 94105
Unsubscribe: {{unsubscribeUrl}}$text$,
    ARRAY['firstName','resumeUrl','unsubscribeUrl']
  ),
  (
    'abandonment_touch_2',
    'LP Abandonment — Touch 2 (24h)',
    'The auction room is still empty',
    'marketing',
    'active',
    $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">Verified dealers are waiting on your details before they can submit offers.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">The auction room is still empty</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">Hi {{firstName}},</p>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.55;color:#334155;">Verified dealers in your area are on the platform — but no one can submit an offer until your request is complete. No dealer has seen your information yet. When you finish the form, up to 8 dealers compete in a 48-hour auction so you compare offers side-by-side.</p>
          <p style="margin:0 0 8px;">
            <a href="{{resumeUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Open my auction</a>
          </p>
        </td></tr>
      </table>
      <!-- autolenis:footer:v1 -->
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;margin-top:16px;">
        <tr><td style="padding:0 16px;font-size:11px;color:#6b7280;line-height:1.5;text-align:center;">
          <div><strong>AutoLenis</strong> · 1234 Main St, Suite 100, San Francisco CA 94105</div>
          <div style="margin-top:4px;"><a href="{{unsubscribeUrl}}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a></div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
    $text$The auction room is still empty

Hi {{firstName}},

Verified dealers in your area are on the platform — but no one can submit an offer until your request is complete. No dealer has seen your information yet. When you finish the form, up to 8 dealers compete in a 48-hour auction so you compare offers side-by-side.

Open my auction: {{resumeUrl}}

—
AutoLenis · 1234 Main St, Suite 100, San Francisco CA 94105
Unsubscribe: {{unsubscribeUrl}}$text$,
    ARRAY['firstName','resumeUrl','unsubscribeUrl']
  ),
  (
    'abandonment_touch_3',
    'LP Abandonment — Touch 3 (72h, final)',
    'Last chance — we will close your file',
    'marketing',
    'active',
    $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">This is the last email. Finish the request or reply STOP and we will close your file.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">Last chance — we will close your file</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">Hi {{firstName}},</p>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.55;color:#334155;">This is the last email we will send about your request. You have two options: complete the form in 60 seconds, or reply STOP and we will close your file. No hard feelings — your time is yours.</p>
          <p style="margin:0 0 8px;">
            <a href="{{resumeUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Complete my request</a>
          </p>
          <p style="margin:20px 0 0;font-size:13px;color:#6b7280;">If you would prefer we close your file, just reply STOP and we will remove your details.</p>
        </td></tr>
      </table>
      <!-- autolenis:footer:v1 -->
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;margin-top:16px;">
        <tr><td style="padding:0 16px;font-size:11px;color:#6b7280;line-height:1.5;text-align:center;">
          <div><strong>AutoLenis</strong> · 1234 Main St, Suite 100, San Francisco CA 94105</div>
          <div style="margin-top:4px;"><a href="{{unsubscribeUrl}}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a></div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
    $text$Last chance — we will close your file

Hi {{firstName}},

This is the last email we will send about your request. You have two options: complete the form in 60 seconds, or reply STOP and we will close your file. No hard feelings — your time is yours.

Complete my request: {{resumeUrl}}

If you would prefer we close your file, just reply STOP and we will remove your details.

—
AutoLenis · 1234 Main St, Suite 100, San Francisco CA 94105
Unsubscribe: {{unsubscribeUrl}}$text$,
    ARRAY['firstName','resumeUrl','unsubscribeUrl']
  ),
  (
    'exit_intent_recovery',
    'LP Exit Intent — Recovery (30m)',
    'Still looking for the right deal?',
    'marketing',
    'active',
    $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">A quick note from AutoLenis — no commitment, just a thought.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">Still looking for the right deal?</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">Hi {{firstName}},</p>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.55;color:#334155;">You stopped by AutoLenis earlier. No commitment was made, no pressure here. If you are still searching for a vehicle, the platform lets dealers compete for your business so you never negotiate alone. Takes about 60 seconds to start.</p>
          <p style="margin:0 0 8px;">
            <a href="{{returnUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">See how it works</a>
          </p>
        </td></tr>
      </table>
      <!-- autolenis:footer:v1 -->
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;margin-top:16px;">
        <tr><td style="padding:0 16px;font-size:11px;color:#6b7280;line-height:1.5;text-align:center;">
          <div><strong>AutoLenis</strong> · 1234 Main St, Suite 100, San Francisco CA 94105</div>
          <div style="margin-top:4px;"><a href="{{unsubscribeUrl}}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a></div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
    $text$Still looking for the right deal?

Hi {{firstName}},

You stopped by AutoLenis earlier. No commitment was made, no pressure here. If you are still searching for a vehicle, the platform lets dealers compete for your business so you never negotiate alone. Takes about 60 seconds to start.

See how it works: {{returnUrl}}

—
AutoLenis · 1234 Main St, Suite 100, San Francisco CA 94105
Unsubscribe: {{unsubscribeUrl}}$text$,
    ARRAY['firstName','returnUrl','unsubscribeUrl']
  )
ON CONFLICT (template_key) DO NOTHING;

-- Seed v1 of the version history for any rows we just inserted. Skipped for
-- rows that already existed (the version row already exists too).
INSERT INTO email_template_versions (template_id, version, subject, html_body, text_body)
SELECT t.id, t.version, t.subject, t.html_body, t.text_body
FROM email_templates t
WHERE t.template_key IN (
  'abandonment_touch_1',
  'abandonment_touch_2',
  'abandonment_touch_3',
  'exit_intent_recovery'
)
ON CONFLICT (template_id, version) DO NOTHING;

COMMIT;
