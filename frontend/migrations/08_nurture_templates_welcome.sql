-- ============================================================================
-- 08_nurture_templates_welcome.sql
-- Welcome nurture sequence (trigger: buyer_signup) — D0, D1, D3, D5, D7
--
-- Seeds 5 email templates into email_templates with stable template_keys that
-- the Make Welcome scenario references. Matches the schema in
-- 02_phase3_messaging.sql and the HTML pattern in 05_lp_recovery_templates.sql.
--
-- Conventions honored:
--   * category = 'automation' (sequence-triggered). The dispatch layer treats
--     non-transactional categories as consent-gated, so these only send to
--     contacts with consent_email = true. Correct for a marketing nurture.
--   * The CAN-SPAM footer (unsubscribe + physical address) is appended by the
--     platform at render time at the <!-- autolenis:footer:v1 --> marker.
--     Do NOT hardcode an unsubscribe link or address here.
--   * Compliance: no guarantees, no invented statistics, no fabricated
--     testimonials. The D5 "story" template is an illustrative walkthrough of
--     the process — NOT a fake named customer with invented savings (FTC).
--   * Idempotent: safe to re-run.
-- ============================================================================

-- Ensure the column exists before indexing it. On a fresh database this file
-- can be the first to introduce template_key (05 aborts historically; 09/14/15
-- add it themselves) — indexing a column this file never created made the
-- whole transaction roll back on fresh provisions.
ALTER TABLE email_templates
  ADD COLUMN IF NOT EXISTS template_key TEXT;

-- Ensure ON CONFLICT has a constraint to target (no-op if it already exists).
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_templates_template_key
  ON email_templates (template_key)
  WHERE template_key IS NOT NULL;

-- ----------------------------------------------------------------------------
-- D0 — Welcome
-- ----------------------------------------------------------------------------
INSERT INTO email_templates
  (template_key, name, subject, category, status, html_body, text_body, variables)
VALUES
(
  'welcome_d0',
  'Welcome — D0',
  'Welcome to AutoLenis, {{firstName}}',
  'automation',
  'active',
  $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">You're in. Here's how AutoLenis puts dealers to work competing for your car.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">Welcome, {{firstName}}</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">Thanks for joining AutoLenis. We work a little differently from a typical car site: instead of you chasing dealers, dealers compete for you.</p>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.55;color:#334155;">Over the next few days we'll show you how it works and how to get the most out of it. To start, set up your profile and tell us what you're looking for.</p>
          <p style="margin:0 0 8px;">
            <a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Go to my dashboard</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
  $txt$Welcome, {{firstName}}.

Thanks for joining AutoLenis. We work differently from a typical car site: instead of you chasing dealers, dealers compete for you.

Over the next few days we'll show you how it works. To start, set up your profile and tell us what you're looking for:
{{dashboardUrl}}$txt$,
  '{firstName,dashboardUrl}'
)
ON CONFLICT (template_key) WHERE template_key IS NOT NULL DO NOTHING;

-- ----------------------------------------------------------------------------
-- D1 — How AutoLenis works
-- ----------------------------------------------------------------------------
INSERT INTO email_templates
  (template_key, name, subject, category, status, html_body, text_body, variables)
VALUES
(
  'welcome_d1_how_it_works',
  'Welcome — D1 How it works',
  'How AutoLenis works, {{firstName}}',
  'automation',
  'active',
  $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">Pick what you want, dealers submit their best offers, you choose. Here's the flow.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">Three steps, {{firstName}}</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">Here's the whole flow:</p>
          <p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#334155;"><strong>1. Tell us what you want.</strong> Pick a vehicle and your budget. That's what tells us which verified dealers to invite.</p>
          <p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#334155;"><strong>2. Dealers compete.</strong> Invited dealers submit their best out-the-door offers — you don't haggle, they bid.</p>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.55;color:#334155;"><strong>3. You choose.</strong> Compare offers side by side and pick the one that works for you. No obligation to accept any of them.</p>
          <p style="margin:0 0 8px;">
            <a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Start a request</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
  $txt$Three steps, {{firstName}}:

1. Tell us what you want. Pick a vehicle and your budget — that's what tells us which verified dealers to invite.
2. Dealers compete. Invited dealers submit their best out-the-door offers. You don't haggle, they bid.
3. You choose. Compare offers side by side and pick what works for you. No obligation to accept any of them.

Start a request: {{dashboardUrl}}$txt$,
  '{firstName,dashboardUrl}'
)
ON CONFLICT (template_key) WHERE template_key IS NOT NULL DO NOTHING;

-- ----------------------------------------------------------------------------
-- D3 — Dealers compete for you
-- ----------------------------------------------------------------------------
INSERT INTO email_templates
  (template_key, name, subject, category, status, html_body, text_body, variables)
VALUES
(
  'welcome_d3_dealer_competition',
  'Welcome — D3 Dealer competition',
  'Why dealers compete on AutoLenis',
  'automation',
  'active',
  $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">When dealers know they're bidding against each other, the offer you see is their real number.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">The competition works for you</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">Hi {{firstName}},</p>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">On a normal lot, a dealer only competes with the dealers you happen to visit that day. On AutoLenis, verified dealers know they're submitting offers against each other for the same buyer — so they're motivated to lead with a strong out-the-door number instead of a starting point to negotiate down from.</p>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.55;color:#334155;">You stay anonymous until you choose. No pressure, no phone calls during the process — just offers to compare.</p>
          <p style="margin:0 0 8px;">
            <a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Set up my request</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
  $txt$Hi {{firstName}},

On a normal lot, a dealer only competes with the dealers you happen to visit that day. On AutoLenis, verified dealers know they're submitting offers against each other for the same buyer — so they're motivated to lead with a strong out-the-door number instead of a starting point to negotiate down from.

You stay anonymous until you choose. No pressure, no calls during the process — just offers to compare.

Set up my request: {{dashboardUrl}}$txt$,
  '{firstName,dashboardUrl}'
)
ON CONFLICT (template_key) WHERE template_key IS NOT NULL DO NOTHING;

-- ----------------------------------------------------------------------------
-- D5 — What to expect (illustrative process walkthrough — NOT a fabricated testimonial)
-- ----------------------------------------------------------------------------
INSERT INTO email_templates
  (template_key, name, subject, category, status, html_body, text_body, variables)
VALUES
(
  'welcome_d5_what_to_expect',
  'Welcome — D5 What to expect',
  'What happens after you submit a request',
  'automation',
  'active',
  $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">From request to offers to pickup — here's what the AutoLenis process looks like end to end.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">What to expect, {{firstName}}</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">Once you submit a request, here's how it plays out:</p>
          <p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#334155;"><strong>Your auction opens.</strong> Verified dealers are invited and submit out-the-door offers within the auction window.</p>
          <p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#334155;"><strong>You compare.</strong> Offers come in side by side — price, fees, and financing options laid out clearly.</p>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.55;color:#334155;"><strong>You finish on your terms.</strong> Pick an offer, sort out financing and insurance, review the contract, and arrange pickup. You're in control at every step.</p>
          <p style="margin:0 0 8px;">
            <a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Start when you're ready</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
  $txt$What to expect, {{firstName}}:

Once you submit a request, here's how it plays out:
- Your auction opens. Verified dealers are invited and submit out-the-door offers within the auction window.
- You compare. Offers come in side by side — price, fees, and financing options laid out clearly.
- You finish on your terms. Pick an offer, sort out financing and insurance, review the contract, and arrange pickup.

Start when you're ready: {{dashboardUrl}}$txt$,
  '{firstName,dashboardUrl}'
)
ON CONFLICT (template_key) WHERE template_key IS NOT NULL DO NOTHING;

-- ----------------------------------------------------------------------------
-- D7 — Ready to start? Request your vehicle
-- ----------------------------------------------------------------------------
INSERT INTO email_templates
  (template_key, name, subject, category, status, html_body, text_body, variables)
VALUES
(
  'welcome_d7_request',
  'Welcome — D7 Request your vehicle',
  '{{firstName}}, ready to let dealers compete?',
  'automation',
  'active',
  $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">Tell us what you want and your auction can open. It takes about a minute.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">Ready when you are, {{firstName}}</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">You've seen how it works — dealers compete, you choose, you stay in control. The only thing left is to tell us what you're looking for.</p>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.55;color:#334155;">It takes about a minute, and there's no obligation to accept any offer that comes back.</p>
          <p style="margin:0 0 8px;">
            <a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Request my vehicle</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
  $txt$Ready when you are, {{firstName}}.

You've seen how it works — dealers compete, you choose, you stay in control. The only thing left is to tell us what you're looking for.

It takes about a minute, and there's no obligation to accept any offer that comes back.

Request my vehicle: {{dashboardUrl}}$txt$,
  '{firstName,dashboardUrl}'
)
ON CONFLICT (template_key) WHERE template_key IS NOT NULL DO NOTHING;
