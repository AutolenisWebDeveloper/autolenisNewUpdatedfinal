#!/usr/bin/env python3
"""
Generates frontend/migrations/09_nurture_templates_all.sql (email templates)
for the full AutoLenis nurture campaign set. Copy lives as data; the proven
HTML shell from 05_lp_recovery / 08_welcome is applied once. Compliance baked in:
- no guarantees/promises, no invented stats, no fabricated testimonials
- prequal/refinance: no decision/approval/rate guarantees
- footer (unsubscribe + CAN-SPAM physical address) is injected at RENDER time by
  TemplateService.renderInline. That helper appends the footer only when the
  template does NOT already contain the <!-- autolenis:footer:v1 --> signature
  (hasFooter()). So we deliberately DO NOT emit that marker here — leaving it out
  is what lets the platform stamp the real footer. (Baking the bare marker with
  no footer body, as an earlier draft did, would suppress the footer and ship
  emails with no unsubscribe link.)

Run from anywhere; writes alongside this file.
"""

import os

SHELL = """<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">{preheader}</span>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#0B5FD1;text-transform:uppercase;">AutoLenis</p>
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0f172a;font-weight:700;">{h1}</h1>
{body}
          <p style="margin:0 0 8px;">
            <a href="{{{{{cta_var}}}}}" style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;font-size:15px;">{cta}</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>"""

def para(text, bold_lead=None):
    if bold_lead:
        return f'          <p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#334155;"><strong>{bold_lead}</strong> {text}</p>'
    return f'          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155;">{text}</p>'

# Each template: key, name, subject, category, preheader, h1, [paras], cta, cta_var, variables, text
T = []
def add(key, name, subject, category, preheader, h1, paras, cta, cta_var, variables, text):
    T.append(dict(key=key, name=name, subject=subject, category=category,
                  preheader=preheader, h1=h1, paras=paras, cta=cta,
                  cta_var=cta_var, variables=variables, text=text))

# ---- Vehicle Request lifecycle (transactional — buyer-initiated active deal) ----
add('vr_received','Vehicle Request — received','{{firstName}}, your request is in','transactional',
    'We are inviting verified dealers to compete for your vehicle.',
    'Your request is in, {{firstName}}',
    [para('We have your request and are inviting verified dealers to compete for it. You will be notified the moment your auction opens and offers start coming in.'),
     para('You stay anonymous until you choose an offer — no calls, no pressure during the process.')],
    'View my request','dashboardUrl','{firstName,dashboardUrl}',
    "Your request is in, {{firstName}}. We're inviting verified dealers to compete. You'll be notified when your auction opens and offers arrive. View it: {{dashboardUrl}}")

add('auction_live','Auction — live','Your auction is live, {{firstName}}','transactional',
    'Dealers are now competing for your vehicle.',
    'Your auction is live',
    [para('Hi {{firstName}}, your auction is open and verified dealers are competing for your vehicle right now. Offers will appear in your dashboard as they come in.')],
    'Watch my auction','auctionUrl','{firstName,auctionUrl}',
    "Hi {{firstName}}, your AutoLenis auction is live and dealers are competing now. Watch offers come in: {{auctionUrl}}")

add('offer_in','Offer — received','You have a new offer, {{firstName}}','transactional',
    'A dealer just submitted an out-the-door offer.',
    'You have a new offer',
    [para('A verified dealer just submitted an out-the-door offer in your auction. Open your dashboard to see the full breakdown — price, fees, and financing options.'),
     para('There is no obligation to accept. You choose if and when an offer works for you.')],
    'See my offer','offerUrl','{firstName,offerUrl}',
    "{{firstName}}, you have a new out-the-door offer in your AutoLenis auction. See the full breakdown: {{offerUrl}}")

add('offer_multiple','Offer — multiple received','{{firstName}}, dealers are competing','transactional',
    'You have multiple offers to compare side by side.',
    'Multiple offers are in',
    [para('More than one dealer has submitted an offer. This is where AutoLenis works for you — compare them side by side and pick the one that fits, on your terms.')],
    'Compare offers','offerUrl','{firstName,offerUrl}',
    "{{firstName}}, multiple dealers have submitted offers in your auction. Compare them side by side: {{offerUrl}}")

add('deal_formed','Deal — formed','Next steps for your vehicle, {{firstName}}','transactional',
    'You selected an offer — here is what happens next.',
    'You picked an offer',
    [para('Great choice, {{firstName}}. Now we coordinate the rest: financing, your concierge fee, insurance, contract review, and pickup. Your dashboard walks you through each step.'),
     para('You stay in control the whole way — nothing finalizes without your sign-off.')],
    'Continue my deal','dashboardUrl','{firstName,dashboardUrl}',
    "{{firstName}}, you selected an offer. Next: financing, insurance, contract review, and pickup. Continue: {{dashboardUrl}}")

add('deposit_confirmed','Deposit — confirmed','Your deposit is confirmed','transactional',
    'Your deposit is in and your auction can proceed.',
    'Deposit confirmed',
    [para('Thanks, {{firstName}} — your deposit is confirmed and your auction can proceed. This keeps your request active and signals to dealers that you are a serious buyer.')],
    'Go to my dashboard','dashboardUrl','{firstName,dashboardUrl}',
    "{{firstName}}, your AutoLenis deposit is confirmed and your auction can proceed. Dashboard: {{dashboardUrl}}")

add('contract_signed','Contract — signed','Your contract is signed, {{firstName}}','transactional',
    'Signed and saved — pickup is the last step.',
    'Your contract is signed',
    [para('Your contract is signed and saved, {{firstName}}. The last step is arranging pickup or delivery. Your dashboard has the details and your pickup confirmation.')],
    'View pickup details','dashboardUrl','{firstName,dashboardUrl}',
    "{{firstName}}, your AutoLenis contract is signed. Last step is pickup — details here: {{dashboardUrl}}")

# ---- Trade-In (marketing nurture) ----
add('trade_in_value','Trade-In — value','{{firstName}}, about your trade-in','automation',
    'Here is how your trade-in fits into a smarter purchase.',
    'Your trade-in, {{firstName}}',
    [para('Thanks for sharing your trade-in details. On AutoLenis, your trade can factor into the offers dealers compete with — which means it works for you rather than getting buried in negotiation.')],
    'See my options','dashboardUrl','{firstName,dashboardUrl}',
    "{{firstName}}, thanks for your trade-in details. On AutoLenis your trade factors into the offers dealers compete with. See options: {{dashboardUrl}}")

add('trade_in_equity','Trade-In — equity','Understanding your trade-in equity','automation',
    'A quick look at how trade equity affects your next vehicle.',
    'Trade equity, explained',
    [para('Hi {{firstName}} — the difference between what your current vehicle is worth and what you owe is your equity, and it can lower what you finance on your next one.'),
     para('When dealers compete on AutoLenis, they factor this in transparently, so you can see the real out-the-door picture.')],
    'Explore my options','dashboardUrl','{firstName,dashboardUrl}',
    "{{firstName}}, your trade equity can lower what you finance next. On AutoLenis dealers factor it in transparently. Explore: {{dashboardUrl}}")

add('trade_in_upgrade','Trade-In — upgrade','Ready to put your trade to work?','automation',
    'Turn your current vehicle into your next one.',
    'Put your trade to work, {{firstName}}',
    [para('When you are ready, start a request and let verified dealers compete — with your trade factored in. There is no obligation to accept any offer.')],
    'Start my request','dashboardUrl','{firstName,dashboardUrl}',
    "{{firstName}}, ready to put your trade to work? Start a request and let dealers compete: {{dashboardUrl}}")

# ---- Refinance (marketing — NO guaranteed rate/savings, FCRA-mindful) ----
add('refi_review','Refinance — review','{{firstName}}, a look at your auto loan','automation',
    'See whether refinancing could fit your situation.',
    'A look at your loan, {{firstName}}',
    [para('Thanks for your interest in refinancing. Refinancing replaces your current auto loan with a new one — depending on rates and your situation, it may change your monthly payment or term.'),
     para('We can help you explore options. Whether it makes sense depends on your specifics, and there is no obligation.')],
    'Explore refinancing','dashboardUrl','{firstName,dashboardUrl}',
    "{{firstName}}, refinancing replaces your current auto loan with a new one and may change your payment or term. Explore options (no obligation): {{dashboardUrl}}")

add('refi_savings','Refinance — payment','How refinancing can change your payment','automation',
    'Lower rate, different term — here is how the math can work.',
    'How the math can work',
    [para('Hi {{firstName}} — a refinance can affect your payment two ways: through the interest rate and through the loan term. A different term changes monthly cost and total interest over the life of the loan.'),
     para('Actual terms depend on your credit and lender. We are not a lender; we help you compare. Nothing here is a guaranteed rate or outcome.')],
    'See my options','dashboardUrl','{firstName,dashboardUrl}',
    "{{firstName}}, a refinance can change your payment via rate and term. Actual terms depend on your situation. Compare options: {{dashboardUrl}}")

add('refi_options','Refinance — options','Ready to explore refinancing?','automation',
    'Compare without obligation.',
    'Explore when you are ready',
    [para('When you want to look at refinancing options, we can help you compare. You are never obligated to proceed, and we will always be straight with you about what does and does not make sense.')],
    'Explore refinancing','dashboardUrl','{firstName,dashboardUrl}',
    "{{firstName}}, when you're ready to explore refinancing, we can help you compare — no obligation. Start here: {{dashboardUrl}}")

# ---- Saved search (transactional confirm) ----
add('saved_search_confirm','Saved Search — confirmed','Your search is saved, {{firstName}}','transactional',
    'We will let you know when matching vehicles appear.',
    'Search saved',
    [para('Got it, {{firstName}} — your search is saved. When vehicles matching it become available, we will let you know so you can start a request and let dealers compete.')],
    'View my searches','dashboardUrl','{firstName,dashboardUrl}',
    "{{firstName}}, your search is saved. We'll alert you when matching vehicles appear. View searches: {{dashboardUrl}}")

# ---- Calculator follow-up (marketing) ----
add('calc_followup','Calculator — follow-up','{{firstName}}, your numbers and next step','automation',
    'You ran the numbers — here is how to act on them.',
    'You ran the numbers, {{firstName}}',
    [para('Thanks for using our calculator. The next step is the part that actually saves you money: let verified dealers compete on the out-the-door price instead of negotiating one at a time.')],
    'Start a request','dashboardUrl','{firstName,dashboardUrl}',
    "{{firstName}}, you ran the numbers. Next step that saves money: let dealers compete on out-the-door price. Start: {{dashboardUrl}}")

# ---- Lead magnet (marketing) ----
add('magnet_deliver','Lead Magnet — deliver','Here is your guide, {{firstName}}','automation',
    'Your guide is ready, plus how AutoLenis fits in.',
    'Your guide is ready',
    [para('Thanks for downloading, {{firstName}} — your guide is attached/linked in your dashboard. When you are ready to act on it, AutoLenis is built to make the part it describes easier: dealers competing for you instead of the other way around.')],
    'Get my guide','dashboardUrl','{firstName,dashboardUrl}',
    "{{firstName}}, your guide is ready in your dashboard. When you're ready to act on it, AutoLenis makes it easier. Get it: {{dashboardUrl}}")

add('magnet_nurture','Lead Magnet — nurture','{{firstName}}, the part the guide leaves out','automation',
    'How to actually get dealers competing for your price.',
    'The part most guides skip',
    [para('Most car-buying guides tell you to negotiate harder. AutoLenis takes a different path: verified dealers submit their best out-the-door offers and compete, so you compare instead of haggle.')],
    'See how it works','dashboardUrl','{firstName,dashboardUrl}',
    "{{firstName}}, most guides say negotiate harder. AutoLenis has dealers compete so you compare, not haggle. See how: {{dashboardUrl}}")

# ---- Zura (marketing) ----
add('zura_followup','Zura — follow-up','Picking up where we left off, {{firstName}}','automation',
    'Continue the conversation and let dealers compete.',
    'Where we left off',
    [para('Thanks for chatting with Zura, {{firstName}}. Whenever you are ready, you can pick up right where you left off and let verified dealers compete for the vehicle you were exploring.')],
    'Continue','dashboardUrl','{firstName,dashboardUrl}',
    "{{firstName}}, thanks for chatting with Zura. Pick up where you left off and let dealers compete: {{dashboardUrl}}")

# ---- Prequal (FCRA-safe: NO score/decision/approval language) ----
add('prequal_finish','Prequal — finish','{{firstName}}, finish your prequalification','automation',
    'A quick step so you can shop within your budget.',
    'Finish your prequalification',
    [para('You started prequalifying, {{firstName}}. Completing it lets you shop within a budget that fits and helps dealers compete on realistic out-the-door numbers.'),
     para('It is a soft check for shopping purposes. Finish whenever you are ready.')],
    'Finish prequalification','dashboardUrl','{firstName,dashboardUrl}',
    "{{firstName}}, finish your prequalification so you can shop within your budget and let dealers compete on realistic numbers: {{dashboardUrl}}")

add('prequal_education','Prequal — education','How prequalification helps you shop','automation',
    'What prequalifying does and does not do.',
    'How prequalifying helps',
    [para('Prequalifying on AutoLenis is about shopping within a budget that fits you — it helps surface vehicles and offers in your range. It is a soft step for shopping and does not commit you to anything.'),
     para('When you are ready, finishing it makes the rest of the process smoother.')],
    'Finish prequalification','dashboardUrl','{firstName,dashboardUrl}',
    "{{firstName}}, prequalifying helps you shop within a budget that fits — a soft step, no commitment. Finish when ready: {{dashboardUrl}}")

# ---- Dealer (B2B automation) ----
add('dealer_welcome','Dealer — welcome','Welcome to AutoLenis','automation',
    'Compete for ready-to-buy, budget-qualified buyers.',
    'Welcome to AutoLenis',
    [para('Thanks for joining AutoLenis. We connect you with budget-qualified buyers who are ready to transact — you compete on out-the-door price and win business without spending on leads that go nowhere.')],
    'Complete my profile','dashboardUrl','{firstName,dashboardUrl}',
    "Welcome to AutoLenis. Compete for budget-qualified, ready-to-buy buyers. Complete your profile: {{dashboardUrl}}")

add('dealer_profile','Dealer — profile','Finish your dealer profile','automation',
    'A complete profile means more auction invitations.',
    'Complete your profile',
    [para('A complete profile — your inventory focus, coverage area, and details — means we can invite you to the auctions that fit you best. It takes just a few minutes.')],
    'Complete my profile','dashboardUrl','{firstName,dashboardUrl}',
    "Finish your AutoLenis dealer profile so we can invite you to the auctions that fit best. Complete it: {{dashboardUrl}}")

add('dealer_auctions','Dealer — join auctions','Start competing in auctions','automation',
    'Submit your best out-the-door offers and win deals.',
    'Start competing',
    [para('You are set up to receive auction invitations. When one fits, submit your best out-the-door offer — buyers compare on AutoLenis, so a strong, transparent number wins business.')],
    'View open auctions','dashboardUrl','{firstName,dashboardUrl}',
    "You're set up for AutoLenis auctions. Submit strong out-the-door offers to win business. View open auctions: {{dashboardUrl}}")

add('dealer_wins','Dealer — increase wins','How to win more on AutoLenis','automation',
    'A few patterns that help dealers win more auctions.',
    'Win more deals',
    [para('Dealers who win consistently tend to respond quickly, lead with a clean out-the-door number, and keep their profile and inventory current. Your dashboard shows your performance so you can refine your approach.')],
    'View my performance','dashboardUrl','{firstName,dashboardUrl}',
    "Win more on AutoLenis: respond fast, lead with a clean out-the-door number, keep inventory current. See your performance: {{dashboardUrl}}")

# ---- Affiliate (automation) ----
add('aff_welcome','Affiliate — welcome','Welcome to the AutoLenis affiliate program','automation',
    'Earn by sending buyers to a platform that works for them.',
    'Welcome aboard, {{firstName}}',
    [para('Thanks for joining the AutoLenis affiliate program. You earn by referring buyers to a platform built in their interest — dealers compete, buyers choose. Your dashboard has your referral link and tracking.')],
    'Get my referral link','dashboardUrl','{firstName,dashboardUrl}',
    "Welcome to the AutoLenis affiliate program, {{firstName}}. Get your referral link and tracking: {{dashboardUrl}}")

add('aff_first_lead','Affiliate — first lead','{{firstName}}, get your first referral','automation',
    'Share your link and start tracking referrals.',
    'Get your first referral',
    [para('The fastest start: share your referral link where car buyers already are. Every click and signup is tracked in your dashboard, so you can see exactly what is working.')],
    'View my dashboard','dashboardUrl','{firstName,dashboardUrl}',
    "{{firstName}}, get your first AutoLenis referral: share your link where buyers are. Track clicks and signups: {{dashboardUrl}}")

add('aff_traffic','Affiliate — traffic','Driving traffic that converts','automation',
    'What kind of referrals tend to convert best.',
    'Traffic that converts',
    [para('Referrals convert best when the buyer is actually in-market — people researching a specific vehicle or comparing prices. Content that speaks to that moment tends to perform.')],
    'See my performance','dashboardUrl','{firstName,dashboardUrl}',
    "{{firstName}}, in-market buyers convert best on AutoLenis — people comparing prices or researching a vehicle. See your performance: {{dashboardUrl}}")

add('aff_commissions','Affiliate — commissions','How your commissions work','automation',
    'Tiered commissions, tracked transparently.',
    'How commissions work',
    [para('Your commissions are tiered and tracked transparently in your dashboard — you can see referrals, conversions, and earnings as they happen. Payouts are processed on schedule.')],
    'View my earnings','dashboardUrl','{firstName,dashboardUrl}',
    "{{firstName}}, your AutoLenis commissions are tiered and tracked transparently. See referrals, conversions, and earnings: {{dashboardUrl}}")

add('aff_scale','Affiliate — scale','Scaling your affiliate revenue','automation',
    'Patterns that help top affiliates grow.',
    'Scale your revenue',
    [para('Affiliates who grow tend to test a few channels, double down on what converts, and keep their audience focused on in-market buyers. Your dashboard data shows where to lean in.')],
    'Review my data','dashboardUrl','{firstName,dashboardUrl}',
    "{{firstName}}, scale your AutoLenis revenue: test channels, double down on what converts, focus on in-market buyers. See your data: {{dashboardUrl}}")

# ---- Win-back (marketing) ----
add('winback_1','Win-back — touch 1','{{firstName}}, your dealers are still ready','automation',
    'Pick up where you left off and let dealers compete.',
    'Still here when you are, {{firstName}}',
    [para('You started exploring on AutoLenis but have not finished. Whenever you are ready, you can pick up where you left off and let verified dealers compete for your business — no pressure, no obligation.')],
    'Pick up where I left off','dashboardUrl','{firstName,dashboardUrl}',
    "{{firstName}}, you started on AutoLenis but didn't finish. Pick up anytime and let dealers compete — no pressure: {{dashboardUrl}}")

add('winback_2','Win-back — touch 2','Still thinking it over, {{firstName}}?','automation',
    'No rush — here is what is waiting when you are ready.',
    'No rush, {{firstName}}',
    [para('Buying a car is a big decision and there is no rush. When you are ready, AutoLenis is here: tell us what you want, and verified dealers compete for it while you stay in control.')],
    'Start when ready','dashboardUrl','{firstName,dashboardUrl}',
    "{{firstName}}, no rush on your car search. When ready, AutoLenis has dealers compete while you stay in control: {{dashboardUrl}}")

# ---- Post-close (mix) ----
add('postclose_d7_survey','Post-close — D7 survey','How did it go, {{firstName}}?','transactional',
    'A quick note on your AutoLenis experience.',
    'How did it go, {{firstName}}?',
    [para('Congratulations on your vehicle. We would love to hear how the AutoLenis experience went — your feedback helps us make it better for the next buyer.')],
    'Share my feedback','dashboardUrl','{firstName,dashboardUrl}',
    "Congrats on your vehicle, {{firstName}}! How did the AutoLenis experience go? Share quick feedback: {{dashboardUrl}}")

add('postclose_d30_review','Post-close — D30 review','{{firstName}}, would you share your experience?','automation',
    'A short review helps other buyers.',
    'Would you share your experience?',
    [para('Now that you have had your vehicle for a few weeks, {{firstName}}, would you consider sharing a short review? Honest experiences from real buyers help others decide whether AutoLenis is right for them.')],
    'Leave a review','dashboardUrl','{firstName,dashboardUrl}',
    "{{firstName}}, would you share a short review of your AutoLenis experience? It helps other buyers: {{dashboardUrl}}")

add('postclose_d60_referral','Post-close — D60 referral','Know someone car shopping, {{firstName}}?','automation',
    'Share AutoLenis with someone who would use it.',
    'Know someone shopping?',
    [para('If someone you know is shopping for a car, {{firstName}}, sending them to AutoLenis means they get the same buyer-first experience you did — dealers competing for them.')],
    'Refer a friend','dashboardUrl','{firstName,dashboardUrl}',
    "{{firstName}}, know someone car shopping? Send them to AutoLenis for the same buyer-first experience: {{dashboardUrl}}")

add('postclose_d180_upgrade','Post-close — D180 check-in','Checking in on your vehicle, {{firstName}}','automation',
    'How is everything six months in?',
    'Six months in, {{firstName}}',
    [para('Just checking in on how your vehicle is treating you. If your situation has changed — a refinance question, a second vehicle, a trade — AutoLenis is here whenever you need it.')],
    'Explore my options','dashboardUrl','{firstName,dashboardUrl}',
    "{{firstName}}, six months in — how's your vehicle? If anything's changed (refi, second car, trade), AutoLenis is here: {{dashboardUrl}}")

add('postclose_d365_replacement','Post-close — D365 anniversary','One year in, {{firstName}}','automation',
    'Whatever is next, dealers can compete for it.',
    'One year already, {{firstName}}',
    [para('It has been a year since your AutoLenis purchase. Whatever is next — an upgrade, a second vehicle, or helping someone in your household shop — verified dealers can compete for it the same way they did for you.')],
    'See what is possible','dashboardUrl','{firstName,dashboardUrl}',
    "{{firstName}}, it's been a year! Whatever's next — upgrade, second car, helping family shop — AutoLenis has dealers compete: {{dashboardUrl}}")


def esc(s):  # escape single quotes for SQL literals
    return s.replace("'", "''")

def variables_array(spec):
    # spec like '{firstName,dashboardUrl}' -> ARRAY['firstName','dashboardUrl']
    names = [n.strip() for n in spec.strip('{}').split(',') if n.strip()]
    return "ARRAY[" + ",".join(f"'{esc(n)}'" for n in names) + "]"

def build_html(t):
    # t['paras'] already holds rendered <p>…</p> strings (built via para() in
    # each add() call), so join them as-is — wrapping again would nest <p>s.
    body = "\n".join(t['paras'])
    return SHELL.format(preheader=esc(t['preheader']), h1=esc(t['h1']), body=body,
                        cta=esc(t['cta']), cta_var=t['cta_var'])

rows = []
for t in T:
    html = build_html(t)
    rows.append(
        "  (\n"
        f"    '{t['key']}',\n"
        f"    '{esc(t['name'])}',\n"
        f"    '{esc(t['subject'])}',\n"
        f"    '{t['category']}',\n"
        f"    'active',\n"
        f"    $html${html}$html$,\n"
        f"    $txt${t['text']}$txt$,\n"
        f"    {variables_array(t['variables'])}\n"
        "  )"
    )

keys_list = ",\n".join(f"  '{t['key']}'" for t in T)

sql = []
sql.append("-- ============================================================================")
sql.append("-- 09_nurture_templates_all.sql")
sql.append("-- Full nurture email-template set for all remaining campaigns.")
sql.append("-- Generated from gen_campaigns.py (copy-as-data + shared shell).")
sql.append("-- Pairs with 08 (Welcome) and 05 (LP recovery, already seeded).")
sql.append("-- Idempotent; CAN-SPAM footer (unsubscribe + physical address) is appended at")
sql.append("-- render time by TemplateService.renderInline, so no footer is baked in here.")
sql.append("-- ============================================================================")
sql.append("")
sql.append("BEGIN;")
sql.append("")
sql.append("-- template_key may already exist (added in 05); keep idempotent.")
sql.append("ALTER TABLE email_templates")
sql.append("  ADD COLUMN IF NOT EXISTS template_key TEXT;")
sql.append("")
sql.append("CREATE UNIQUE INDEX IF NOT EXISTS idx_email_templates_template_key")
sql.append("  ON email_templates(template_key)")
sql.append("  WHERE template_key IS NOT NULL;")
sql.append("")
sql.append("INSERT INTO email_templates")
sql.append("  (template_key, name, subject, category, status, html_body, text_body, variables)")
sql.append("VALUES")
sql.append(",\n".join(rows))
# Restate the partial index predicate so ON CONFLICT can infer the partial
# unique index on template_key.
sql.append("ON CONFLICT (template_key) WHERE template_key IS NOT NULL DO NOTHING;")
sql.append("")
sql.append("-- Seed v1 of the version history for any rows we just inserted. Skipped for")
sql.append("-- rows that already existed (the version row already exists too).")
sql.append("INSERT INTO email_template_versions (template_id, version, subject, html_body, text_body)")
sql.append("SELECT t.id, t.version, t.subject, t.html_body, t.text_body")
sql.append("FROM email_templates t")
sql.append("WHERE t.template_key IN (")
sql.append(keys_list)
sql.append(")")
sql.append("ON CONFLICT (template_id, version) DO NOTHING;")
sql.append("")
sql.append("COMMIT;")
sql.append("")

out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        '09_nurture_templates_all.sql')
with open(out_path, 'w') as f:
    f.write("\n".join(sql))

print(f"Templates generated: {len(T)}")
print("Campaigns covered:", len(set(t['key'].split('_')[0] for t in T)))
print(f"Wrote {out_path}")
