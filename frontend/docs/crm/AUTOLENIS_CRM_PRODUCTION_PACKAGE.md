# AutoLenis — Final Production Package (5 Artifacts)

> Complete five-artifact production package. Each artifact is self-contained and copy-ready. Where a fact depends on the still-pending repo audit, it is marked **❓ confirm**; verified facts and known defects are marked explicitly so nothing reads as more certain than it is.

---

# ARTIFACT 1 — CRM & Automation Blueprint

The master architecture document. Every engineer reads this first. **v2.0 · 2026-06-16 · Owner: Markist Athelus · Status: Authoritative**

## 1.1 System Overview

AutoLenis's CRM/automation system is the behavioral marketing and revenue engine for a buyer-first automotive reverse-auction platform. It identifies, tracks, scores, nurtures, converts, retains, and attributes every visitor, buyer, dealer, and affiliate across their lifecycle. Governing principle: no qualified lead is ever lost to lack of follow-up. Current reality: the spine (Router + Processor + content) is built; event coverage and the first dealer are the gates — not more campaigns.

## 1.2 Business Objectives

Capture every lead · track every meaningful action · score every prospect · nurture every contact · automate every follow-up · activate the first dealer · grow affiliates · increase conversion + retention · generate referrals · provide complete attribution · enforce compliance by construction.

## 1.3 AutoLenis vs Make.com Responsibilities

| Concern | AutoLenis (System of Record) | Make.com (Orchestration Brain) |
|---|---|---|
| Customer data, CRM, consent, suppression | Owns | Never |
| Sending email/SMS, compliance enforcement, audit | Owns (dispatch endpoints) | Never sends directly |
| Lead scoring, attribution, revenue | Owns | Reads via payload only |
| What/when/which-campaign, sequencing, delays, branching, enrollment | Emits events | Owns |
| Re-engagement / reconciliation logic | Provides queries/endpoints | Owns schedule + decision |

**Iron rule:** every communication routes back through an AutoLenis dispatch endpoint before delivery (TCPA / CAN-SPAM / consent / suppression / audit / attribution). Make holds no delivery credentials.

## 1.4 Data Flow

```
User action (app)
  → AutoLenis emits domain event  → POST (HMAC-signed) → Make Router webhook
      → Router maps event → campaign → AddRecord(enrollment) in Make data store
  Make Processor (every 15 min)
      → SearchRecord(active & due) → GetRecord(cadence step)
      → POST AutoLenis /api/crm/dispatch/{email|sms}  (X-Dispatch-Key)
          → AutoLenis enforces consent/suppression → Resend / Twilio → deliver
          → AutoLenis logs send + attribution
      → Processor advances enrollment (next_step, due_at) or completes
  Reconciliation (daily)  → backfill uncovered contacts → Router
  Inactivity (daily)      → dormant → re-engagement enrollment
```

## 1.5 User Lifecycle Maps

- **Buyer:** Visitor → Lead → Buyer (signup) → Vehicle Request → Auction → Offer(s) → Deal → Post-close
- **Dealer:** Prospect → Registered → Verified → Active Dealer → (Reactivation if dormant)
- **Affiliate:** Applicant → Approved → Active → Producer → (Reactivation if dormant)
- **Visitor:** Anonymous → Identified Lead (email captured) → Buyer (account)

## 1.6 Communication Architecture

- **Channels:** Email (Resend), SMS (Twilio), in-app tasks/notifications (CRM).
- **Single chokepoint:** all sends pass `dispatch/*` → consent + dual SMS suppression + CAN-SPAM footer + idempotency + audit.
- **Template rendering:** `TemplateService.renderInline` stamps the centralized CAN-SPAM footer unless a template carries `<!-- autolenis:footer:v1 -->` (suppression sentinel). SMS opt-out language is auto-appended at dispatch.
- **Idempotency:** every dispatch carries `idempotencyKey = campaign:contact_id:step`.

---

# ARTIFACT 2 — Event & Data Dictionary

The source of truth. Bind every automation to entries marked ✅; never route on ⚠ or unconfirmed ❓ without repo confirmation.

## 2.1 Event Registry

**Status:** ✅ confirmed-emitted · ⚠ defect (phantom/declared-unemitted) · ❓ confirm in repo audit.

| Event | Actor | Status | Notes |
|---|---|---|---|
| `buyer_signup` | Buyer | ✅ | Router live on this; triggers Welcome |
| `saved_search_created` | Buyer | ✅ | Fires on save; → saved_search_confirm |
| `prequal_started` | Buyer | ✅ | FCRA-safe, payload data-free (`{}`) |
| `vehicle_request_created` / `..._submitted` | Buyer | ❓ | Doc uses both names — reconcile to the emitted one; → vr_received |
| `vehicle_request_updated` | Buyer | ❓ | |
| `trade_in_submitted` | Buyer | ❓ | → trade_in series |
| `refinance_inquiry` | Buyer | ❓ | → refi series |
| `financing_requested` | Buyer | ❓ | No templates yet |
| `saved_vehicle` | Buyer | ❓ | |
| `auction_started` | Buyer/System | ❓ | → auction_live |
| `offer_received` / `offer_reviewed` / `offer_favorited` / `offer_accepted` | Buyer | ❓ | Confirm exact names; → offer_in / offer_multiple / deal_formed |
| `deal_completed` | Buyer/System | ❓ | → post-close series |
| `saved_search_match` | Buyer | ⚠ phantom | No emitter; only saved_search_created exists |
| `buyer_inactive` | Buyer | ⚠ declared, never emitted | Inactivity blocked until scheduled emitter built |
| `deposit_pending` | Buyer | ⚠ declared, never emitted | |
| `dealer_registered` / `dealer_verified` | Dealer | ❓ | → dealer series |
| `auction_invitation_received/accepted`, `offer_submitted/updated/withdrawn/won/lost` | Dealer | ❓ | |
| `dealer_inactive` | Dealer | ⚠ unemitted | Build emitter |
| `affiliate_registered/approved/link_created/lead_generated/conversion` | Affiliate | ❓ | → affiliate series |
| Visitor events (`page_viewed`, `article_viewed`, `calculator_completed`, `exit_intent_triggered`, `lead_magnet_downloaded`, `zura_conversation_started`, …) | Visitor | ❓ / DEFERRED | Behavioral tracking depth deferred until traffic |

**Standard event payload (target):** `{ event, contact_id, email, phone, occurred_at, attribution{...}, data{...} }`, HMAC-signed per `make-webhook.ts` (scheme ❓ confirm).

## 2.2 CRM Fields

| Field | Type | Purpose |
|---|---|---|
| `lead_score` (`contact_lead_score`, migration 06) | int | Cumulative behavioral score — verify migration applied to prod |
| `lifecycle_stage` | enum | Visitor/Lead/Buyer/… per §1.5 |
| `nurture_status` (recommended) | enum | Mirror of Make enrollment state (active/suppressed/reengagement) for app-side reconciliation |
| `consent_email` | bool | CAN-SPAM gate |
| `consent_sms` | bool | TCPA gate; read at dispatch |
| `source` | string | Capture source (§3) |
| `campaign` | string | Originating campaign |
| `contact_type` | enum | buyer/dealer/affiliate/visitor |
| Suppression: `sms_suppression`, `SmsOptOut`, email suppression | — | Read at every dispatch |

## 2.3 Database Relationships

*(model-level; confirm exact FKs in `schema.prisma`)*

```
Contact 1─* Buyer | Dealer | Affiliate         (role records hang off Contact)
Buyer   1─* VehicleRequest
VehicleRequest 1─1 Auction
Auction 1─* Offer            *─1 Dealer         (offers submitted by dealers)
Offer   1─0..1 Deal
Affiliate 1─* Referral ─* Contact (attribution)
Contact 1─* Event, Communication, Consent, Suppression, Enrollment-mirror
```

## 2.4 Attribution Fields

`utm_source` · `utm_campaign` · `utm_medium` · `utm_term` · `utm_content` · `referrer` · `affiliate_id` · `landing_page` · `first_touch_at` · `last_touch_at`.

**Target attribution chain:** Visitor → Lead → Vehicle Request → Auction → Offer → Deal → Revenue (reporting DEFERRED until traffic).

---

# ARTIFACT 3 — Lead Capture & Lifecycle Specification

## 3.1 Lead Sources

| Source | Captures | Emits (target) | Status |
|---|---|---|---|
| Landing pages | name, email, phone, vehicle interest, source, UTM | lead_captured/page event | ❓ |
| Blog articles | article, category, time, scroll | article_viewed | ❓ / deferred |
| Zura AI | name, email, phone, interests, history, intent | zura_conversation_started + CRM event | ❓ |
| Trade-in calculator | vehicle info, trade interest | trade_in_submitted | ❓ |
| Refinance calculator | loan info, refi interest | refinance_inquiry | ❓ |
| Financing calculator | payment goals, budget | financing_requested | ❓ (no templates) |
| Saved search | makes/models/budget/geo | saved_search_created | ✅ |
| Exit intent | email, vehicle interest | exit_intent_triggered | ❓ |
| Newsletter | email, interests | newsletter_signup | ❓ |
| Lead magnet | name, email, phone, category | lead_magnet_downloaded | ❓ |
| Dealer application | dealer profile/verification | dealer_registered | ❓ |
| Affiliate application | affiliate profile | affiliate_registered | ❓ |

## 3.2 Lifecycles (stages → trigger)

- **Visitor:** Visitor → Lead (email captured) → Buyer (signup)
- **Buyer:** Lead → Vehicle Request (`vehicle_request_created`) → Auction (`auction_started`) → Offer (`offer_received`) → Deal (`deal_completed`) → Post-close
- **Dealer:** Prospect → Registered (`dealer_registered`) → Verified (`dealer_verified`) → Active Dealer (first auction participation) → Reactivation (`dealer_inactive` ⚠)
- **Affiliate:** Applicant → Approved (`affiliate_approved`) → Active (`affiliate_link_created`/`lead_generated`) → Producer (`affiliate_conversion`) → Reactivation

Each transition must be driven by a verified-emitted event (Artifact 2). Transitions whose event is ⚠/❓ are not yet wired.

---

# ARTIFACT 4 — Campaign Library

Format per campaign: Trigger · Audience · Emails · SMS · Timing · Goal · Status. **45 templates / 19 campaigns seeded in prod.**

## 4.1 Buyer Campaigns

| Campaign | Trigger | Emails (keys) | SMS | Timing | Goal | Status |
|---|---|---|---|---|---|---|
| Welcome | buyer_signup | welcome_d0, _d1_how_it_works, _d3_dealer_competition, _d5_what_to_expect, _d7_request | opt | d0/+24h/+48h/+48h/+48h (delta cadence live) | Activate → vehicle request | ✅ built (cadence in Make) |
| Vehicle Request | vehicle_request_created | vr_received | confirm SMS | on event | Confirm + set expectations | ✅ template; cadence ❓ |
| Auction | auction_started | auction_live | auction alert | on event | Drive engagement | ✅ template |
| Offer | offer_received/offer_* | offer_in, offer_multiple, deal_formed, deposit_confirmed, contract_signed | offer alerts | on event | Move to best-price/accept | ✅ templates |
| Financing | financing_requested | — | — | — | Coordinate financing | ⚠ no templates |
| Trade-In | trade_in_submitted | trade_in_value/_equity/_upgrade | opt | multi-touch | Convert trade interest | ✅ |
| Refinance | refinance_inquiry | refi_review/_savings/_options | opt | multi-touch | Convert refi interest | ✅ |
| Post-Purchase | deal_completed | postclose_d7_survey/_d30_review/_d60_referral/_d180_upgrade/_d365_replacement | opt | d7/d30/d60/d180/d365 | Retain + referral + repurchase | ✅ |
| Referral | post-close / referral | postclose_d60_referral (+ referral series ❓) | opt | day 60+ | Generate referrals | ◑ partial |
| Win-Back | buyer_inactive ⚠ | winback_1, winback_2 | win-back SMS (no live trigger) | on inactivity | Reactivate | ◑ content built, trigger missing |

**Supporting single-shots also seeded:** saved_search_confirm, calc_followup, magnet_deliver/_nurture, zura_followup, prequal_finish/_education, abandonment_touch_1/2/3, exit_intent_recovery.

## 4.2 Dealer Campaigns

| Campaign | Trigger | Emails | Timing | Goal | Status |
|---|---|---|---|---|---|
| Recruitment | cold list / outreach | — | — | Acquire first dealer | ⚠ none (Tier-1 outreach track) |
| Verification | dealer_registered | — | — | Complete verification | ⚠ none |
| Activation/Onboarding | dealer_verified | dealer_welcome, _profile, _auctions, _wins | onboarding sequence | First auction participation | ✅ |
| Reactivation | dealer_inactive ⚠ | — | — | Re-engage dormant | ⚠ none + trigger missing |

## 4.3 Affiliate Campaigns

| Campaign | Trigger | Emails | Goal | Status |
|---|---|---|---|---|
| Welcome | affiliate_approved | aff_welcome | Orient | ✅ |
| Activation | first link/lead | aff_first_lead, aff_traffic | Drive first conversions | ✅ |
| Milestones/Growth | thresholds | aff_commissions, aff_scale | Scale producers | ✅ |
| Reactivation | inactivity | — | Re-engage | ⚠ none |

---

# ARTIFACT 5 — Production Readiness & Compliance

## 5.1 Make.com Architecture (live state)

| Scenario | ID | State | Notes |
|---|---|---|---|
| Router (event → enrollment) | 5355993 (hook 2439911) | ON | ⚠ no inbound HMAC yet |
| Processor (due → dispatch → advance) | 5410176 KEEPER | OFF — reactivate | corrected delta cadence; echo-bound |
| Processor duplicates | 5410246, 5410025 | OFF | retired; 5410025 kept as real-contract ref |
| Reconciliation (NLLB sweep) | — | NOT BUILT | highest-value gap |
| Inactivity engine | — | NOT BUILT | blocked on *_inactive emitters |

**Data stores:** cadence 108892 (structure 402431), enrollment 108287.

**Dispatch contract:** `POST https://www.autolenis.com/api/crm/dispatch/{email|sms}`, header `X-Dispatch-Key: <CRM_DISPATCH_KEY>`, body `{contactId, email, templateKey, campaign, step, idempotencyKey}` (❓ confirm in audit).

## 5.2 Compliance

| Domain | Control | Status |
|---|---|---|
| CAN-SPAM | Centralized footer via sentinel; AUTOLENIS_PHYSICAL_ADDRESS env | ⚠ env must be set in prod before any marketing send |
| TCPA | consent_sms checked at dispatch; quiet hours | ◑ dispatch reads consent |
| Consent | consent_email/consent_sms per contact | ✅ |
| Opt-out | STOP handling; auto-appended SMS opt-out | ⚠ two STOP handlers write different planes — consolidate (separate PR) |
| FCRA | Prequal copy: no score/decision/guaranteed-rate; prequal_started data-free | ✅ |

## 5.3 Deliverability (start now — multi-week, parallel)

| Item | Purpose | Status |
|---|---|---|
| SPF | Authorize Resend to send | ❓ verify |
| DKIM | Sign mail | ❓ verify |
| DMARC | Policy + reporting | ❓ verify |
| A2P 10DLC | Twilio SMS registration | ⛔ start now |

## 5.4 Monitoring

| Instrument | Purpose | Status |
|---|---|---|
| Coverage dashboard | KPI = uncovered contacts (forbidden 4th state) → ~0 | NOT BUILT |
| Dead-letter queue | Capture Processor/Router failures | Make DLQ available; wire alerting |
| Event audit | Every dispatch logged with idempotency + attribution | ◑ app-side logging exists |
| Reconciliation jobs | Daily NLLB backfill + inactivity | NOT BUILT |

## 5.5 Production Checklist (gate to launch)

- [ ] Repo audit complete: dispatch contract + make-webhook signing + ownership split + event-coverage map
- [ ] CRM_DISPATCH_KEY rotated; injected into KEEPER processor ONLY
- [ ] Keeper (5410176) reactivated; echo→real endpoint flip; advancement verified
- [ ] Router inbound HMAC verification added (MAKE_WEBHOOK_SECRET)
- [ ] AUTOLENIS_PHYSICAL_ADDRESS set in prod (CAN-SPAM)
- [ ] SPF / DKIM / DMARC verified; A2P 10DLC approved
- [ ] STOP-handler consolidation merged (single suppression plane)
- [ ] App-side emitters closed for all ❓ events; buyer_inactive/dealer_inactive emitters live
- [ ] Reconciliation + Inactivity scenarios built; coverage dashboard reads ~0
- [ ] In-app vs Make ownership split confirmed (no double-send)
- [ ] migrations 06 (lead score) + 07 (content platform) confirmed applied to prod
- [ ] Remove crm-dispatch-echo-test Supabase function
- [ ] Financing templates + dealer recruitment/reactivation content (as those funnels open)

---

# FINAL PRODUCTION PACKAGE — Index

| Artifact | Title | Scope |
|---|---|---|
| Artifact 1 | CRM & Automation Blueprint | architecture, lifecycles, data flow, comms |
| Artifact 2 | Event & Data Dictionary | source of truth: events, fields, schema, attribution |
| Artifact 3 | Lead Capture & Lifecycle Specification | sources + lifecycle stage maps |
| Artifact 4 | Campaign Library | every email/SMS campaign with trigger/audience/timing/goal |
| Artifact 5 | Production Readiness & Compliance | Make architecture, compliance, deliverability, monitoring, launch checklist |

These five together are the complete operating system for the AutoLenis CRM, Lead Capture, Email, SMS, and Make.com automation platform — handoff-ready for any AI, engineer, or automation architect. The one binding instruction across all five: **wire automations only to verified-emitted events, and route every send through AutoLenis dispatch.**
