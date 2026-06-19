-- ============================================================================
-- 14_financing_reactivation_templates.sql
-- Fills the three campaigns that had NO seeded templates (audit gap, T4):
--   Financing (fin_intro, fin_options, fin_secure)
--   Dealer Reactivation (dealer_reactivation_1, dealer_reactivation_2)
--   Affiliate Reactivation (aff_reactivation_1, aff_reactivation_2)
-- Mirrors the 08/09 pattern: idempotent INSERT ON CONFLICT(template_key) + v1
-- version backfill. CAN-SPAM footer (unsubscribe + physical address) is appended
-- at render time by TemplateService.renderInline — no footer baked in here.
-- Apply to prod ref aieybibvewmvrubcpthm ONLY. Raw Supabase table — no Prisma.
-- ============================================================================

BEGIN;

ALTER TABLE email_templates
  ADD COLUMN IF NOT EXISTS template_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_templates_template_key
  ON email_templates(template_key) WHERE template_key IS NOT NULL;

INSERT INTO email_templates
  (template_key, name, subject, category, status, html_body, text_body, variables)
VALUES
  (
    'fin_intro',
    'Financing — intro',
    '{{firstName}}, financing that fits your budget',
    'automation',
    'active',
    $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:700;">Financing that fits, {{firstName}}</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">You don't have to use the dealer's lender. AutoLenis helps you line up competitive financing so your monthly payment works for you — before you ever pick an offer.</p>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">Knowing your real rate up front keeps the negotiation honest and the numbers in your favor.</p>
          <p style="margin:0 0 8px;"><a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Explore my financing</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
    $txt${{firstName}}, financing that fits your budget. You don't have to use the dealer's lender — line up a competitive rate before you pick an offer: {{dashboardUrl}}$txt$,
    ARRAY['firstName','dashboardUrl']
  ),
  (
    'fin_options',
    'Financing — compare options',
    'Compare your financing options, {{firstName}}',
    'automation',
    'active',
    $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:700;">Two minutes to a better rate</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">{{firstName}}, a lower APR can save you thousands over the life of the loan. Compare term lengths and see how each changes your monthly payment — no impact to your credit to look.</p>
          <p style="margin:0 0 8px;"><a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Compare options</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
    $txt${{firstName}}, a lower APR can save you thousands. Compare terms and see your monthly payment — no credit impact to look: {{dashboardUrl}}$txt$,
    ARRAY['firstName','dashboardUrl']
  ),
  (
    'fin_secure',
    'Financing — secure your rate',
    'Lock in your rate before the auction closes',
    'automation',
    'active',
    $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:700;">Ready when your offer is, {{firstName}}</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">When you choose a winning offer, having financing ready means you can close fast and confident. Secure your rate now so nothing slows you down at the finish line.</p>
          <p style="margin:0 0 8px;"><a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Secure my rate</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
    $txt${{firstName}}, have financing ready so you can close fast when you pick a winning offer. Secure your rate: {{dashboardUrl}}$txt$,
    ARRAY['firstName','dashboardUrl']
  ),
  (
    'dealer_reactivation_1',
    'Dealer Reactivation — buyers waiting',
    'New buyers are competing for — are you in?',
    'automation',
    'active',
    $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis for Dealers</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:700;">There are active buyers in your market</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">{{firstName}}, real buyers are running auctions right now for vehicles you carry. You haven't placed an offer in a while — and every auction you sit out is a sale going to another dealer.</p>
          <p style="margin:0 0 8px;"><a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">See open auctions</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
    $txt${{firstName}}, active buyers are running auctions for vehicles you carry. Every auction you sit out is a sale to another dealer. See open auctions: {{dashboardUrl}}$txt$,
    ARRAY['firstName','dashboardUrl']
  ),
  (
    'dealer_reactivation_2',
    'Dealer Reactivation — one click back',
    'Reactivate your AutoLenis dealer account',
    'automation',
    'active',
    $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis for Dealers</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:700;">Your seat is still here, {{firstName}}</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">No setup, no fees to come back. Open your dashboard and you'll see live auctions matched to your inventory — bid on the ones that fit and win the buyer.</p>
          <p style="margin:0 0 8px;"><a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Reactivate now</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
    $txt${{firstName}}, no setup, no fees to come back. Open your dashboard for live auctions matched to your inventory: {{dashboardUrl}}$txt$,
    ARRAY['firstName','dashboardUrl']
  ),
  (
    'aff_reactivation_1',
    'Affiliate Reactivation — link still earning',
    '{{firstName}}, your referral link is still live',
    'automation',
    'active',
    $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis Affiliates</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:700;">Your link never expired, {{firstName}}</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">Every buyer who signs up through your referral still earns you commission across three levels. One share this week could put money back in your pocket.</p>
          <p style="margin:0 0 8px;"><a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Get my link</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
    $txt${{firstName}}, your referral link still earns commission across three levels. One share this week could pay off: {{dashboardUrl}}$txt$,
    ARRAY['firstName','dashboardUrl']
  ),
  (
    'aff_reactivation_2',
    'Affiliate Reactivation — restart earnings',
    'Restart your AutoLenis earnings today',
    'automation',
    'active',
    $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis Affiliates</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:700;">Pick up where you left off</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">{{firstName}}, the people you know are buying cars anyway — make sure your link is the one they use. Your dashboard has fresh share copy and your latest stats ready to go.</p>
          <p style="margin:0 0 8px;"><a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Open my dashboard</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
    $txt${{firstName}}, the people you know are buying cars anyway — make sure your link is the one they use. Fresh share copy is ready: {{dashboardUrl}}$txt$,
    ARRAY['firstName','dashboardUrl']
  )
ON CONFLICT (template_key) WHERE template_key IS NOT NULL DO NOTHING;

-- Seed v1 version history for any rows just inserted (skipped if they existed).
INSERT INTO email_template_versions (template_id, version, subject, html_body, text_body)
SELECT t.id, t.version, t.subject, t.html_body, t.text_body
FROM email_templates t
WHERE t.template_key IN (
  'fin_intro','fin_options','fin_secure',
  'dealer_reactivation_1','dealer_reactivation_2',
  'aff_reactivation_1','aff_reactivation_2'
)
ON CONFLICT (template_id, version) DO NOTHING;

COMMIT;
