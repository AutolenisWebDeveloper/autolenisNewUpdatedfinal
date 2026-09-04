# Intake parity map — Part B (§5–§9, §6.1 surface map), §34 form walk, master rules 16 & 17

Repo: /home/user/autolenisNewUpdatedfinal (HEAD 0cd399f). Read-only static trace of running code (routes → services → Prisma). All paths below are relative to `frontend/` unless prefixed. "Master rule 16/17" refers to the orchestrator's identity-resolution and attribution-default rules (spec §3 line 141 "never by name, email, or phone"; §5 rules 2 & 5 lines 249/252).

## Summary (10 lines)

1. There is a single canonical intake service, `lib/services/acquisition/unified-buyer-intake.service.ts` (`intakeBuyerRequest` / `promoteOpportunity`), and it is used by exactly four surfaces: `/api/public/request-vehicle` (wizard, SEO city/state forms, `/lp/[campaign]`), `/api/buyer/requests` (dashboard), `/api/concierge` (Zura chat, via `promoteOpportunity`), and `lib/voice/dispatch-request.ts` (phone). Rule 1 "one endpoint" is PARTIAL: five other Lane-1 captures (`/api/finder`, `/api/leads/lead-magnet`, `/api/tools/dealer-fee-lead`, `/api/public/crm/partial-lead`, `/api/public/crm/exit-intent`) implement their own capture and never reach a VehicleRequest.
2. Attribution is PARTIAL: `VehicleRequest` has `utm_source/medium/campaign/source_url/landing_source/referrer/ip_address` columns but no `utm_content` or `affiliate_id`; `ip_address` is never written by any intake path; nothing writes an acquisition-channel default — absent attribution is stored as NULL (no `"direct"` literal exists anywhere in intake code, which satisfies rule 17's "never store direct as URL/IP" but the channel field itself is MISSING).
3. ZIP capture is ALREADY CORRECT on the public wizard, LP, SEO and dashboard forms (5-digit regex) and written to `BuyerOpportunity.zip`, guest `Buyer.zip`, and backfilled onto an existing buyer's NULL zip — but `VehicleRequest` has NO zip column, so "written to both the lead and the Vehicle Request" is PARTIAL. Homepage hero, inventory cards and vehicle detail CTAs link to `/auth/signup`, which collects no ZIP.
4. Consent is PARTIAL: SMS/email consent + text + timestamp + IP land only on the CRM `contacts` plane (`ContactService.upsertContact`); `BuyerOpportunity.consentSms/consentAt` are never written by intake; no consent **version** is stored anywhere except `Buyer.termsVersion` at signup; the SEO form hard-codes `consent_sms: true` without a checkbox (a TCPA defect).
5. One-open-request (rule 5) is BROKEN: `hasActiveRequest` exists but has zero callers; every submission creates a new `BuyerOpportunity` + a new `VehicleRequest` (idempotent only per-opportunity). A second buyer row is created whenever the same person arrives with a different email (email is the only identity key; phone is normalised but never used for lookup — correctly per rule 16 — but no phone-collision *flag* exists).
6. The production duplicate (two verified emails, same phone, both via dashboard registration) is explained by `lib/auth/actions.ts:344-347`: `signUpAction` refuses any email already in `users` — including a `guest_*` placeholder created by the public form — so a guest who tries to claim their account is told "already exists, sign in", cannot sign in (no Supabase auth user), and registers again with a different email. Phone is never collected at signup and never checked at onboarding/profile, so nothing flags the collision. Rule-16-compliant behaviour: let a `guest_*` User proceed through signup (claim by verified email), and on phone write (`PATCH /api/buyer/profile`) raise an Operations "possible duplicate buyer" exception — never auto-merge on phone.
7. Guest capture → claim: `BuyerRequestClaimToken` is used only as a single-use, hashed **resume deep-link** (`request-resume-token.service.ts`) that 302s to `/buyer/deposit`; it never binds a session to the guest buyer. The actual claim is the email-match guest upgrade in `ensurePrismaUser` (`lib/auth/actions.ts:106-149`, `175-212`), which is unreachable via `signUpAction` (item 6). Resend never duplicates a buyer/request (token rows only) — ALREADY CORRECT.
8. Draft recovery: `VehicleRequestStatus` has no `DRAFT`; the LP's Step-1 abandonment only writes a CRM contact and a 3-touch `form_abandonment` nurture (0/+23h/+72h). Post-submission pre-checkout sequence exists at exactly the spec cadence (immediate/+1h/+24h/+72h) via `form_submitted → check_form_completion_1..3` with a fresh resume token per send — but it is gated behind flag `LIFECYCLE_INTERNAL_FORM_SUBMITTED` whose OFF branch dispatches to QStash, which the code itself says has been removed. No 14-day abandon marker exists.
9. Lane 2 refinance is ALREADY CORRECT for capture (consent, timestamp, IP hash, state, source, compliance log, EXCLUDED_STATE, `redirectedAt`) and the partner subid `opt_1=<leadId>` is emitted and tested; the crossover rule is MISSING (`RefinanceApplication.buyerId` has no writer; no Lane-1 link), and the reconciliation key is "leadId as opt_1" — confirmation with OpenRoad is UNVERIFIED from code.
10. Lane 3 (dealer application, affiliate register) and Lane 4 (contact, feedback, unsubscribe, testimonials) are separate and non-advancing — ALREADY CORRECT — except that contact/feedback create no buyer-timeline link to an open request (PARTIAL for §9).

---

## Deliverable 1 — Surface inventory (every public form / CTA)

| # | Surface (page route) | Component | Handler (path:line) | Writes | Lane | Canonical intake? |
|---|---|---|---|---|---|---|
| S1 | `/request-vehicle` (6-step wizard) | `components/public/RequestVehicleFormClient.tsx:509-511` | `POST /api/public/request-vehicle` → `app/api/public/request-vehicle/route.ts:287-288` `intakeBuyerRequest(input)` | `buyer_opportunities`, `users`(guest)+`buyers`(guest), `vehicle_requests`, `notifications` (SYSTEM_ALERT queue row :596), CRM `contacts`+`contact_timeline_events` (:466-540), `social_leads` (:365), `content_attributions` (:429), `lifecycle_touch_schedule`/QStash (:582) | BUY | YES (`unified-buyer-intake.service.ts:199`) |
| S2 | `/lp/[campaign]` paid landing (Step 1 → Step 2) | `app/(public)/lp/[campaign]/LandingPageClient.tsx:370` (partial), `:445` (full) | Step 1: `POST /api/public/crm/partial-lead` (`app/api/public/crm/partial-lead/route.ts:37`); Step 2: `POST /api/public/request-vehicle` | Step 1: CRM `contacts`, timeline, `lead_nurture_schedule` (form_abandonment). Step 2: as S1 | BUY | Step 2 YES; Step 1 NO (own capture, CRM only) |
| S3 | `/lp/[campaign]` exit-intent modal | `LandingPageClient.tsx:1569` | `POST /api/public/crm/exit-intent` (`app/api/public/crm/exit-intent/route.ts:22`) | CRM `contacts`, timeline, `lead_nurture_schedule` (exit_intent) | BUY (partial) | NO |
| S4 | `/lp/[campaign]` social click beacon | `LandingPageClient.tsx:276` | `POST /api/public/social-click` (`app/api/public/social-click/route.ts:60`) | `revenue_attributions` (CLICK), `social_performance` | BUY (attribution only) | n/a |
| S5 | `/thank-you` "Complete Your Request" (Step 2b) | `app/(public)/thank-you/ThankYouClient.tsx:114` | `POST /api/public/request-vehicle/complete` (`.../complete/route.ts:137-168`) | updates most-recent `vehicle_requests` by **unverified email**, `vehicle_request_events`; CRM timeline fallback (:186-200) | BUY | NO (own path; mutates VR keyed on unverified email — rule 16 violation) |
| S6 | `/car-buying-service/texas`, `/car-buying-service/[city]` (SEO hero) | `components/seo/landing/VehicleRequestForm.tsx:129` (mounted by `SeoHero.tsx:83`) | `POST /api/public/request-vehicle` with `source`=FormSource, `referrer` | as S1 (+ `landing_source`, `referrer` on VR) | BUY | YES |
| S7 | Homepage `/` hero "Get started" | `app/(public)/page.tsx:120,338` `href="/auth/signup"` | `signUpAction` (`lib/auth/actions.ts:310`) | `auth.users` (Supabase) → on callback `users`+`buyers` | BUY (account only) | NO — no form, no ZIP, no vehicle interest; not a lead |
| S8 | Zura chat widget (home, /for-buyers, /request-a-car, /lp, all portals) | `components/public/ChatWidget.tsx:117` | `POST /api/concierge` (`app/api/concierge/route.ts:205-231` opportunity; `:514-533` `promoteOpportunity`) | `buyer_opportunities` (per server-issued session), `vehicle_requests` on completion, CRM contact on phone capture (:566-583), `ai_events` | BUY | YES (promotion path) |
| S9 | Legacy conversational finder | `components/acquisition/VehicleFinder.tsx:52` → **posts to `/api/concierge`** (not `/api/finder`) | `/api/finder/route.ts` has no UI caller | `acquisition_conversations`, `lead_scores` (buyerId null) | BUY (dead route) | NO |
| S10 | `/inventory` listing cards | `components/public/InventorySearchClient.tsx`; page CTAs `app/(public)/inventory/page.tsx:235,315,517` → `/auth/signup` | none for anonymous; authed → `POST /api/buyer/shortlist` (`components/buyer/BuyerSearchClient.tsx:226`) | `shortlists`, `shortlist_items` | BUY | NO VehicleRequest produced |
| S11 | `/inventory/[vehicleId]` detail | `app/(public)/inventory/[vehicleId]/page.tsx:361` (`/auth/signup` for anon), `AddToShortlistButton.tsx:19` (authed), `:366-378` `find-similar-cta` (REQUEST_SIMILAR) | `POST /api/buyer/shortlist` (`app/api/buyer/shortlist/route.ts:30-104`) | `shortlist_items` (radius/freshness gated server-side :62-79) | BUY | NO VehicleRequest; no `inventory_item_id` on VR |
| S12 | Shortlist page `/buyer/shortlist` | `components/buyer/ShortlistClient.tsx:59` (delete only) | `DELETE /api/buyer/shortlist/[itemId]` | `shortlist_items` | BUY | Shortlist → auction happens at deposit (`create-intent/route.ts:76-82` requires ≥1 item); no VR carrying candidates |
| S13 | "Find one like this" (out-of-radius) | `app/(public)/inventory/[vehicleId]/page.tsx:366-378` `similarHref`; `lib/services/shortlist/shortlist-radius.ts:125` `REQUEST_SIMILAR` | links to `/buyer/requests/new?...` (prefill via `app/buyer/requests/new/page.tsx:192-193` reads `zip` etc. from URL) | → S17 | BUY | YES (through S17) — pre-fill only from URL params; UNVERIFIED which fields `similarHref` carries |
| S14 | AMIPS `/intelligence/[slug]` | `app/(public)/intelligence/[slug]/page.tsx` — only `href="/author/markist"` (:158); `MarketScoreTable` | none | none | BUY (spec) | NO form / CTA to intake — MISSING |
| S15 | Blog `/buying-guide/[slug]` in-article CTA | `components/content/ArticleCTA.tsx:42` `buildBuyerUrl` (`lib/seo/buyer-cta.ts:31-43`) → `BUYER_INTAKE_PATH?city&state&make&model`; last-touch cookie recorded by `recordContentAttribution` (`request-vehicle/route.ts:429`) | → S1 or S7 (UNVERIFIED value of `BUYER_INTAKE_PATH`) | `content_attributions` at lead time | BUY | via S1 |
| S16 | Lead magnet `/guide` | `components/leads/LeadMagnetForm.tsx:55` | `POST /api/leads/lead-magnet` (`app/api/leads/lead-magnet/route.ts:98-110`) | `buyer_opportunities` (source `lead_magnet:<slug>`, no VR, no buyer), CRM `contacts` | BUY (lead only) | NO (own capture; never promoted) |
| S17 | Buyer dashboard `/buyer/requests/new` | `app/buyer/requests/new/page.tsx:394` | `POST /api/buyer/requests` (`app/api/buyer/requests/route.ts:123-254`) | `buyer_opportunities`, `vehicle_requests`, `vehicle_request_financing`, `vehicle_request_events`, `vehicle_request_buyer_updates` | BUY | YES (`:200 intakeBuyerRequest`) |
| S18 | Dealer-fee calculator lead `/tools/dealer-fee-calculator` | `components/tools/DealerFeeCalculator.tsx:187` | `POST /api/tools/dealer-fee-lead` (`app/api/tools/dealer-fee-lead/route.ts:106-120`) | `buyer_opportunities` (source `tool:dealer_fee_calculator`, no VR/buyer), CRM contact | BUY (lead only) | NO |
| S19 | Trade-in (public) | inside S1 wizard step 5 (`RequestVehicleFormClient.tsx:1235`) | S1 → `BuyerOpportunity.tradeInDetails` JSON (`unified-buyer-intake.service.ts:235`) | JSON blob only; no `trade_in_submissions` row | BUY | YES but not a TradeInSubmission |
| S20 | Trade-in (buyer portal) | (buyer portal form — UNVERIFIED component) | `POST /api/buyer/trade-in` (`app/api/buyer/trade-in/route.ts:13-21`) → `submitTradeIn` (`lib/services/trade-in/trade-in.service.ts:11-26`) | `trade_in_submissions` (buyer-level only; no `vehicle_request_id`/`deal_id` columns — `prisma/schema.prisma:2036-2055`) | BUY (supporting) | n/a — floats unattached |
| S21 | Prequalification `/buyer/prequal` | `components/buyer/PrequalFormClient.tsx:256` | `POST /api/buyer/prequal` (`app/api/buyer/prequal/route.ts:98-140`) → `prequal.service.ts:273-275` `PrequalConsent` with FCRA text, IP, UA; location backfill `:300-321` | `pre_qualifications`, `prequal_consents`, `buyers.city/state/zip` (fill-if-null) | BUY (supporting) | n/a (attached to buyer) — CORRECT |
| S22 | Affiliate referral link `?ref=` | `proxy.ts:403-411` (30-day cookie), `components/referral/ReferralCapture.tsx:47` | `POST /api/public/referral/track` → `trackClick` (`lib/services/affiliate/referral.service.ts:61-94`); at signup `recordAffiliateAttribution` (`lib/auth/actions.ts:247-306`) | `affiliate_clicks`; `affiliate_referrals`, `buyers.affiliate_id` (set-if-null) at signup | BUY (attribution) | Stamped on Buyer only; NOT on lead/VR |
| S23 | Voice receptionist (Twilio) | `lib/voice/handle-turn.ts:269` (`callReason`), `lib/voice/dispatch-request.ts:110-200` | creates Supabase user + `users`+`buyers` keyed on **spoken (unverified) email** (:129-170), then `intakeBuyerRequest` | `buyer_opportunities` (+`call_reason`), `vehicle_requests` | BUY | YES — but identity by unverified email |
| S24 | Call-back / "talk to a human" web form | none found (`grep -i 'callback request|talk to a human|call me back'` in `app/(public)`, `components/public` → 0 hits) | — | — | BUY (spec) | MISSING |
| S25 | Refinance `/refinance/eligibility` → `/refinance/confirm` | `app/(public)/refinance/eligibility/page.tsx:135`, `confirm/page.tsx:71` | `POST /api/public/refinance` (`route.ts:27-99`) → `submitRefinanceLead` (`refinance-lead.service.ts:76-140`); `POST /api/public/refinance/redirect` → `markLeadRedirected` (:142-156) | `refinance_applications`, `refinance_compliance_logs` | REFINANCE | separate — CORRECT |
| S26 | Dealer application `/dealer-application` | `app/(public)/dealer-application/page.tsx:85` | `POST /api/public/dealer-application` (`route.ts:26-53`, dedup on PENDING/APPROVED email) | `dealer_applications` | SUPPLY | separate — CORRECT |
| S27 | Affiliate application `/affiliate/register` (from `/for-affiliates`) | `app/affiliate/register/AffiliateRegisterClient.tsx:114` | `POST /api/affiliate/register` (`route.ts:94-100` email dedup, `:199-215` tx create) | `users`, `affiliates` | SUPPLY | separate — CORRECT |
| S28 | Contact `/contact` | `components/public/ContactFormClient.tsx:44` | `POST /api/public/contact` (`route.ts:48-131`) | `notifications` (SYSTEM_ALERT), CRM `contacts` (SMS consent only when phone+consent) | SUPPORT | non-advancing — CORRECT; no buyer/VR link |
| S29 | Feedback `/feedback` | `app/(public)/feedback/page.tsx:24` | `POST /api/public/feedback` (`route.ts:28-80`) | `notifications` | SUPPORT | CORRECT |
| S30 | Testimonials | `/testimonials` page has no form; buyer route `components/buyer/TestimonialPromptClient.tsx:19` → `POST /api/buyer/testimonials` (requires COMPLETED deal `route.ts:15`) | | `testimonials` | SUPPORT | CORRECT |
| S31 | Unsubscribe / preferences | `GET /api/public/affiliate/unsubscribe?token` (`route.ts:14-23`), `GET/POST /api/public/dealer-unsubscribe` (`route.ts:18-24` → `SuppressionService.suppressEmail`), buyer `/api/buyer/settings` + Twilio STOP webhooks | | `affiliates.*`, `email_suppression`, `sms_suppression` | SUPPORT | CORRECT (no buyer-level public unsubscribe page found — UNVERIFIED) |
| S32 | Premium upgrade `/pricing` | links to `/auth/signup?plan=PREMIUM` (`SignUpClient.tsx:309` hidden `plan`) and `/api/buyer/plan/upgrade` | | `buyers.plan` | BUY (plan) | out of intake scope |

---

## Requirement rows

Legend: status ∈ ALREADY CORRECT | PARTIAL | BROKEN | MISSING | DUPLICATED | UNVERIFIED.

### §5 Universal intake rule

**R1** — spec §5 table (l.237-244) "Every form resolves to one of four lanes"
- status: PARTIAL
- current: Lanes exist as separate terminal tables (S1–S32 above). Lane-1 lead-only captures (S16 lead magnet, S18 fee calculator, S2/S3 partial + exit-intent, S9 finder) terminate in `buyer_opportunities` or CRM `contacts` without a `vehicle_requests` row.
- evidence: `app/api/leads/lead-magnet/route.ts:98` `prisma.buyerOpportunity.create(` (no promote); `app/api/tools/dealer-fee-lead/route.ts:106`; `app/api/public/crm/partial-lead/route.ts:37` `ContactService.upsertContact`.
- required change: classify these as Lane-1 *drafts* and route them through `intakeBuyerRequest` (or `promoteOpportunity` once a buyer resolves) so a DRAFT VR exists; or explicitly document them as pre-lane captures.
- legacy path: `/api/finder` (no UI caller — `VehicleFinder.tsx:52` posts to `/api/concierge`).

**R2** — §5 rule 1 (l.248) "One endpoint. All Lane 1 forms post to a single intake handler."
- status: PARTIAL
- current: canonical = `intakeBuyerRequest`/`promoteOpportunity` (`lib/services/acquisition/unified-buyer-intake.service.ts:199,272`). Callers: `app/api/public/request-vehicle/route.ts:288`, `app/api/buyer/requests/route.ts:200`, `app/api/concierge/route.ts:514`, `lib/voice/dispatch-request.ts:193-206`. Non-canonical Lane-1 captures: `/api/finder`, `/api/leads/lead-magnet`, `/api/tools/dealer-fee-lead`, `/api/public/crm/partial-lead`, `/api/public/crm/exit-intent`, `/api/public/request-vehicle/complete` (own VR mutation).
- evidence: as above; `unified-buyer-intake.service.ts:5-13` comment lists intended callers.
- stronger safeguard: `promoteOpportunity` is idempotent per opportunity (`:277-281`), tested `lib/services/acquisition/__tests__/promote-opportunity.test.ts:82`.
- required change: fold the five side captures into the unified service (as opportunity-only drafts) and delete `/api/finder`; make `/complete` operate on the VR bound to the buyer's claim/session instead of "latest VR by email".

**R3** — §5 rule 2 (l.249) attribution fields written on every submission; absent → `direct`, never null (master rule 17: channel=direct, individual fields nullable; never "direct" as URL/affiliate id/IP)
- status: PARTIAL
- current: `VehicleRequest` columns: `utmSource, utmMedium, utmCampaign, sourceUrl, ipAddress, landingSource, referrer` (`prisma/schema.prisma:1036-1044`). No `utm_content`, no `affiliate_id`, no acquisition-channel column. Writers: `unified-buyer-intake.service.ts:296-311` writes utm×3, sourceUrl, landingSource, referrer as `?? null`; **`ipAddress` is never written** by any intake path (only CRM contact gets IP: `request-vehicle/route.ts:463,476`). `utm_content/utm_hook/utm_creator/utm_affiliate` are accepted (`request-vehicle/route.ts:129-135`) but only forwarded to `triggerSocialAttribution` (:319-331) and `SocialLead` (:369-371). Dashboard (`app/api/buyer/requests/route.ts:171-197`) and concierge (`concierge/route.ts:514-525`) send **no** attribution. No `"direct"` literal exists in intake code (grep → 0 hits), so absent attribution is stored as NULL.
- evidence: cited lines.
- stronger safeguard to preserve: nullable individual fields (never a fake URL/IP) — already the behaviour.
- required change: add `acquisition_channel` (default `direct`), `utm_content`, `affiliate_id` (FK) and write `ip_address` on `VehicleRequest` and `BuyerOpportunity`; capture attribution (cookie/first-touch) for dashboard and concierge paths; derive channel from utm_source/referrer/affiliate cookie server-side.
- legacy: `BuyerOpportunity.source` string doubles as channel (`unified-buyer-intake.service.ts:205-206`).

**R4** — §5 rule 3 (l.250) ZIP requested on every Lane-1 form and written to lead AND Vehicle Request
- status: PARTIAL
- current: ZIP required 5-digit on S1 (`request-vehicle/route.ts:76`), S2 (`LandingPageClient.tsx:361`), S6 (`VehicleRequestForm.tsx:98`), S17 (`requests/new/page.tsx:285-286`); concierge requires zip before promotion (`concierge/route.ts:445`). Written to `BuyerOpportunity.zip` (`unified-buyer-intake.service.ts:233`), guest `Buyer.zip` (:154,:175), and backfilled if buyer zip is NULL (:138-142). **`VehicleRequest` has no zip column** (schema :1022-1067). S7 homepage → `/auth/signup` collects no ZIP (`SignUpClient.tsx:313-330`); S10/S11 anonymous CTAs → signup; S16/S18 lead captures collect no ZIP; onboarding wizard collects no ZIP (BUYER-LOCATION-GAP §1 — corroborated: `grep zip OnboardingWizardClient.tsx` → 0). Prequal now backfills city/state/zip (`prequal.service.ts:300-321`).
- required change: add `zip` (and `city/state`) to `VehicleRequest`; write through from every intake; add ZIP to signup or onboarding; add ZIP to lead-magnet/fee-calculator forms.
- stronger safeguard: never overwrite an existing buyer ZIP (`:137`).

**R5** — §5 rule 4 (l.251) consent stored with version + timestamp; no SMS without stored consent
- status: PARTIAL
- current: S1 wizard: explicit unchecked-by-default SMS checkbox (`RequestVehicleFormClient.tsx:1577-1584`, `:494`), `agreedToContact: z.literal(true)` (`route.ts:127`), `consent_email ?? true` "implied by submission" (:477). Persisted only on CRM `contacts` (`ContactService.upsertContact` `lib/services/contact.service.ts:85-100` sets `consent_at`, `consent_ip`, `consent_text`) — no version. S6 SEO form hard-codes `consent_sms: true` with no checkbox (`VehicleRequestForm.tsx:124-125`) — **TCPA defect**. S2 LP: opt-in checkbox (`LandingPageClient.tsx:220-222,441`). Concierge: gate = server-verified HMAC claim → `consentSms: gateOptIn` (`concierge/route.ts:567-577`) with `ZURA_CONSENT_TEXT` (:74). Dashboard: no consent captured (`requests/route.ts`). Voice: `consentSms: true // collected over the phone` (`dispatch-request.ts:257`) — UNVERIFIED that a disclosure is spoken. `BuyerOpportunity.consentSms/consentAt` (`schema:3904-3906`) never written by intake. Buyer terms: `termsAcceptedAt/termsVersion` at signup (`actions.ts:368-369`, `:166-167`). Onboarding wizard SMS checkbox (`OnboardingWizardClient.tsx:123-134`) — UNVERIFIED whether it is transmitted (BUYER-LOCATION-GAP §1 says the wizard sends name+phone only).
- stronger safeguards: `sendCrmSms` TCPA gate reads `contacts.consent_sms` (skill); contact route refuses phone without consent (`app/api/public/contact/route.ts:43-46`).
- required change: add a `consent_records` write (channel, text, version, timestamp, IP, source surface) keyed to buyer/opportunity from every Lane-1 handler; fix SEO form to an explicit SMS checkbox; persist onboarding SMS consent; store consent version.

**R6** — §5 rule 5 (l.252) one open request per buyer; attach+update, never a second open request, never a second buyer
- status: BROKEN
- current: `hasActiveRequest` (`lib/services/vehicle-request/vehicle-request.service.ts:21-25`) has **no callers**; `POST /api/buyer/requests` only applies `checkRateLimit` (3/h) (`route.ts:128`). `intakeBuyerRequest` always creates a fresh `BuyerOpportunity` (`:211`) then a fresh `VehicleRequest` (`:307`); idempotency is per-opportunity only (`:277`). `/complete` finds "most recent VR" (`complete/route.ts:143-147`) — evidence that multiple VRs per buyer are expected. Second buyer: `resolveBuyerId` case 3 creates a new guest User+Buyer for any unknown email (`:160-179`) — correct under rule 16 (email is the key), but no collision *flag* on phone.
- evidence: cited.
- stronger safeguard: intake-reconcile eligibility treats only sourcing VRs (`intake-processor.service.ts:395-402`).
- required change: in `promoteOpportunity`, resolve the buyer's open VR (`status NOT IN CANCELLED/CLOSED_NO_MATCH/DEAL_CREATED/EXPIRED`) and update it (merging fields, appending a `VehicleRequestEvent`), linking the new opportunity; only create when none is open. Add a unique partial index `vehicle_requests(buyer_id) WHERE status IN (open set)` as a DB guard.

**R7** — §5 rule 6 (l.253) incomplete = DRAFT, enters §6.4 recovery
- status: MISSING
- current: no `DRAFT` in `VehicleRequestStatus` (`schema:1654-1666`); partial LP capture goes to CRM contact + `lead_nurture_schedule` only (`partial-lead/route.ts:91-99`); concierge keeps a non-completed `BuyerOpportunity` (a de-facto draft) but no VR until all fields captured (`concierge/route.ts:441-447`).
- required change: add `DRAFT` to `VehicleRequestStatus` (plus `abandonedAt`), create the DRAFT VR at first capture (email+zip), and enrol it in the §6.4 sequence.

**R8** — §5 rule 7 (l.254) no spend before payment (draft storage, scoring, internal notification free; paid enrichment/discovery/contact reveal/outreach never before $99)
- status: PARTIAL (UNVERIFIED cost of pre-deposit stages)
- current: dealer outreach gated on PAID deposit (`post-intake-outreach.service.ts:152-164` `isFulfillmentUnlocked`); dealer fan-out gated (`dealer-opportunity-notification.service.ts:47-51`). But the intake-reconcile cron runs pre-deposit: market enrichment via Groq Compound (`compound-search.service.ts:248` "Calling Groq Compound fallback"), dealer discovery via Gemini Maps (`compound-search.service.ts:366` "delegating to Gemini Maps", `gemini-maps.service.ts:57` `GEMINI_API_KEY`), and `prospect_email_enrichment` (`intake-pipeline.service.ts:496-501` `enrichProspectEmailsForOpportunity`) — all metered third-party APIs; the code labels discovery "cost-free" (`post-intake-outreach.service.ts:154`) which is UNVERIFIED (Gemini/Groq calls are metered).
- required change: move market enrichment, Gemini discovery and prospect-email enrichment behind the same `isFulfillmentUnlocked` gate, or document them as accepted pre-payment spend with a per-lead budget.

### §6.1 Surface map rows

**R9** — Homepage hero "Find my car" → Lead + VR draft, CUSTOM_REQUEST (l.264)
- status: MISSING — `app/(public)/page.tsx:120,338` link to `/auth/signup`; no capture of vehicle interest/ZIP/contact; ChatWidget (S8) is the only capture on the page.
- required change: mount a short Lane-1 capture (ZIP + contact + interest) posting to `/api/public/request-vehicle`, or make signup collect ZIP and create a DRAFT VR.

**R10** — Inventory search results, INVENTORY_SELECTION with `inventory_item_id` (l.265)
- status: MISSING — no `inventory_item_id` on `VehicleRequest`; no `INVENTORY_SELECTION/CUSTOM_REQUEST` entry-type enum anywhere (grep → 0). Anonymous card CTA → `/auth/signup`; authenticated → shortlist only (`app/api/buyer/shortlist/route.ts`).
- stronger safeguard: radius/freshness gate enforced server-side, fail-closed on unplaceable buyer (`shortlist/route.ts:47-79`).
- required change: add `entry_type` enum + `inventory_item_id` (and a `vehicle_request_candidates` join for up to 5) to VR; make "Get best price on this vehicle" create/attach a VR via the unified service.

**R11** — Vehicle detail "Start my request" (l.266) — status: MISSING (same as R10; `inventory/[vehicleId]/page.tsx:361`).

**R12** — Shortlist → ONE VR carrying up to five in-radius candidates (l.267)
- status: PARTIAL — shortlist (max 5, `MAX_SHORTLIST_ITEMS`, in-radius gated) exists but feeds the auction directly at deposit (`create-intent/route.ts:76-82`; `createAuction(buyerId, depositId)` `deposit-activation.service.ts:207` without VR); no VR is created from the shortlist.
- required change: at deposit (or shortlist submit) create/attach the open VR with `entry_type=INVENTORY_SELECTION` and candidate rows.

**R13** — "Find one like this" → pre-filled VR CUSTOM_REQUEST (l.268)
- status: PARTIAL — `REQUEST_SIMILAR` action exists (`shortlist-radius.ts:125`; `page.tsx:366-378` `find-similar-cta`) and `/buyer/requests/new` reads `zip` from URL (`:192-193`); year/make/model/trim/mileage/price-band pre-fill UNVERIFIED (did not read `similarHref` construction).

**R14** — AMIPS / programmatic SEO page CTA (l.269)
- status: MISSING — `app/(public)/intelligence/[slug]/page.tsx` carries no intake CTA/form (only `/author/markist` at :158). `/car-buying-service/*` SEO pages DO have the form (S6) with `landing_source` attribution — CORRECT for those.
- required change: mount `VehicleRequestForm` (or ArticleCTA) on AMIPS pages with `source` = page slug.

**R15** — Blog / content in-article CTA (l.270)
- status: PARTIAL — `ArticleCTA` links to `BUYER_INTAKE_PATH` with city/state/make/model query (`lib/seo/buyer-cta.ts:31-43`); attribution captured via last-touch cookie → `content_attributions` only when the visitor later submits S1/S18 (`request-vehicle/route.ts:429`). No in-article form; UNVERIFIED that `BUYER_INTAKE_PATH` targets `/request-vehicle` (not `/auth/signup`).

**R16** — Social posts/campaigns landing form → `social_leads` → lead → VR (l.271)
- status: ALREADY CORRECT — `/lp/[campaign]` → `/api/public/request-vehicle` → `SocialLead` created with `buyerOpportunityId`+`vehicleRequestId` (`route.ts:362-390`), `utm_content/hook/platform` captured; converted on deal (`lib/social/attribution.service.ts:246-256`). Note: `phone: "Not provided"` literal is sent when phone empty (`LandingPageClient.tsx:424`) and stored verbatim on `BuyerOpportunity.phone` (`unified-buyer-intake.service.ts:216`) (Buyer.phone is normalised to null — `:174`).

**R17** — Affiliate referral link → Lead + VR with `affiliate_id` (l.272)
- status: PARTIAL — click ledger + 30-day cookie + `Buyer.affiliateId` set-if-null at signup (`actions.ts:277-280`); first-touch enforced by `@@unique([referredUserId])` (`schema:3119`). No `affiliate_id` on `BuyerOpportunity`/`VehicleRequest`; a guest lead created by S1 with the cookie present gets no affiliate stamp until (and unless) they sign up; `utm_affiliate` only reaches `RevenueAttribution` for social posts (`social-click/route.ts:69`).
- required change: read `affiliate_ref` cookie in `/api/public/request-vehicle` and concierge; stamp `affiliate_id` on lead + VR; inherit on Deal (§6.5).

**R18** — Conversational intake / concierge → Lead + VR (l.273)
- status: ALREADY CORRECT (with gaps) — server-issued HMAC session (`concierge/route.ts:171-202`), lead gate validated server-side (:182), promotion bounded by gate/IP cap/conditional completion claim (:465-512), `promoteOpportunity` (:514). Gaps: no attribution passed (R3), consent text has no version (R5).
- stronger safeguards: fail-closed when `ZURA_SESSION_SECRET` missing (:171-176); conditional `updateMany(completed:false→true)` claim (:492-498); per-IP promotion cap.

**R19** — Call-back / talk-to-a-human → Lead with `call_reason` + staff task (l.274)
- status: MISSING (web) / PARTIAL (voice) — `BuyerOpportunity.callReason` exists and is written only by the voice receptionist (`lib/voice/dispatch-request.ts:397`, `handle-turn.ts:269`); no web callback form; no staff task object.
- required change: add a callback form posting to the unified service with `call_reason`; create a `queue_items`/staff task.

**R20** — Trade-in valuation → `trade_in_submissions` attached to a VR (l.275) and §6.2 (l.282-284)
- status: MISSING (EXTEND) — `TradeInSubmission` has no `vehicleRequestId`/`dealId` (`schema:2036-2055`) and none of `lienholder_name, payoff_good_through_date, title_in_hand, title_state, has_second_key, photo_urls, bringing_to_pickup`; public wizard trade goes to `BuyerOpportunity.tradeInDetails` JSON (`unified-buyer-intake.service.ts:235`) and the `/complete` step only into VR notes text (`complete/route.ts:93-100,155-168`); the buyer-portal trade (`/api/buyer/trade-in`) floats at buyer level.
- required change: add the columns; have S1/S17/S20 create a `TradeInSubmission` bound to the open VR; migrate JSON blobs.

**R21** — Prequalification attached to buyer (l.276) — status: ALREADY CORRECT (`app/api/buyer/prequal/route.ts:98-140`; `PrequalConsent` with exact FCRA text, IP, UA `prequal.service.ts:273-275`; location backfill `:300-321`).

**R22** — Buyer dashboard new request (l.277)
- status: PARTIAL — routes through unified intake (`requests/route.ts:200`); ZIP required (`page.tsx:285`); but no attribution, no consent capture, no one-open-request check (R6), no entry-type.

**R23** — Premium upgrade page (l.278) — out of intake scope; `SignUpClient.tsx:309` hidden `plan` and `/api/buyer/plan/upgrade` exist. UNVERIFIED for Deal snapshot.

### §6.3 Guest capture and account claim [BUILT]

**R24** — guest submits → guest buyer + draft VR → claim token issued and emailed → buyer sets password and verifies → same buyer + same VR claimed, never duplicated (l.288-290)
- status: BROKEN
- current: Guest buyer created (`unified-buyer-intake.service.ts:160-179`, `isGuest: true`, `supabaseId: guest_<uuid>`). Claim token (`BuyerRequestClaimToken`, hash-only, 5-day TTL, single-use race-safe) is issued **only** by the pre-checkout drain per touch (`lifecycle-touch-drain.service.ts:49-52`) and the resume route (`app/api/public/request/resume/[token]/route.ts:37-53`) consumes it and 302s to `/buyer/deposit` — it grants no capability and does not bind the visitor to the guest buyer. The real claim is `ensurePrismaUser` guest upgrade by email (`lib/auth/actions.ts:110-149`) + guest VR transfer (:193-207) + offer-page email re-link (`app/buyer/requests/[requestId]/offer/page.tsx:34-49`). **Dead end:** `signUpAction` refuses any existing `users.email` row — including `guest_*` rows — (`actions.ts:344-347`, both blocks landed in the same commit `0f4cd04` 2026-08-19), so a guest cannot "set a password and verify" with the same email; the guest-upgrade branch is unreachable from the buyer signup form. No test covers a guest signup (`grep -i guest lib/auth/__tests__` → 0).
- evidence: cited.
- stronger safeguards to preserve: hashed, single-use, race-safe token (`request-resume-token.service.ts:85-91`, tests `request-resume-token.test.ts:52-119`); resume route leaks no reason (:38-42); identity never derived from the token.
- required change: in `signUpAction`, if the existing user is a `guest_*` placeholder, proceed to `generateLink` (Supabase has no auth user yet) so `/auth/callback` reaches the guest-upgrade branch; alternatively make the claim-token route establish the claim (token → verified email match on callback). Add a failing-first test for guest→signup.
- notes: "Resending never creates a second buyer/request" — ALREADY CORRECT (only token rows are created).

**R25** — resend claim link (l.290 "Resending the claim link never creates a second buyer or request")
- status: PARTIAL — resume token is re-minted per touch (no duplicates); but `/api/auth/resend-verification` for a guest email calls `generateLink(type:"signup")` without a password (`route.ts:142-146`) — UNVERIFIED whether Supabase mints a link for a non-existent auth user; the route swallows errors and returns success (:172-177), so a guest would receive nothing.

### §6.4 Draft recovery sequence

**R26** — four touches: immediately / 1h / 24h / 72h with resume link; abandon at 14 days; never delete (l.294-303)
- status: PARTIAL
- current: Post-submission (a *complete* submission that has not paid): `form_submitted` → `check_form_completion_1/2/3` at 0 / +1h / +24h / +72h with a fresh resume token per send (`lifecycle-touch-drain.service.ts:439-499`; guard `preCheckoutResolved` `lib/qstash/state.ts:77-84`) — cadence matches spec exactly; touch 1 says "everything you entered is saved" but does not enumerate what was captured/what remains. Routing: internal plane only when `LIFECYCLE_INTERNAL_FORM_SUBMITTED` is ON (`lifecycle-scheduler.ts:186-200`); OFF branch dispatches to QStash `/api/jobs/form-submitted` — and the scheduler's own comment says QStash "has been removed from the stack" (`:87-91`), with failures swallowed into `jobs_dead_letter` (`lib/qstash/dispatch.ts:28-33`). Flag default value is UNVERIFIED (DB-backed `getFeatureFlag`). Pre-submission abandonment (LP Step 1): `form_abandonment` 3 touches (0/+23h/+72h) then `markInactive` on the CRM contact (`lead-nurture.service.ts:46-52`), CRM-only. Exit-intent: single touch. **No 14-day abandon marker on any lead/VR; no deletion (correct).**
- required change: add `abandonedAt` to VR/opportunity and a cron to stamp it at 14 days (no delete); make touch 1 list captured/missing fields; confirm the form_submitted flag is ON in production (or make it `flag: null` like `deposit_reminder`); extend the sequence to DRAFT captures (R7).

### §6.5 Attribution and affiliate credit [BUILT]

**R27** — captured at click, stamped on lead, carried onto VR, inherited by Deal, commission at completion, reversed on cancel/refund/chargeback (l.307)
- status: PARTIAL (intake portion) — click captured (`affiliate_clicks`), stamped on **Buyer** at signup only; not on lead or VR (R17). Commission timing/reversal belongs to the payments area — UNVERIFIED here.

### §7 Lane 2 — refinance

**R28** — form → `refinance_applications` with consent, timestamp, IP hash, state, source (l.313)
- status: ALREADY CORRECT — `refinance-lead.service.ts:85-103` (`consentGiven`, `consentTimestamp`, `ipHash` sha256, `state` upper, `source`); `consentGiven: z.literal(true)` (`route.ts:23`).

**R29** — state eligibility `EXCLUDED_STATE` (l.313) — ALREADY CORRECT — API-level 422 (`route.ts:48-59`) + service `qualify` (`:63-74`); `EXCLUDED_STATES` list (`:25`).

**R30** — redirect to OpenRoad with partner attribution; `redirected_at` (l.313) — ALREADY CORRECT — `markLeadRedirected` only from QUALIFIED (`:142-156`); `buildPartnerRedirectUrl` `aid=1445&opt_1=<leadId>` hard-fails on empty (`:158-175`); tested `partner-redirect.test.ts:18-43`.

**R31** — `refinance_compliance_logs` written (l.313) — ALREADY CORRECT (`:106-114`, every submission). Note raw `ipAddress` is stored on the log (`:111`) while the application stores only the hash — PII retention inconsistency (out-of-scope finding).

**R32** — "AutoLenis is a lead generator; every buyer-facing screen says so" (l.315) — UNVERIFIED (UI copy not read); service header documents the rule (`:3-7`).

**R33** — Crossover rule [NEW] (l.317): refinance applicant who indicates buying interest or later submits a Lane-1 form with same verified email/phone → Lane-1 lead+VR, records linked, neither status drives the other
- status: MISSING — `RefinanceApplication.buyerId` exists (`schema:2209-2210`) but has no writer (`grep buyerId lib/services/refinance app/api/public/refinance` → only the outreach drain reads it); no "interested in buying" field on the eligibility form (`grep -i buy eligibility/page.tsx` → 0); no link from intake to refinance. Status independence is trivially true today because there is no link.
- required change: add an `interestedInBuying` field; on Lane-1 intake, link `refinance_applications.buyer_id` when the **verified** email matches (never phone-only per rule 16); on refinance submit with buying interest, create a Lane-1 opportunity via `intakeBuyerRequest`.

**R34** — Reconciliation key confirmed with partner and stored on the application (l.319)
- status: PARTIAL / UNVERIFIED — the key sent is `opt_1 = RefinanceApplication.leadId` (cuid, `@unique`, `schema:2208`), stored on the row by construction; whether OpenRoad returns/accepts this as the reconciliation key is UNVERIFIED from code; no inbound partner-outcome ingestion exists (no `partner_reference`/`partner_status` columns).
- required change: confirm with partner; add `partner_reference`, `partner_outcome`, `partner_outcome_at` and an ingestion path.

### §8 Lane 3 — supply

**R35** — Dealer application → `dealer_applications` → review → approval creates dealers/rooftops/agreement (l.325) — ALREADY CORRECT for capture (`app/api/public/dealer-application/route.ts:26-53`, dedup on PENDING/APPROVED email); approval path `app/api/admin/dealers/applications/[appId]/approve/route.ts:70` (creates User) — rooftop/agreement creation UNVERIFIED (dealer area).
**R36** — Outside winner mid-transaction onboarding (l.327) — out of intake scope; `dealer-offer-outside/[token]` surface exists (S-list). UNVERIFIED.
**R37** — Affiliate application → `affiliates` + `affiliate_profiles` (l.331) — ALREADY CORRECT for capture (`app/api/affiliate/register/route.ts:94-100`, `:199-215`; auto-ACTIVE on verification; FTC ack timestamp). Profile/tax/payout are affiliate-portal forms (`components/affiliate/*`), non-transactional.
**R38** — Dealer prospecting pipeline separate; outreach log supports SMS/calls (l.335) — out of scope (dealer-recruitment area). Lane separation confirmed: none of these write buyer/VR rows.

### §9 Lane 4 — support

**R39** — Contact/help/testimonial/preference create support records; never create/advance a transaction; link to open VR for context (l.339)
- status: PARTIAL — non-advancing is ALREADY CORRECT (contact/feedback write `notifications` only; testimonials require a COMPLETED deal `app/api/buyer/testimonials/route.ts:15`; unsubscribe routes write suppression/affiliate flags). **No buyer identification or open-VR link** from contact/feedback (`contact/route.ts:100-107` free-floating SYSTEM_ALERT; CRM contact upsert only when SMS consent). No `conversations` support object.
- required change: on contact submit, resolve buyer by verified email match only for *linking context* (no mutation), attach `buyer_id`/`vehicle_request_id` to the notification/timeline.

### §34 form walk (l.1574)

**R40** — every form walked and proven to land in its lane with attribution, ZIP, consent, no duplicate buyer / second open request
- status: MISSING — no Playwright spec exercises the public forms (`e2e/deal-autopilot.spec.ts` only; `tests/visual` has refinance screenshots only). Unit coverage: `promote-opportunity.test.ts`, `unified-intake-emit.test.ts`, `no-phone-keyed-buyer-mutation.test.ts`, `buyer-phone-normalization.test.ts:175`, `request-resume-token.test.ts`, `resume-route.test.ts`, `concierge-hardening.test.ts`, `partner-redirect.test.ts`. No test for duplicate-buyer/second-open-request, guest→signup claim, attribution default, or consent persistence.

### Master rule 16 — identity resolution order (authenticated buyer id → valid claim token → normalised VERIFIED email; never name, unverified phone, fuzzy)

**R41** — status: PARTIAL / BROKEN in three places
- Compliant: `resolveBuyerId` uses `buyerId` first, then `users.email` unique lookup (`unified-buyer-intake.service.ts:118-131`); phone is normalised (`:153,174`) but never used as a key (test `no-phone-keyed-buyer-mutation.test.ts:39-52` guards `/api/finder`); offer-page re-link uses the authenticated buyer's own verified email (`offer/page.tsx:34-49`); `getRequestBuyer`/`getAuthenticatedBuyer` derive from Supabase JWT and refuse unconfirmed email (`lib/auth/session.ts:17`).
- Violations: (a) `/api/public/request-vehicle/complete` mutates the most-recent VR of whichever buyer owns an **unverified, caller-supplied email** (`complete/route.ts:137-168`) — anyone who knows an email can rewrite that buyer's request; (b) public intake treats an unverified email as identity and **attaches to an existing registered buyer** (`:133-143`) — a stranger submitting with a registered buyer's email links a new VR (and backfills ZIP) onto that account; (c) voice dispatch creates a Supabase account with `email_confirm: true` for a spoken, unverified email (`dispatch-request.ts:144-148`); (d) the claim token is never used as an identity step (R24).
- required change: `/complete` must key on the claim/resume token or the session; public intake must create a guest opportunity and *not* attach to a registered buyer until the email is verified (or attach only the opportunity, not a VR, and merge at verified sign-in); voice must not auto-confirm email.

### Master rule 17 — attribution default

**R42** — status: PARTIAL — individual fields are nullable and no `"direct"` literal is written into URL/affiliate/IP fields (correct); but no acquisition-channel field exists to hold `direct` (R3).

### Duplicate-buyer root cause (production: two verified emails, same phone, both via dashboard registration)

**R43** — status: BROKEN (explained)
- Path: (1) buyer registers with email A (`signUpAction` → `generateLink` → `/auth/callback` → `ensurePrismaUser` creates `users`+`buyers`, `actions.ts:151-173`); phone is **not collected at signup** (`SignUpClient.tsx:313-330` has no phone field) and is added later by onboarding via `PATCH /api/buyer/profile` (`profile/route.ts:66`) with **no lookup of other buyers by phone** (correct under rule 16, but no flag). (2) Later the same person registers with email B — the only dedup is `users.email` (`actions.ts:344`); nothing consults phone or the existing buyer, so a second `users`+`buyers` pair is created, and the same phone is written again at onboarding. A plausible trigger for (2) is the guest dead end in R24: a public-form guest with email A cannot sign up ("already exists") nor sign in (no auth user), so they register with email B. Whether that was the actual trigger is UNVERIFIED (needs `users.supabase_id LIKE 'guest_%'` / `created_at` ordering from production).
- Rule-16-compliant behaviour: never auto-merge on phone; (i) make guest placeholders claimable through signup (verified email), (ii) on any buyer phone write, if another buyer already carries the same normalised phone, write a `CircumventionAttempt`/Operations exception "possible duplicate buyer" for human merge, (iii) expose an audited admin merge (none exists — `grep -i 'merge.*buyer' scripts lib/services/admin app/api/admin` → 0).

---

## Duplicates

- D1 — Two paid-vs-organic Lane-1 forms deliberately kept separate by design: `LandingPageClient.tsx` inline form and `components/seo/landing/VehicleRequestForm.tsx` (header comment `VehicleRequestForm.tsx:6-14`), plus the six-step `RequestVehicleFormClient.tsx`. Three UIs, one endpoint — acceptable but consent handling diverges (R5).
- D2 — Two conversational intakes: `/api/concierge` (live) and `/api/finder` (no caller; `VehicleFinder.tsx:52` posts to concierge). Delete `/api/finder`.
- D3 — Two "lead" records per submission: `BuyerOpportunity` (canonical lead) and a `Notification` SYSTEM_ALERT row used as the admin vehicle-request queue (`request-vehicle/route.ts:592-615`), plus `SocialLead` for social sources and CRM `contacts`. Four lead planes.
- D4 — Two pre-checkout reminder implementations: internal `lifecycle_touch_schedule` (`lifecycle-touch-drain.service.ts:430-505`) and QStash `/api/jobs/check-form-completion` (`app/api/jobs/check-form-completion/route.ts`); routing switch per flag (`lifecycle-scheduler.ts`). Only one fires per flag, but the QStash side is documented as removed.
- D5 — Two buyer-identity planes: `buyers` (email-only dedup) and CRM `contacts` (email→phone dedup, `contact.service.ts:29-48`).
- D6 — Two guest-claim mechanisms: email-match upgrade in `ensurePrismaUser` and email re-link on the offer page; the claim-token table is a third, unrelated (resume-only) mechanism.

## Stronger safeguards to preserve

- Server-issued HMAC concierge session; fail-closed without secret; promotion requires server-verified gate; conditional completion claim; per-IP daily promotion cap (`concierge/route.ts:171-202, 465-512`).
- Resume token hashed at rest, 256-bit, single-use race-safe, no reason leakage (`request-resume-token.service.ts`, `resume/[token]/route.ts`).
- Phone never used as a buyer identity key; `/api/finder` performs no Buyer read/write (test `no-phone-keyed-buyer-mutation.test.ts`).
- Phone normalised to E.164 or NULL (never `''`) on every Buyer write (`unified-buyer-intake.service.ts:153,174`; `profile/route.ts:65-66`; tests).
- Never overwrite an existing buyer ZIP (`unified-buyer-intake.service.ts:137-142`); prequal location backfill fill-if-null (`prequal.service.ts:300-321`).
- Shortlist radius/freshness gate fails closed on an unplaceable buyer (`shortlist/route.ts:47-79`).
- $99 gate on dealer outreach and dealer fan-out (`post-intake-outreach.service.ts:152-164`; `dealer-opportunity-notification.service.ts:47-51`).
- Contact form refuses a phone without explicit SMS consent (`contact/route.ts:43-46`); CRM upsert fails closed on lookup error and on ambiguous phone match (`contact.service.ts:52-70`).
- Refinance: consent literal-true, EXCLUDED_STATE hard block, QUALIFIED-only redirect, hard-fail on empty subid.
- Intake-reconcile eligibility window (48h) prevents backlog auto-processing; dead-letter after MAX attempts (`BuyerOpportunity.intakeFailedAt`).
- Affiliate first-touch wins (`@@unique([referredUserId])`); self-referral blocked (`actions.ts:255-261`); IPs hashed with salt.

## Legacy paths

- `/api/finder` (dead), `/api/public/request-vehicle/complete` (email-keyed VR mutation), `Notification` SYSTEM_ALERT as request queue, QStash `/api/jobs/form-submitted` + `/api/jobs/check-form-completion`, `BuyerOpportunity.source` string as channel, `SmsOptOut` table (no writer), `Buyer.optedOutSms` flag (drifts vs `sms_suppression`), `GHL_*_WEBHOOK_URL` fire-and-forget syncs from routes (`request-vehicle/route.ts:483-507`, `partial-lead/route.ts:54-70`, `ThankYouClient.tsx:87-100` client-side webhook with `NEXT_PUBLIC_` URL).

## Out-of-scope findings

- No rate limiting on `/api/public/request-vehicle`, `/complete`, `/api/public/crm/partial-lead`, `/api/leads/lead-magnet`, `/api/tools/dealer-fee-lead`, `/api/public/refinance`, `/api/public/contact` (grep → 0); all are CSRF-exempt (`proxy.ts:272-273`) and create rows (users/buyers/opportunities) → abuse vector.
- `refinance_compliance_logs.ip_address` stores the raw IP while the application stores a hash (`refinance-lead.service.ts:99,111`).
- `ThankYouClient.tsx:87-100` posts email+campaign to a GHL webhook from the browser via `NEXT_PUBLIC_GHL_THANKYOU_WEBHOOK_URL`.
- LP sends `phone: "Not provided"` literal into `BuyerOpportunity.phone`.
- Voice dispatch auto-confirms a spoken email (`dispatch-request.ts:147`).
- `createAuction` at deposit activation is called without a `vehicleRequestId` (`deposit-activation.service.ts:207`) — lineage break, belongs to Stage 5/7 area.

## UNVERIFIED items

- Runtime value of feature flag `lifecycle_internal_form_submitted` in production (DB-backed).
- Whether Supabase `generateLink(type:"signup")` without password mints a link for a never-registered guest email (resend path).
- Exact fields carried by `similarHref` ("Find one like this" prefill).
- `BUYER_INTAKE_PATH` constant value in `lib/seo/buyer-cta.ts`.
- Refinance UI disclosure copy ("lead generator" on every screen).
- OpenRoad's acceptance of `opt_1=leadId` as the reconciliation key; no partner outcome ingestion exists.
- Whether Gemini Maps / Groq Compound / prospect-email enrichment incur metered cost pre-deposit (code calls them pre-deposit; cost model not in code).
- Whether the production duplicate pair was triggered by the guest dead end (needs `users.supabase_id`/`created_at` inspection — not performed).
- Onboarding wizard SMS consent transmission (documented as not sent in BUYER-LOCATION-GAP; not re-read this session).
- Dealer approval creating rooftops/agreement signatures; affiliate profile/tax/payout tables.

## Open questions for the owner

1. Should lead-only captures (lead magnet, fee calculator, LP Step-1, exit-intent) create a DRAFT Vehicle Request, or remain pre-lane CRM leads?
2. Is pre-deposit Gemini/Groq/Apollo enrichment an accepted spend? If not, R8 requires gating three more stages.
3. Should a public submission with a registered buyer's (unverified) email attach to that buyer at all before verification (rule 16 says no)?
4. Confirm the OpenRoad reconciliation key and whether partner outcomes will be ingested.
5. Approve the rule-16-compliant duplicate handling: flag + human merge on phone collision, never auto-merge.
6. Confirm `LIFECYCLE_INTERNAL_FORM_SUBMITTED` is ON in production (otherwise the §6.4 sequence for website submissions is dead-lettered).

---

## Verification corrections (adversarial pass)

Second, independent re-check of every ALREADY CORRECT / MISSING / BROKEN / DUPLICATED row and a sample of PARTIAL rows against running code at HEAD 0cd399f (static read only; no DB, no build). Paths relative to `frontend/`. Format: `spec_ref | original → corrected | reason | evidence`.

**C1 — R4 §5 rule 3 (l.250) | PARTIAL → PARTIAL (row content corrected)** | The row's claim that ZIP is "backfilled onto an existing buyer's NULL zip" is true only for the email-resolved public path. `resolveBuyerId` returns `input.buyerId` verbatim before any zip logic, so the dashboard (`buyer_dashboard`), voice, and every caller that passes `buyerId` never reach the backfill. A dashboard submission with a ZIP therefore leaves `buyers.zip` NULL — exactly the production shape (opportunity zip 75035, buyer zip NULL). The dashboard form reads ZIP from the profile but never writes it back. | `lib/services/acquisition/unified-buyer-intake.service.ts:118` `if (input.buyerId) return input.buyerId;` vs `:138-142` (backfill inside Case 1 only); `app/api/buyer/requests/route.ts:173,179` `buyerId: buyer.id … zip: body.zip ?? buyer.zip`; `app/buyer/requests/new/page.tsx:239-244` (reads `/api/buyer/profile` zip, no write-back); `prisma/schema.prisma:1022-1067` (no `zip` on VehicleRequest).

**C2 — R5 §5 rule 4 (l.251) | PARTIAL → PARTIAL (UNVERIFIED sub-items resolved to BROKEN)** | (a) Onboarding SMS consent is captured in UI state and gates the submit button but is never transmitted or persisted — the submit body carries name + phone only. (b) Google-OAuth signups store no terms acceptance/version: the callback forwards `user_metadata.termsAcceptedAt/termsVersion`, which OAuth metadata does not carry, so `Buyer.termsAcceptedAt/termsVersion` are written NULL. (c) The public wizard's `agreedToContact`/`consent_sms` are persisted only inside `Notification.metadata` via a spread of the entire form (together with income/employer/credit-score PII). | `components/buyer/OnboardingWizardClient.tsx:123,134` (state + gate), submit block at `:144-149` sends `{ phone }` only (no `smsConsent`); `app/auth/signup/SignUpClient.tsx:38-41` + `app/auth/callback/route.ts:27-42` → `lib/auth/actions.ts:127-128,166-167` (`termsVersion ?? null`); `app/api/public/request-vehicle/route.ts:603-609` `metadata: { ...data, … }`.

**C3 — R6 §5 rule 5 (l.252) | BROKEN → BROKEN (confirmed; note added)** | `hasActiveRequest` has exactly one occurrence in non-test code — its own definition. The `autolenis-buyer-journey` skill (rule 6) asserts the single-active-request rule is enforced; the skill is stale relative to code. Two other code paths assume multiple open VRs per buyer. | `lib/services/vehicle-request/vehicle-request.service.ts:21` (only hit of `rg hasActiveRequest app lib scripts`); `app/api/buyer/requests/route.ts:128` (only `checkRateLimit`); `app/api/public/request-vehicle/complete/route.ts:143-147` (`findFirst … orderBy createdAt desc`); `lib/qstash/state.ts:82-88`.

**C4 — R3 §5 rule 2 (l.249) / master rule 17 | PARTIAL → PARTIAL (row content corrected)** | The row says attribution is "stamped on the lead"; it is not — `BuyerOpportunity` has no `utm_*`, `source_url`, `referrer`, `landing_source`, `affiliate_id` or `ip_address` column at all, only a free-text `source`. Only `VehicleRequest` carries attribution, and `ip_address` is written by no intake path. Voice smuggles the channel into `utmSource: "voice-receptionist"`. | `prisma/schema.prisma:3891-3960` (BuyerOpportunity — no utm/ip columns); `:1036-1044` (VehicleRequest columns); `rg "ipAddress|ip_address" lib/services/acquisition app/api/public/request-vehicle app/api/buyer/requests app/api/concierge lib/voice` → only `request-vehicle/route.ts:476` (CRM contact); `lib/voice/dispatch-request.ts:215`.

**C5 — R8 §5 rule 7 (l.254) | PARTIAL → PARTIAL (confirmed)** | `intake-pipeline.service.ts` contains no `isFulfillmentUnlocked` call; market enrichment, dealer discovery (Gemini Maps / Groq Compound) and prospect-email enrichment run pre-deposit. Only outreach and dealer fan-out are gated. Metered-cost claim remains UNVERIFIED from code. | `lib/services/acquisition/intake-pipeline.service.ts:377,436,496`; `rg isFulfillmentUnlocked lib app` → `post-intake-outreach.service.ts:159`, `dealer-opportunity-notification.service.ts:49`, `ai/action-intent/*` only.

**C6 — R12 §6.1 Shortlist (l.267) | PARTIAL → PARTIAL (path corrected)** | The cited file lives under `lib/services/auction/`, not `lib/services/deposit/`. Confirmed: settlement launches the auction with no Vehicle Request although `createAuction` accepts one and the admin launch route passes it. | `lib/services/auction/deposit-activation.service.ts:207` `createAuction(loaded.buyerId, depositId)`; `lib/services/auction/auction.service.ts:20` `createAuction(buyerId, depositId, vehicleRequestId?)`; `app/api/admin/buyers/[buyerId]/launch-auction/route.ts:150`.

**C7 — R13 §6.1 Find one like this (l.268) | PARTIAL (prefill UNVERIFIED) → PARTIAL (prefill verified ALREADY CORRECT)** | `buildSimilarRequestHref` carries make, model, trim, year ±1, a mileage band, a price band and capped features; `/buyer/requests/new` reads all of them and takes ZIP from the profile. Every field the spec names is pre-filled. Remaining gap is only the missing `entry_type` and the R3/R6 defects common to all dashboard submissions. | `lib/services/shortlist/shortlist-availability.ts:104-121`; `app/buyer/requests/new/page.tsx:175-204,239-244`; `app/(public)/inventory/[vehicleId]/page.tsx:122,365-366`.

**C8 — R15 §6.1 Blog / content CTA (l.270) | PARTIAL → MISSING** | `BUYER_INTAKE_PATH` is `/for-buyers`. That page contains no form; every CTA on it links to `/auth/signup`, and it never reads the `city/state/make/model` query the article CTA appends. A blog reader therefore produces no lead and no VR draft; the only artefact is the last-touch cookie, consumed only if the reader later completes S1/S18. | `lib/seo/buyer-cta.ts:14` `const BUYER_INTAKE_PATH = "/for-buyers";`; `app/(public)/for-buyers/page.tsx:202,346,415,601,624` (`href="/auth/signup"`), `rg "searchParams|make|city|fetch\(" app/\(public\)/for-buyers/page.tsx` → no reads.

**C9 — R16 §6.1 Social posts / campaigns (l.271) | ALREADY CORRECT → PARTIAL** | A `social_leads` row is written only when `utm_source` is one of five platforms or the campaign slug matches a nine-item allow-list; any other paid LP campaign produces no `social_leads`. The write is best-effort inside `after()` with no retry or dead-letter — a failed insert is logged and lost. The LP substitutes the literal `"Not provided"` for an empty phone, which is stored verbatim on `BuyerOpportunity.phone` and forwarded to GHL. `SocialLead` carries no consent fields. Conversion stamping on deal exists. | `app/api/public/request-vehicle/route.ts:344-362,363-399`; `app/(public)/lp/[campaign]/LandingPageClient.tsx:424`; `lib/services/acquisition/unified-buyer-intake.service.ts:216`; `prisma/schema.prisma:5568-5610`; `lib/social/attribution.service.ts:246-256`.

**C10 — R18 §6.1 Conversational intake (l.273) | ALREADY CORRECT (with gaps) → PARTIAL** | The promotion passes no attribution (utm/source_url/referrer/landing_source/ip) so the VR is created with all-NULL attribution (rule 2); the `email` handed to `promoteOpportunity` is the gate-supplied, unverified email, so `resolveBuyerId` Case 1 attaches the VR to whichever registered buyer owns that email (rule 16); `lastName` is never captured. The server-issued HMAC session, gate check, per-IP cap and conditional completion claim are confirmed as stronger safeguards. | `app/api/concierge/route.ts:515-527` (call carries only firstName/email/phone/zip/make/model/year/budget), `:171-202,465-512`; `unified-buyer-intake.service.ts:128-143`.

**C11 — R24 §6.3 Guest claim (l.288-290) | BROKEN → BROKEN (qualified)** | The guest-upgrade branch is NOT wholly unreachable: Google OAuth sign-up/sign-in goes `signInWithOAuth` → `/auth/callback` → `exchangeCodeForSession` → `ensurePrismaUser`, which upgrades a `guest_` user by email. So a guest whose email is a Google account can claim; the spec's stated path ("sets a password and verifies") is still dead-ended by `signUpAction`'s refusal of any existing `users.email`, and the OAuth claim records no terms version (C2b). | `app/auth/signup/SignUpClient.tsx:38-41`; `app/auth/signin/SignInClient.tsx:45-46`; `app/auth/callback/route.ts:26-42`; `lib/auth/actions.ts:110-149` (upgrade), `:344-347` (refusal); `rg -il guest lib/auth/__tests__` → 0.

**C12 — R25 §6.3 resend claim link (l.290) | PARTIAL / UNVERIFIED → BROKEN (static)** | The Supabase SDK contract for `generateLink({ type: "signup" })` requires `password`; the resend route omits it, hiding the mismatch behind a local cast, and swallows every error into a 200. A guest (no Supabase auth user) therefore cannot obtain a link from this route by construction; only the GoTrue runtime response remains UNVERIFIED. | `node_modules/.pnpm/@supabase+auth-js@2.104.0/node_modules/@supabase/auth-js/dist/module/lib/types.d.ts:733-738` (`password: string` required); `app/api/auth/resend-verification/route.ts:136` (cast to `GenerateLinkAdmin`), `:142-146` (no password), `:172-177` (errors swallowed, `success: true`).

**C13 — R26 §6.4 Draft recovery (l.294-303) | PARTIAL → PARTIAL (row content corrected; cadence claim withdrawn)** | (a) The cadence does NOT "match the spec exactly": touch 4 is delayed 72h after touch 3, landing at ≈+96h from submission; the spec's timings are absolute (immediately / 1h / 24h / 72h) and the code itself uses the absolute convention for touch 3 (23h delay "→ ~+24h"). (b) The feature-flag default is now known from code: `getFeatureFlag` returns `false` when no row exists and the FLAGS block says "ALL DEFAULT OFF", so with no `FeatureFlag` row the website `form_submitted` workload goes to the QStash branch the scheduler describes as removed, and any dispatch failure is dead-lettered (production row value still UNVERIFIED). (c) Touches 2–4 are `deliverToContactOnly`, so a buyer with no linked CRM contact receives touches 2–4 from neither path. | `lib/services/crm/lifecycle-touch-drain.service.ts:454` (+1h), `:474` (+23h), `:494` (+72h), `:460,480,500`, `:730-733`; `lib/services/admin/admin-platform.service.ts:24-27` `flag?.enabled ?? false`; `lib/services/system/feature-flags.service.ts:15-29`; `lib/services/crm/lifecycle-scheduler.ts:87-91,185-207`; `lib/qstash/dispatch.ts:19-40`.

**C14 — R29 §7 state eligibility / EXCLUDED_STATE (l.313) | ALREADY CORRECT → PARTIAL** | The route answers 422 BEFORE `submitRefinanceLead`, and the client disables submit for an excluded state, so a `refinance_applications` row with status `EXCLUDED_STATE` is never written from any public caller; the service branch that would set it is unreachable. The spec orders "written → evaluated". No test references `EXCLUDED_STATE`. | `app/api/public/refinance/route.ts:47-59` (return before `:67`); `app/(public)/refinance/eligibility/page.tsx:89-95,147-148`; `lib/services/refinance/refinance-lead.service.ts:64-66`; `rg EXCLUDED_STATE --type ts -g '*.test.ts'` → 0.

**C15 — R31 §7 compliance logs (l.313) | ALREADY CORRECT → PARTIAL** | "Written on every submission" holds only for submissions that pass the 422 gate; excluded-state submissions leave no application and no `refinance_compliance_logs` row (same evidence as C14; log write at `refinance-lead.service.ts:106-114` runs only inside `submitRefinanceLead`).

**C16 — R30 §7 redirect (l.313) | ALREADY CORRECT → ALREADY CORRECT (confirmed)** | `POST /api/public/refinance/redirect` accepts only `leadId`, transitions only from QUALIFIED, and returns a server-built partner URL — no client-controlled destination. | `app/api/public/refinance/redirect/route.ts:11-13,66-83`; `refinance-lead.service.ts:142-175`.

**C17 — R33 §7 crossover (l.317) | MISSING → MISSING (confirmed)** | `RefinanceApplication.buyerId` is read only by the outreach drain; no writer under `lib/services/refinance`, `app/api/public/refinance` or the refinance pages; no "interested in buying" field. | `rg buyerId lib/services/refinance app/api/public/refinance app/\(public\)/refinance` → `refinance-outreach-drain.service.ts:59-175` reads only; `prisma/schema.prisma:2209-2210`.

**C18 — R35 §8.1 Dealer application (l.325) | ALREADY CORRECT (capture) → PARTIAL** | Approval creates `users` + `dealers` (status PENDING) only. It creates no `dealer_rooftops` row (rooftops are minted by the rooftop service and the Apollo org-match path) and no `dealer_agreement_signatures` row (created at the onboarding agreement step). Capture-side dedup on PENDING/APPROVED email is confirmed. `dealer_applications` carries no attribution or consent fields although §5 rules 2/4 apply to every lane. | `app/api/admin/dealers/applications/[appId]/approve/route.ts:69-95`; `rg "dealerRooftop.create|dealerAgreementSignature.create"` → `lib/services/dealer/dealer-rooftop.service.ts:141`, `lib/services/dealer-recruitment/apollo-org-match.service.ts:131`, `lib/services/agreement/dealer-agreement.service.ts:77`; `app/api/public/dealer-application/route.ts:18-33,65-77`.

**C19 — R37 §8.2 Affiliate application (l.331) | ALREADY CORRECT → ALREADY CORRECT (evidence corrected)** | `affiliate_profiles` is not created at registration; it is upserted in the onboarding profile step, which matches the spec's sequence. Registration is IP- and email-rate-limited — a stronger safeguard than any Lane-1 public route. | `app/api/affiliate/register/route.ts:85-91,93-101,198-223`; `app/api/affiliate/onboarding/profile/route.ts:44`.

**C20 — R40 §34 form walk (l.1574) | MISSING → MISSING (evidence corrected)** | Playwright coverage is broader than "deal-autopilot only": `tests/e2e/{dealer-funnel,affiliate-portal,buyer-remediation,dealer-outreach}.spec.ts` run under `playwright.e2e.config.ts`. None navigates to a public intake form (targets are `/dealer/claim`, `/dealer/sign-in`, `/affiliate/portal/*`, `/buyer/*`, `/admin/*`). | `playwright.e2e.config.ts:23`; `rg "goto\(" tests/e2e/*.spec.ts`.

**C21 — R41 master rule 16 | PARTIAL/BROKEN → PARTIAL/BROKEN (evidence strengthened)** | The `/complete` identity is a shareable URL parameter: `/thank-you` reads `email` from the query string and posts it; `/api/public/crm/thank-you-view` writes a CRM timeline row keyed on the same unverified email. Voice `email_confirm: true` and public-intake Case 1 attachment confirmed. | `app/(public)/thank-you/ThankYouClient.tsx:41,114-118`; `app/api/public/crm/thank-you-view/route.ts:18-35`; `lib/voice/dispatch-request.ts:144-148`; `unified-buyer-intake.service.ts:133-143`.

**C22 — D2 `/api/finder` | DUPLICATED → DUPLICATED (confirmed; extended)** | `/api/finder` has no caller. `VehicleFinder.tsx` posts to `/api/concierge` with a client `sessionId` in the body and never sends the `X-Zura-Session` handle header, which the server requires (body `sessionId` is ignored) — so every turn would start a fresh session; and `VehicleFinder` itself has no mount anywhere. Both the route and the component are dead code. `/api/finder` performs no buyer/user/VR writes (rule-16 safe). | `rg "api/finder" app components lib` → only `app/api/finder/route.ts`; `components/acquisition/VehicleFinder.tsx:22,43,52-56`; `lib/services/ai/zura-session-handle.ts:38`; `app/api/concierge/route.ts:168-170`; `rg VehicleFinder app components -l` → the component file only; `rg "prisma\.(buyer|user|vehicleRequest)" app/api/finder/route.ts` → 0.

**C23 — D4 pre-checkout reminder duplication | DUPLICATED → DUPLICATED (confirmed)** | Both `app/api/jobs/form-submitted` and `app/api/jobs/check-form-completion` exist alongside the internal drain; selection is by flag whose default is OFF (C13). | `ls app/api/jobs` (both present); `lifecycle-scheduler.ts:185-207`.

**C24 — R21 §6.1 Prequalification (l.276), R28 §7 capture (l.313), R39 §9 (l.339), R7/R9/R10/R11/R14/R19/R20 MISSING rows, R43** | status unchanged (confirmed) | Re-read each cited line: `prequal.service.ts:269-278,300-323`; `refinance-lead.service.ts:76-114` + `route.ts:23`; `contact/route.ts:97-128` + `feedback/route.ts:73-81`; `schema.prisma:1654-1666` (no DRAFT), `:2036-2058` (TradeInSubmission), `:3891-3960` (`callReason` only voice-written `dispatch-request.ts:397`); `app/(public)/page.tsx:120,338`; `app/(public)/intelligence/[slug]/page.tsx:157-158` (only link is `/author/markist`); `rg -i "inventory_item_id|entryType|entry_type|INVENTORY_SELECTION|CUSTOM_REQUEST"` on VR/intake code → 0 (the only request↔inventory link is `VehicleRequestMatchResult`, `schema.prisma:3241-3256`, a sourcing output, not an entry-type/candidate input); callback/"talk to a human" grep across `app/(public)`, `components/public`, `components/buyer`, `app/api/public` → 0.

### Requirements in §5–§9 / §34 not covered by the original map

- **§5 rules 2 & 4 for Lanes 2–4** (l.246 "apply to every form in every lane"): `dealer_applications` (no utm/source_url/referrer/ip/consent columns — `app/api/public/dealer-application/route.ts:18-33`), affiliate register (no attribution beyond referral code; FTC ack timestamp only — `register/route.ts:216-219`), contact/feedback (no attribution; SMS consent text stored in `Notification.metadata` + CRM contact only — `contact/route.ts:71-73,100-107`). Status: MISSING for attribution, PARTIAL for consent.
- **§5 rule 4 terms acceptance with version for guests and OAuth signups**: guest buyers created by `resolveBuyerId` Case 3 have no `termsAcceptedAt/termsVersion` (`unified-buyer-intake.service.ts:169-178`); OAuth signups get NULL (C2b). Status: PARTIAL.
- **§6 lead-in (l.258) "drafted or complete, carrying attribution and location"**: no VR carries location (no zip/city/state column); no VR is ever "drafted". Status: MISSING (distinct from R4/R7, which cover the rule text).
- **§6.4 "applies to ANY incomplete Lane 1 capture"**: lead-magnet (`lead-magnet-sequence.ts`, own cadence), fee-calculator, exit-intent (single touch — `lead-nurture.service.ts:27-28`), and abandoned concierge opportunities (`completed:false`, no enrolment) are not in a 4-touch resume sequence. Status: PARTIAL (only LP Step-1 and post-submission are enrolled).
- **§9 "preference changes create support records"**: `/api/buyer/settings` / notification-preference writes were not traced for an audit/support record. Status: UNVERIFIED.
- **Security control — rate limiting on public intake**: no `limitGeneral`/`limitAuthAttempt`/`checkRateLimit` in `app/api/public/request-vehicle`, `app/api/public/crm/*`, `app/api/leads/*`, `app/api/tools/*`, `app/api/public/refinance`, `app/api/public/contact`, `app/api/public/dealer-application` (rg → 0); all are CSRF-exempt (`proxy.ts:271-283`); `/api/public/request-vehicle` creates `users`+`buyers` rows unauthenticated. The affiliate register route shows the intended pattern (`register/route.ts:85-91`). Status: MISSING (in-scope for intake; was listed as out-of-scope).
- **PII retention in `Notification.metadata`**: the whole wizard payload (annual/monthly income, employer, credit score, housing payment, trade VIN, consent flags) is spread into a `Notification` row (`request-vehicle/route.ts:603-609`) with no encryption or retention rule (auth-security skill rule 6). Status: BROKEN (security).

### Stronger safeguards confirmed on this pass (preserve)

- Affiliate registration IP + email rate limit (`app/api/affiliate/register/route.ts:85-91`).
- Concierge ignores client `sessionId`; fails closed without secret; gate-verified consent; conditional completion claim (`concierge/route.ts:168-202,465-512`).
- Refinance redirect accepts only `leadId`; partner URL is server-built (`redirect/route.ts:11-13,66-83`).
- Shortlist server-side radius/freshness gate (`app/api/buyer/shortlist/route.ts:48-79`).
- `notifyContact` SMS path hard-gates on `contacts.consent_sms`, `do_not_contact` and `sms_suppression` (`lib/qstash/notify.ts:109-116`).
- Resume token: SHA-256 at rest, 5-day TTL, conditional single-use consume (`lib/services/buyer/request-resume-token.service.ts:22-25,44-55,86-88`).
