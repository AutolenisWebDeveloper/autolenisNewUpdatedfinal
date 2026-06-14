-- ============================================================================
-- 09_nurture_templates_all.sql
-- Full nurture email-template set for all remaining campaigns.
-- Generated from gen_campaigns.py (copy-as-data + shared shell).
-- Pairs with 08 (Welcome) and 05 (LP recovery, already seeded).
-- Idempotent. No inline footer is baked in: TemplateService.renderInline
-- appends the CAN-SPAM footer (physical address + unsubscribe) at render
-- time because these bodies carry no autolenis:footer:v1 marker.
-- ============================================================================

BEGIN;

-- template_key and its partial unique index are introduced in 05; re-assert
-- them here so this migration is self-contained and safe to run standalone.
-- Reuse 05's index name so this is a true no-op once 05 has applied.
ALTER TABLE email_templates
  ADD COLUMN IF NOT EXISTS template_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_templates_template_key
  ON email_templates(template_key)
  WHERE template_key IS NOT NULL;

INSERT INTO email_templates
  (template_key, name, subject, category, status, html_body, text_body, variables)
VALUES
(
  'vr_received',
  'Vehicle Request — received',
  '{{firstName}}, your request is in',
  'transactional',
  'active',
  $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">We are inviting verified dealers to compete for your vehicle.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">Your request is in, {{firstName}}</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">We have your request and are inviting verified dealers to compete for it. You will be notified the moment your auction opens and offers start coming in.</p>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">You stay anonymous until you choose an offer — no calls, no pressure during the process.</p>
          <p style="margin:0 0 8px;">
            <a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">View my request</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
  $txt$Your request is in, {{firstName}}. We're inviting verified dealers to compete. You'll be notified when your auction opens and offers arrive. View it: {{dashboardUrl}}$txt$,
  '{firstName,dashboardUrl}'
),
(
  'auction_live',
  'Auction — live',
  'Your auction is live, {{firstName}}',
  'transactional',
  'active',
  $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">Dealers are now competing for your vehicle.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">Your auction is live</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">Hi {{firstName}}, your auction is open and verified dealers are competing for your vehicle right now. Offers will appear in your dashboard as they come in.</p>
          <p style="margin:0 0 8px;">
            <a href="{{auctionUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Watch my auction</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
  $txt$Hi {{firstName}}, your AutoLenis auction is live and dealers are competing now. Watch offers come in: {{auctionUrl}}$txt$,
  '{firstName,auctionUrl}'
),
(
  'offer_in',
  'Offer — received',
  'You have a new offer, {{firstName}}',
  'transactional',
  'active',
  $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">A dealer just submitted an out-the-door offer.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">You have a new offer</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">A verified dealer just submitted an out-the-door offer in your auction. Open your dashboard to see the full breakdown — price, fees, and financing options.</p>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">There is no obligation to accept. You choose if and when an offer works for you.</p>
          <p style="margin:0 0 8px;">
            <a href="{{offerUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">See my offer</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
  $txt${{firstName}}, you have a new out-the-door offer in your AutoLenis auction. See the full breakdown: {{offerUrl}}$txt$,
  '{firstName,offerUrl}'
),
(
  'offer_multiple',
  'Offer — multiple received',
  '{{firstName}}, dealers are competing',
  'transactional',
  'active',
  $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">You have multiple offers to compare side by side.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">Multiple offers are in</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">More than one dealer has submitted an offer. This is where AutoLenis works for you — compare them side by side and pick the one that fits, on your terms.</p>
          <p style="margin:0 0 8px;">
            <a href="{{offerUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Compare offers</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
  $txt${{firstName}}, multiple dealers have submitted offers in your auction. Compare them side by side: {{offerUrl}}$txt$,
  '{firstName,offerUrl}'
),
(
  'deal_formed',
  'Deal — formed',
  'Next steps for your vehicle, {{firstName}}',
  'transactional',
  'active',
  $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">You selected an offer — here is what happens next.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">You picked an offer</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">Great choice, {{firstName}}. Now we coordinate the rest: financing, your concierge fee, insurance, contract review, and pickup. Your dashboard walks you through each step.</p>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">You stay in control the whole way — nothing finalizes without your sign-off.</p>
          <p style="margin:0 0 8px;">
            <a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Continue my deal</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
  $txt${{firstName}}, you selected an offer. Next: financing, insurance, contract review, and pickup. Continue: {{dashboardUrl}}$txt$,
  '{firstName,dashboardUrl}'
),
(
  'deposit_confirmed',
  'Deposit — confirmed',
  'Your deposit is confirmed',
  'transactional',
  'active',
  $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">Your deposit is in and your auction can proceed.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">Deposit confirmed</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">Thanks, {{firstName}} — your deposit is confirmed and your auction can proceed. This keeps your request active and signals to dealers that you are a serious buyer.</p>
          <p style="margin:0 0 8px;">
            <a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Go to my dashboard</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
  $txt${{firstName}}, your AutoLenis deposit is confirmed and your auction can proceed. Dashboard: {{dashboardUrl}}$txt$,
  '{firstName,dashboardUrl}'
),
(
  'contract_signed',
  'Contract — signed',
  'Your contract is signed, {{firstName}}',
  'transactional',
  'active',
  $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">Signed and saved — pickup is the last step.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">Your contract is signed</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">Your contract is signed and saved, {{firstName}}. The last step is arranging pickup or delivery. Your dashboard has the details and your pickup confirmation.</p>
          <p style="margin:0 0 8px;">
            <a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">View pickup details</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
  $txt${{firstName}}, your AutoLenis contract is signed. Last step is pickup — details here: {{dashboardUrl}}$txt$,
  '{firstName,dashboardUrl}'
),
(
  'trade_in_value',
  'Trade-In — value',
  '{{firstName}}, about your trade-in',
  'automation',
  'active',
  $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">Here is how your trade-in fits into a smarter purchase.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">Your trade-in, {{firstName}}</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">Thanks for sharing your trade-in details. On AutoLenis, your trade can factor into the offers dealers compete with — which means it works for you rather than getting buried in negotiation.</p>
          <p style="margin:0 0 8px;">
            <a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">See my options</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
  $txt${{firstName}}, thanks for your trade-in details. On AutoLenis your trade factors into the offers dealers compete with. See options: {{dashboardUrl}}$txt$,
  '{firstName,dashboardUrl}'
),
(
  'trade_in_equity',
  'Trade-In — equity',
  'Understanding your trade-in equity',
  'automation',
  'active',
  $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">A quick look at how trade equity affects your next vehicle.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">Trade equity, explained</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">Hi {{firstName}} — the difference between what your current vehicle is worth and what you owe is your equity, and it can lower what you finance on your next one.</p>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">When dealers compete on AutoLenis, they factor this in transparently, so you can see the real out-the-door picture.</p>
          <p style="margin:0 0 8px;">
            <a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Explore my options</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
  $txt${{firstName}}, your trade equity can lower what you finance next. On AutoLenis dealers factor it in transparently. Explore: {{dashboardUrl}}$txt$,
  '{firstName,dashboardUrl}'
),
(
  'trade_in_upgrade',
  'Trade-In — upgrade',
  'Ready to put your trade to work?',
  'automation',
  'active',
  $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">Turn your current vehicle into your next one.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">Put your trade to work, {{firstName}}</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">When you are ready, start a request and let verified dealers compete — with your trade factored in. There is no obligation to accept any offer.</p>
          <p style="margin:0 0 8px;">
            <a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Start my request</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
  $txt${{firstName}}, ready to put your trade to work? Start a request and let dealers compete: {{dashboardUrl}}$txt$,
  '{firstName,dashboardUrl}'
),
(
  'refi_review',
  'Refinance — review',
  '{{firstName}}, a look at your auto loan',
  'automation',
  'active',
  $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">See whether refinancing could fit your situation.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">A look at your loan, {{firstName}}</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">Thanks for your interest in refinancing. Refinancing replaces your current auto loan with a new one — depending on rates and your situation, it may change your monthly payment or term.</p>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">We can help you explore options. Whether it makes sense depends on your specifics, and there is no obligation.</p>
          <p style="margin:0 0 8px;">
            <a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Explore refinancing</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
  $txt${{firstName}}, refinancing replaces your current auto loan with a new one and may change your payment or term. Explore options (no obligation): {{dashboardUrl}}$txt$,
  '{firstName,dashboardUrl}'
),
(
  'refi_savings',
  'Refinance — payment',
  'How refinancing can change your payment',
  'automation',
  'active',
  $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">Lower rate, different term — here is how the math can work.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">How the math can work</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">Hi {{firstName}} — a refinance can affect your payment two ways: through the interest rate and through the loan term. A different term changes monthly cost and total interest over the life of the loan.</p>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">Actual terms depend on your credit and lender. We are not a lender; we help you compare. Nothing here is a guaranteed rate or outcome.</p>
          <p style="margin:0 0 8px;">
            <a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">See my options</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
  $txt${{firstName}}, a refinance can change your payment via rate and term. Actual terms depend on your situation. Compare options: {{dashboardUrl}}$txt$,
  '{firstName,dashboardUrl}'
),
(
  'refi_options',
  'Refinance — options',
  'Ready to explore refinancing?',
  'automation',
  'active',
  $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">Compare without obligation.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">Explore when you are ready</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">When you want to look at refinancing options, we can help you compare. You are never obligated to proceed, and we will always be straight with you about what does and does not make sense.</p>
          <p style="margin:0 0 8px;">
            <a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Explore refinancing</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
  $txt${{firstName}}, when you're ready to explore refinancing, we can help you compare — no obligation. Start here: {{dashboardUrl}}$txt$,
  '{firstName,dashboardUrl}'
),
(
  'saved_search_confirm',
  'Saved Search — confirmed',
  'Your search is saved, {{firstName}}',
  'transactional',
  'active',
  $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">We will let you know when matching vehicles appear.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">Search saved</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">Got it, {{firstName}} — your search is saved. When vehicles matching it become available, we will let you know so you can start a request and let dealers compete.</p>
          <p style="margin:0 0 8px;">
            <a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">View my searches</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
  $txt${{firstName}}, your search is saved. We'll alert you when matching vehicles appear. View searches: {{dashboardUrl}}$txt$,
  '{firstName,dashboardUrl}'
),
(
  'calc_followup',
  'Calculator — follow-up',
  '{{firstName}}, your numbers and next step',
  'automation',
  'active',
  $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">You ran the numbers — here is how to act on them.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">You ran the numbers, {{firstName}}</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">Thanks for using our calculator. The next step is the part that actually saves you money: let verified dealers compete on the out-the-door price instead of negotiating one at a time.</p>
          <p style="margin:0 0 8px;">
            <a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Start a request</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
  $txt${{firstName}}, you ran the numbers. Next step that saves money: let dealers compete on out-the-door price. Start: {{dashboardUrl}}$txt$,
  '{firstName,dashboardUrl}'
),
(
  'magnet_deliver',
  'Lead Magnet — deliver',
  'Here is your guide, {{firstName}}',
  'automation',
  'active',
  $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">Your guide is ready, plus how AutoLenis fits in.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">Your guide is ready</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">Thanks for downloading, {{firstName}} — your guide is attached/linked in your dashboard. When you are ready to act on it, AutoLenis is built to make the part it describes easier: dealers competing for you instead of the other way around.</p>
          <p style="margin:0 0 8px;">
            <a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Get my guide</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
  $txt${{firstName}}, your guide is ready in your dashboard. When you're ready to act on it, AutoLenis makes it easier. Get it: {{dashboardUrl}}$txt$,
  '{firstName,dashboardUrl}'
),
(
  'magnet_nurture',
  'Lead Magnet — nurture',
  '{{firstName}}, the part the guide leaves out',
  'automation',
  'active',
  $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">How to actually get dealers competing for your price.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">The part most guides skip</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">Most car-buying guides tell you to negotiate harder. AutoLenis takes a different path: verified dealers submit their best out-the-door offers and compete, so you compare instead of haggle.</p>
          <p style="margin:0 0 8px;">
            <a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">See how it works</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
  $txt${{firstName}}, most guides say negotiate harder. AutoLenis has dealers compete so you compare, not haggle. See how: {{dashboardUrl}}$txt$,
  '{firstName,dashboardUrl}'
),
(
  'zura_followup',
  'Zura — follow-up',
  'Picking up where we left off, {{firstName}}',
  'automation',
  'active',
  $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">Continue the conversation and let dealers compete.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">Where we left off</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">Thanks for chatting with Zura, {{firstName}}. Whenever you are ready, you can pick up right where you left off and let verified dealers compete for the vehicle you were exploring.</p>
          <p style="margin:0 0 8px;">
            <a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Continue</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
  $txt${{firstName}}, thanks for chatting with Zura. Pick up where you left off and let dealers compete: {{dashboardUrl}}$txt$,
  '{firstName,dashboardUrl}'
),
(
  'prequal_finish',
  'Prequal — finish',
  '{{firstName}}, finish your prequalification',
  'automation',
  'active',
  $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">A quick step so you can shop within your budget.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">Finish your prequalification</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">You started prequalifying, {{firstName}}. Completing it lets you shop within a budget that fits and helps dealers compete on realistic out-the-door numbers.</p>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">It is a soft check for shopping purposes. Finish whenever you are ready.</p>
          <p style="margin:0 0 8px;">
            <a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Finish prequalification</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
  $txt${{firstName}}, finish your prequalification so you can shop within your budget and let dealers compete on realistic numbers: {{dashboardUrl}}$txt$,
  '{firstName,dashboardUrl}'
),
(
  'prequal_education',
  'Prequal — education',
  'How prequalification helps you shop',
  'automation',
  'active',
  $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">What prequalifying does and does not do.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">How prequalifying helps</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">Prequalifying on AutoLenis is about shopping within a budget that fits you — it helps surface vehicles and offers in your range. It is a soft step for shopping and does not commit you to anything.</p>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">When you are ready, finishing it makes the rest of the process smoother.</p>
          <p style="margin:0 0 8px;">
            <a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Finish prequalification</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
  $txt${{firstName}}, prequalifying helps you shop within a budget that fits — a soft step, no commitment. Finish when ready: {{dashboardUrl}}$txt$,
  '{firstName,dashboardUrl}'
),
(
  'dealer_welcome',
  'Dealer — welcome',
  'Welcome to AutoLenis',
  'automation',
  'active',
  $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">Compete for ready-to-buy, budget-qualified buyers.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">Welcome to AutoLenis</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">Thanks for joining AutoLenis. We connect you with budget-qualified buyers who are ready to transact — you compete on out-the-door price and win business without spending on leads that go nowhere.</p>
          <p style="margin:0 0 8px;">
            <a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Complete my profile</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
  $txt$Welcome to AutoLenis. Compete for budget-qualified, ready-to-buy buyers. Complete your profile: {{dashboardUrl}}$txt$,
  '{firstName,dashboardUrl}'
),
(
  'dealer_profile',
  'Dealer — profile',
  'Finish your dealer profile',
  'automation',
  'active',
  $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">A complete profile means more auction invitations.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">Complete your profile</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">A complete profile — your inventory focus, coverage area, and details — means we can invite you to the auctions that fit you best. It takes just a few minutes.</p>
          <p style="margin:0 0 8px;">
            <a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Complete my profile</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
  $txt$Finish your AutoLenis dealer profile so we can invite you to the auctions that fit best. Complete it: {{dashboardUrl}}$txt$,
  '{firstName,dashboardUrl}'
),
(
  'dealer_auctions',
  'Dealer — join auctions',
  'Start competing in auctions',
  'automation',
  'active',
  $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">Submit your best out-the-door offers and win deals.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">Start competing</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">You are set up to receive auction invitations. When one fits, submit your best out-the-door offer — buyers compare on AutoLenis, so a strong, transparent number wins business.</p>
          <p style="margin:0 0 8px;">
            <a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">View open auctions</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
  $txt$You're set up for AutoLenis auctions. Submit strong out-the-door offers to win business. View open auctions: {{dashboardUrl}}$txt$,
  '{firstName,dashboardUrl}'
),
(
  'dealer_wins',
  'Dealer — increase wins',
  'How to win more on AutoLenis',
  'automation',
  'active',
  $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">A few patterns that help dealers win more auctions.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">Win more deals</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">Dealers who win consistently tend to respond quickly, lead with a clean out-the-door number, and keep their profile and inventory current. Your dashboard shows your performance so you can refine your approach.</p>
          <p style="margin:0 0 8px;">
            <a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">View my performance</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
  $txt$Win more on AutoLenis: respond fast, lead with a clean out-the-door number, keep inventory current. See your performance: {{dashboardUrl}}$txt$,
  '{firstName,dashboardUrl}'
),
(
  'aff_welcome',
  'Affiliate — welcome',
  'Welcome to the AutoLenis affiliate program',
  'automation',
  'active',
  $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">Earn by sending buyers to a platform that works for them.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">Welcome aboard, {{firstName}}</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">Thanks for joining the AutoLenis affiliate program. You earn by referring buyers to a platform built in their interest — dealers compete, buyers choose. Your dashboard has your referral link and tracking.</p>
          <p style="margin:0 0 8px;">
            <a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Get my referral link</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
  $txt$Welcome to the AutoLenis affiliate program, {{firstName}}. Get your referral link and tracking: {{dashboardUrl}}$txt$,
  '{firstName,dashboardUrl}'
),
(
  'aff_first_lead',
  'Affiliate — first lead',
  '{{firstName}}, get your first referral',
  'automation',
  'active',
  $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">Share your link and start tracking referrals.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">Get your first referral</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">The fastest start: share your referral link where car buyers already are. Every click and signup is tracked in your dashboard, so you can see exactly what is working.</p>
          <p style="margin:0 0 8px;">
            <a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">View my dashboard</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
  $txt${{firstName}}, get your first AutoLenis referral: share your link where buyers are. Track clicks and signups: {{dashboardUrl}}$txt$,
  '{firstName,dashboardUrl}'
),
(
  'aff_traffic',
  'Affiliate — traffic',
  'Driving traffic that converts',
  'automation',
  'active',
  $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">What kind of referrals tend to convert best.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">Traffic that converts</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">Referrals convert best when the buyer is actually in-market — people researching a specific vehicle or comparing prices. Content that speaks to that moment tends to perform.</p>
          <p style="margin:0 0 8px;">
            <a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">See my performance</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
  $txt${{firstName}}, in-market buyers convert best on AutoLenis — people comparing prices or researching a vehicle. See your performance: {{dashboardUrl}}$txt$,
  '{firstName,dashboardUrl}'
),
(
  'aff_commissions',
  'Affiliate — commissions',
  'How your commissions work',
  'automation',
  'active',
  $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">Tiered commissions, tracked transparently.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">How commissions work</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">Your commissions are tiered and tracked transparently in your dashboard — you can see referrals, conversions, and earnings as they happen. Payouts are processed on schedule.</p>
          <p style="margin:0 0 8px;">
            <a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">View my earnings</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
  $txt${{firstName}}, your AutoLenis commissions are tiered and tracked transparently. See referrals, conversions, and earnings: {{dashboardUrl}}$txt$,
  '{firstName,dashboardUrl}'
),
(
  'aff_scale',
  'Affiliate — scale',
  'Scaling your affiliate revenue',
  'automation',
  'active',
  $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">Patterns that help top affiliates grow.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">Scale your revenue</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">Affiliates who grow tend to test a few channels, double down on what converts, and keep their audience focused on in-market buyers. Your dashboard data shows where to lean in.</p>
          <p style="margin:0 0 8px;">
            <a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Review my data</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
  $txt${{firstName}}, scale your AutoLenis revenue: test channels, double down on what converts, focus on in-market buyers. See your data: {{dashboardUrl}}$txt$,
  '{firstName,dashboardUrl}'
),
(
  'winback_1',
  'Win-back — touch 1',
  '{{firstName}}, your dealers are still ready',
  'automation',
  'active',
  $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">Pick up where you left off and let dealers compete.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">Still here when you are, {{firstName}}</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">You started exploring on AutoLenis but have not finished. Whenever you are ready, you can pick up where you left off and let verified dealers compete for your business — no pressure, no obligation.</p>
          <p style="margin:0 0 8px;">
            <a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Pick up where I left off</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
  $txt${{firstName}}, you started on AutoLenis but didn't finish. Pick up anytime and let dealers compete — no pressure: {{dashboardUrl}}$txt$,
  '{firstName,dashboardUrl}'
),
(
  'winback_2',
  'Win-back — touch 2',
  'Still thinking it over, {{firstName}}?',
  'automation',
  'active',
  $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">No rush — here is what is waiting when you are ready.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">No rush, {{firstName}}</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">Buying a car is a big decision and there is no rush. When you are ready, AutoLenis is here: tell us what you want, and verified dealers compete for it while you stay in control.</p>
          <p style="margin:0 0 8px;">
            <a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Start when ready</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
  $txt${{firstName}}, no rush on your car search. When ready, AutoLenis has dealers compete while you stay in control: {{dashboardUrl}}$txt$,
  '{firstName,dashboardUrl}'
),
(
  'postclose_d7_survey',
  'Post-close — D7 survey',
  'How did it go, {{firstName}}?',
  'transactional',
  'active',
  $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">A quick note on your AutoLenis experience.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">How did it go, {{firstName}}?</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">Congratulations on your vehicle. We would love to hear how the AutoLenis experience went — your feedback helps us make it better for the next buyer.</p>
          <p style="margin:0 0 8px;">
            <a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Share my feedback</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
  $txt$Congrats on your vehicle, {{firstName}}! How did the AutoLenis experience go? Share quick feedback: {{dashboardUrl}}$txt$,
  '{firstName,dashboardUrl}'
),
(
  'postclose_d30_review',
  'Post-close — D30 review',
  '{{firstName}}, would you share your experience?',
  'automation',
  'active',
  $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">A short review helps other buyers.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">Would you share your experience?</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">Now that you have had your vehicle for a few weeks, {{firstName}}, would you consider sharing a short review? Honest experiences from real buyers help others decide whether AutoLenis is right for them.</p>
          <p style="margin:0 0 8px;">
            <a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Leave a review</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
  $txt${{firstName}}, would you share a short review of your AutoLenis experience? It helps other buyers: {{dashboardUrl}}$txt$,
  '{firstName,dashboardUrl}'
),
(
  'postclose_d60_referral',
  'Post-close — D60 referral',
  'Know someone car shopping, {{firstName}}?',
  'automation',
  'active',
  $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">Share AutoLenis with someone who would use it.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">Know someone shopping?</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">If someone you know is shopping for a car, {{firstName}}, sending them to AutoLenis means they get the same buyer-first experience you did — dealers competing for them.</p>
          <p style="margin:0 0 8px;">
            <a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Refer a friend</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
  $txt${{firstName}}, know someone car shopping? Send them to AutoLenis for the same buyer-first experience: {{dashboardUrl}}$txt$,
  '{firstName,dashboardUrl}'
),
(
  'postclose_d180_upgrade',
  'Post-close — D180 check-in',
  'Checking in on your vehicle, {{firstName}}',
  'automation',
  'active',
  $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">How is everything six months in?</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">Six months in, {{firstName}}</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">Just checking in on how your vehicle is treating you. If your situation has changed — a refinance question, a second vehicle, a trade — AutoLenis is here whenever you need it.</p>
          <p style="margin:0 0 8px;">
            <a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">Explore my options</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
  $txt${{firstName}}, six months in — how's your vehicle? If anything's changed (refi, second car, trade), AutoLenis is here: {{dashboardUrl}}$txt$,
  '{firstName,dashboardUrl}'
),
(
  'postclose_d365_replacement',
  'Post-close — D365 anniversary',
  'One year in, {{firstName}}',
  'automation',
  'active',
  $html$<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">Whatever is next, dealers can compete for it.</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">One year already, {{firstName}}</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">It has been a year since your AutoLenis purchase. Whatever is next — an upgrade, a second vehicle, or helping someone in your household shop — verified dealers can compete for it the same way they did for you.</p>
          <p style="margin:0 0 8px;">
            <a href="{{dashboardUrl}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">See what is possible</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>$html$,
  $txt${{firstName}}, it's been a year! Whatever's next — upgrade, second car, helping family shop — AutoLenis has dealers compete: {{dashboardUrl}}$txt$,
  '{firstName,dashboardUrl}'
)
ON CONFLICT (template_key) DO NOTHING;


-- Seed v1 of the version history for any rows just inserted; rows that
-- already existed keep their existing version history (ON CONFLICT skips).
INSERT INTO email_template_versions (template_id, version, subject, html_body, text_body)
SELECT t.id, t.version, t.subject, t.html_body, t.text_body
FROM email_templates t
WHERE t.template_key IN (
  'vr_received',
  'auction_live',
  'offer_in',
  'offer_multiple',
  'deal_formed',
  'deposit_confirmed',
  'contract_signed',
  'trade_in_value',
  'trade_in_equity',
  'trade_in_upgrade',
  'refi_review',
  'refi_savings',
  'refi_options',
  'saved_search_confirm',
  'calc_followup',
  'magnet_deliver',
  'magnet_nurture',
  'zura_followup',
  'prequal_finish',
  'prequal_education',
  'dealer_welcome',
  'dealer_profile',
  'dealer_auctions',
  'dealer_wins',
  'aff_welcome',
  'aff_first_lead',
  'aff_traffic',
  'aff_commissions',
  'aff_scale',
  'winback_1',
  'winback_2',
  'postclose_d7_survey',
  'postclose_d30_review',
  'postclose_d60_referral',
  'postclose_d180_upgrade',
  'postclose_d365_replacement'
)
ON CONFLICT (template_id, version) DO NOTHING;

COMMIT;
