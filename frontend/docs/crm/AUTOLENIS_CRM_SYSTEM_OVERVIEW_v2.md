# AutoLenis CRM, Lead Capture, Email, SMS & Marketing Automation System
## Complete System Overview (AutoLenis + Make.com Architecture) — v2.0 (Updated)

**Date:** 2026-06-16 · **Owner:** Markist Athelus · **Status:** Authoritative
**Legend:** `[BUILT]` verified in place · `[PARTIAL]` partly in place · `[NOT BUILT]` designed only · `[DEFERRED]` out of scope until traffic · `[TARGET]` intended end state.
**⚠ Event Binding Rule (non-negotiable):** every Router branch, Processor lookup, and scoring rule must key off an event name **verified to be emitted by the codebase**. The event lists here are the target surface, not the current emitted set; the authoritative event→emission map comes from the pending repo audit.

---

## Executive Summary

The AutoLenis CRM, Lead Capture, Email, SMS, and Marketing Automation System is the central intelligence, communication, nurturing, retention, attribution, and revenue engine of the AutoLenis platform.

Its purpose is to ensure that every visitor, buyer, dealer, affiliate, partner, and prospect who interacts with AutoLenis is automatically identified, tracked, scored, segmented, nurtured, converted, retained, and attributed across their entire lifecycle.

Fundamental principle:

> **No qualified lead should ever be lost due to lack of follow-up, communication, nurturing, engagement, or automation.**

Every meaningful action is evaluated for lead generation, nurturing, conversion, revenue, retention, referral, dealer-acquisition, affiliate-growth, and customer-success opportunities. The end goal is a fully automated behavioral marketing engine that continuously advances users to their next lifecycle stage with minimal manual intervention.

**Current reality (anchor):** zero live dealers, zero revenue. The spine — Router + Processor + content — is built; **event coverage and the first dealer are the gates**, not additional campaigns or the intelligence tail. This document is the destination, with current state marked throughout.

---

## System Architecture

Three primary layers.

### Layer 1 — AutoLenis (System of Record) [BUILT]
Owns: contact database, CRM records, buyers, dealers, affiliates, vehicle requests, auctions, offers, deals, consent records, SMS opt-outs, email suppression, lead scoring, revenue attribution, audit logs, communication history, compliance controls. **AutoLenis is the source of truth.**

### Layer 2 — Make.com (Automation Brain) [BUILT]
Owns: workflow orchestration, campaign routing, sequencing, delays, branching, re-engagement logic, campaign progression, enrollment management. Decides what happens next, when, which campaign, which message, which task.
**Make never owns customer data. Make never sends email or SMS directly.**

### Layer 3 — Delivery Infrastructure [BUILT]
Email → Resend · SMS → Twilio · Tasks → AutoLenis CRM · Notifications → AutoLenis CRM.

**Iron rule:** every communication passes through AutoLenis before delivery, guaranteeing TCPA, CAN-SPAM, consent enforcement, suppression enforcement, audit logging, and attribution. Make holds no delivery credentials. This must never be relaxed.

### Live Infrastructure Registry (operational truth) [BUILT]
**Make:** Org *AutoLenis* `7865508` (us2) · Team *My Team* `2374031`

| Resource | ID / Locator | State |
|---|---|---|
| Router — Event → Enrollment | scenario `5355993` (hook `2439911`) | ON (webhook); ⚠ no inbound HMAC |
| Router webhook URL | `https://hook.us2.make.com/xzcpxlr10rj962t5cm7pma2g8v4srtcf` | live |
| Processor — KEEPER (echo) | scenario `5410176` | **OFF — reactivate**; logic corrected |
| Processor — retired (4-module) | scenario `5410246` | OFF |
| Processor — retired (real-endpoint ref) | scenario `5410025` | OFF (contract reference) |
| Cadence data store | `108892` (structure `402431`) | welcome 1–5 seeded |
| Enrollment data store | `108287` | test records only |
| Supabase echo receiver | fn `crm-dispatch-echo-test` (proj `aieybibvewmvrubcpthm`) | test only — remove before prod |

**Cadence schema (108892):** `campaign, step, template_key, channel, offset_hours, is_last` — `offset_hours` is **delta** (hours to wait after this step). Advance: `due_at = now + current.offset_hours`.
**Enrollment schema (108287):** key `campaign:contact_id`; `contact_id, email, phone, campaign, next_step, due_at, status(active|completed|suppressed), enrolled_at`.
**Dispatch contract** *(agent-derived; confirm in repo audit):* `POST https://www.autolenis.com/api/crm/dispatch/email` (and `/sms`), header `X-Dispatch-Key: <CRM_DISPATCH_KEY>` (static), body `{contactId, email, templateKey, campaign, step, idempotencyKey}`.
**Env (Vercel, Sensitive):** `CRM_DISPATCH_KEY`, `CRM_DISPATCH_SECRET` (outbound HMAC — confirm), `MAKE_WEBHOOK_URL`, `MAKE_WEBHOOK_SECRET`, `CRM_INAPP_ENGINE_ENABLED`, **`AUTOLENIS_PHYSICAL_ADDRESS` (must be set — CAN-SPAM)**, `CRON_SECRET`.

---

## Lead Capture System [PARTIAL — coverage is the gating work]

Captures prospects from every source; each source **must emit a verified event** to enter the engine.

### Visitor Lead Sources
- **Landing pages:** name, email, phone, vehicle interest, source campaign, UTM.
- **Exit-intent popups:** email, vehicle interest.
- **Newsletter signups:** email, interest categories.
- **Lead magnets:** name, email, phone, content category (dealer-fee, financing, trade-in, refinance guides).
- **Blog articles:** article viewed, category, time spent, scroll depth.
- **Vehicle search:** makes, models, budget ranges, geographic preferences.
- **Financing calculators:** payment goals, financing interest, budget range.
- **Trade-in calculators:** vehicle info, trade-in interest.
- **Refinance calculators:** current loan info, refinance interest.
- **Zura AI:** name, email, phone, vehicle/financing/trade-in interests, conversation history, intent classification. Every meaningful conversation becomes a CRM event.

### Buyer Lead Sources
Account registration, vehicle requests, saved searches, saved vehicles, trade-in submissions, financing inquiries, refinance inquiries, offer interactions, auction interactions, appointment scheduling, document uploads, referral submissions.

### Dealer Lead Sources
Recruitment funnels, applications, registrations, onboarding, verification.

### Affiliate Lead Sources
Applications, referral traffic, registrations, partner programs.

---

## CRM System [BUILT schema · PARTIAL population]

Master customer database. Each contact contains:
- **Identity:** name, email, phone, contact type, source.
- **Lifecycle:** current stage, stage history, campaign history. *(Recommended: mirror Make enrollment status into a contact field `nurture_status` so reconciliation and the coverage dashboard are pure app-side SQL.)*
- **Engagement:** website, email, SMS, content activity.
- **Attribution:** UTM source, UTM campaign, referrer, affiliate source.
- **Revenue:** vehicle requests, auctions, offers, deals, revenue generated.

---

## Behavioral Event System [TARGET surface — governed by the Binding Rule]

Every meaningful action generates an event.

**Visitor Events:** `page_viewed · article_viewed · calculator_completed · pricing_page_viewed · financing_page_viewed · trade_in_page_viewed · refinance_page_viewed · faq_page_viewed · contact_page_viewed · exit_intent_triggered · lead_magnet_downloaded · zura_conversation_started`

**Buyer Events:** `buyer_signup · profile_completed · vehicle_request_created · vehicle_request_updated · trade_in_submitted · refinance_inquiry · financing_requested · saved_search_created · saved_vehicle · auction_started · offer_received · offer_reviewed · offer_favorited · offer_accepted · deal_completed`

**Dealer Events:** `dealer_registered · dealer_verified · auction_invitation_received · auction_invitation_accepted · offer_submitted · offer_updated · offer_withdrawn · offer_won · offer_lost`

**Affiliate Events:** `affiliate_registered · affiliate_approved · affiliate_link_created · affiliate_lead_generated · affiliate_conversion`

### ⚠ Known event defects — correct before routing/scoring [VERIFIED]
| Name in blueprint | Reality | Action |
|---|---|---|
| `saved_search_match` | **Phantom** — no emitter; only `saved_search_created` fires on save | Build match emitter, or don't route on match |
| `buyer_inactive` / `dealer_inactive` | **Declared, never emitted** | Build scheduled emitter; Inactivity scenario inert until then |
| `deposit_pending` | **Declared, never emitted** | Emit or remove |
| `vehicle_request_submitted` vs `vehicle_request_created` | Doc uses both; one is real | Reconcile Router branch to the emitted name |
| `offer_received/reviewed/favorited/accepted` | Unconfirmed vs code | Confirm before Router branches |

---

## Lead Scoring System [PARTIAL infra · DEFERRED matrix]

Every event affects lead score. Target values: Buyer Signup +20 · Profile Completion +25 · Vehicle Request +100 · Trade-In +50 · Financing Inquiry +50 · Refinance Inquiry +50 · Offer Review +25 · Offer Acceptance +200 · Deal Completion +500.

Lead Temperature: Cold · Warm · Hot · Purchase-Ready · Deal-Imminent.

**State:** scoring infra via migration 06 (`contact_lead_score`) — *verify applied to prod*. Full matrix + temperature automation **deferred** until traffic.

---

## Make.com Automation Layer

### Router Scenario [BUILT — `5355993`]
Receives every AutoLenis event; determines campaign/segment/sequence; creates enrollment. ⚠ **No inbound HMAC yet** — verify `MAKE_WEBHOOK_SECRET` before real traffic.

### Processor Scenario [BUILT, corrected, echo-bound, OFF — `5410176`]
Runs every 15 min: SearchRecord (active + `due_at < now`) → GetRecord cadence `campaign:next_step` → HTTP POST to dispatch → Router on `is_last` → **complete** or **advance** (`next_step+1`, `due_at = now + current.offset_hours`). Posts to echo today; flips to real dispatch at go-live. Needs UI reactivation.

### Reconciliation Scenario [NOT BUILT — highest-value gap]
Daily. Finds contacts **not suppressed AND not enrolled AND not recently contacted** and auto-enrolls them into nurture. The literal enforcer of No Lead Left Behind. Cheap to build; valuable even at low volume.

### Inactivity Scenario [NOT BUILT — blocked]
Daily. Finds dormant buyers/dealers/affiliates and triggers re-engagement. **Blocked** until app-side `buyer_inactive` / `dealer_inactive` emitters exist.

---

## Email Campaigns [BUILT — 45 templates / 19 campaigns]

**Buyer:** Welcome · Vehicle Request · Auction · Offer · **Financing (⚠ no templates)** · Trade-In · Refinance · Referral · Win-Back · Post-Purchase.
**Dealer:** Recruitment (⚠ none) · Verification (⚠ none) · Activation/Onboarding · Auction Invitation · Offer Reminder (⚠ none) · Reactivation (⚠ none).
**Affiliate:** Welcome · Activation · Growth · Milestones · Reactivation (⚠ none).

**Seeded template keys:**
- Recovery (4): `abandonment_touch_1/2/3`, `exit_intent_recovery`
- Welcome (5): `welcome_d0`, `_d1_how_it_works`, `_d3_dealer_competition`, `_d5_what_to_expect`, `_d7_request` *(cadence live in Make)*
- Lifecycle/transactional (7): `vr_received`, `auction_live`, `offer_in`, `offer_multiple`, `deal_formed`, `deposit_confirmed`, `contract_signed`
- Trade-in (3) · Refi (3) · Saved-search (1) · Calc-followup (1) · Lead-magnet (2) · Zura (1) · Prequal (2)
- Dealer (4): `dealer_welcome/_profile/_auctions/_wins`
- Affiliate (5): `aff_welcome/_first_lead/_traffic/_commissions/_scale`
- Win-back (2) · Post-close (5): `postclose_d7_survey/_d30_review/_d60_referral/_d180_upgrade/_d365_replacement`

**Footer sentinel:** templates **omit** `<!-- autolenis:footer:v1 -->` so `TemplateService.renderInline` stamps the centralized CAN-SPAM footer from `AUTOLENIS_PHYSICAL_ADDRESS`. **Content gaps to build as funnels go live:** Financing series, Dealer recruitment/verification/offer-reminder/reactivation, Affiliate reactivation.

---

## SMS Campaigns [PARTIAL]

**Transactional:** verification codes, vehicle-request confirmations, auction alerts, offer alerts, appointment reminders.
**Marketing:** trade-in / financing / refinance opportunities, dealer-competition alerts, re-engagement.

All SMS enforce: TCPA, STOP requests, consent validation, quiet hours. **Opt-out language is auto-appended at dispatch (`crm-sms.ts`) — do not include it in template copy.**

**State:** dispatch endpoint exists; Make Processor sends email only (add `channel == "sms"` → `/dispatch/sms` when SMS campaigns go live). Marketing-SMS triggers tied to inactivity are not live until inactive emitters exist. ⚠ Two inbound STOP handlers write different suppression planes — consolidate in a separate PR after confirming the active Twilio URL.

---

## Internal CRM Automation [TARGET / DEFERRED]
Auto-create sales tasks, follow-ups, dealer-outreach tasks, escalations, compliance reviews, lead assignments based on lead score and activity. Build alongside scoring (deferred until traffic).

---

## No Lead Left Behind Framework [TARGET — enforced by Reconciliation]

Every contact must always be in exactly one of three states:
1. **Active Campaign** — currently enrolled.
2. **Suppressed** — unsubscribed / STOP / no consent.
3. **Re-Engagement** — inactive, being reactivated.

The system must never allow: `Contact Exists AND Not Suppressed AND Not In Campaign AND Not In Re-Engagement` — a lost lead. The daily Reconciliation job must drive this count to zero, surfaced on a coverage dashboard (KPI = "uncovered" → ~0).

---

## Reporting & Attribution [DEFERRED — traffic-gated]
Track: Visitor → Lead → Vehicle Request → Auction → Offer → Deal → Revenue. Measure revenue by campaign, source, affiliate, dealer, content, social post; every dollar attributable. Build once meaningful traffic exists.

---

## Compliance Gates [ENFORCED]
- **CAN-SPAM:** `AUTOLENIS_PHYSICAL_ADDRESS` set in prod before any marketing send; footer sentinel rules above.
- **TCPA / SMS:** dual suppression planes read at dispatch; quiet hours; STOP-handler consolidation pending.
- **FCRA:** prequal copy carries no score/decision/guaranteed-rate language; `prequal_started` payload data-free.
- **Onboarding (start now, multi-week):** Twilio A2P 10DLC; Resend domain auth (SPF/DKIM/DMARC).

---

## Build Sequence (Roadmap)
| Phase | Work | Gate |
|---|---|---|
| **P0** | Reactivate keeper `5410176`; verify echo advancement (test-0001→step 2, test-0005→completed) | This session |
| **P1** | Repo audit: confirm dispatch contract, outbound signing, in-app vs Make ownership split, full event-coverage map | Code-exec / agent |
| **P2** | Rotate `CRM_DISPATCH_KEY`; flip keeper echo→real; go live on Welcome | P1 |
| **P3** | Add inbound HMAC verification to Router (`MAKE_WEBHOOK_SECRET`) | P1 |
| **P4** | App-side: close event emitters; build inactive + saved-search-match emitters | P1 |
| **P5** | **Reconciliation scenario** → NLLB to zero + coverage dashboard | P4 |
| **P6** | Inactivity scenario | P4 |
| **P7** | Seed remaining 17 campaign cadences | Ownership split (P1) |
| **Parallel** | 10DLC, Resend domain auth, set `AUTOLENIS_PHYSICAL_ADDRESS` | Now |
| **Deferred** | Scoring matrix, segmentation, full attribution, retargeting | Traffic |

---

## Go-Live Procedure (Processor → real dispatch)
On the keeper's HTTP module, change only:
```
url:    …/crm-dispatch-echo-test  →  https://www.autolenis.com/api/crm/dispatch/email
header: x-crm-dispatch-key: TEST_DISPATCH_KEY  →  X-Dispatch-Key: <real CRM_DISPATCH_KEY>
```
Body is already real-schema. Obtain the key by **rotating** `CRM_DISPATCH_KEY` (write-only in Vercel): new value in Vercel (Prod + Preview), redeploy, paste the same value into Make. **Inject the real key into exactly one scenario (the keeper)** — that invariant prevents double-send.

---

## Open Keystones / Blockers
1. **Keeper reactivation** — open `5410176` in the Make editor, Save, toggle ON.
2. **Repo audit (P1)** — dispatch contract, `make-webhook.ts` signing, ownership split, event-coverage map.
3. **Key rotation** — `CRM_DISPATCH_KEY` to a known value; inject into the keeper only.
4. **Router HMAC** — no inbound signature verification yet.

---

## Deferred Scope (do not build now)
Behavioral-tracking depth, lead-scoring matrix + temperature automation, segmentation, full attribution/reporting, retargeting. Correct parts of the vision; premature until traffic. The "swallow-to-zeros" data-integrity fix belongs to the separate Phase 2 analytics track, not this engine.

---

## Final Objective

A fully automated behavioral marketing and revenue engine that captures every possible lead, tracks every meaningful action, scores every prospect, nurtures every contact, automates every follow-up, activates dealers, grows affiliates, increases conversions and retention, generates referrals, provides complete attribution, enforces compliance, and ensures no qualified lead is ever forgotten — improving continuously as buyers, dealers, affiliates, campaigns, content, conversations, and transactions flow through the platform.

**Master reference for any AI, engineer, architect, or consultant working on the AutoLenis marketing automation ecosystem. Bind every automation to verified-emitted events, and respect the iron rule.**
