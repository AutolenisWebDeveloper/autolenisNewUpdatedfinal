# AUTOLENIS — 14-Layer CRM / Marketing-Automation Spec · Gap Matrix

**Session:** CRM spec audit · **Date:** 2026-06-16 · **Branch:** `claude/blissful-johnson-ggn397`
**Scope:** Layer-by-layer audit of the "CRM, Lead Capture, Email, SMS & Marketing Automation System" spec against the current codebase (`frontend/`). Read-only audit; build order proposed at the end. Status legend: ✅ built · 🟡 partial · ❌ missing.

---

## EXECUTIVE SUMMARY

The platform already implements the **large majority** of the 14-layer spec. The automation spine is mature: a signed Make.com event bridge (`lib/events/emit.ts` → `lib/events/make-webhook.ts`), a graph-based workflow engine (`lib/services/workflow.engine.ts`) with delay/branch/sequence support, **24 prebuilt workflows** (`lib/services/workflow.prebuilt.ts`), a 4-channel dispatch layer (`app/api/crm/dispatch/{email,sms,task,score}`), 41 Resend email templates, TCPA-hardened SMS (`lib/services/sms/crm-sms.ts`) with consent/suppression/quiet-hours, a rule-based segment engine, and a no-downgrade lead-score policy.

The genuine gaps cluster into **six concrete, well-specified items**. The single highest-value gap is **Layer 4: action-level lead scoring** — the spec defines exact point values for 10 behaviors, but only the vehicle-request signal currently influences the score. Because scoring feeds segmentation (Layer 5) which feeds automation (Layer 6), wiring it closes the connective tissue of the whole funnel.

| Layer | Coverage | Top gap |
|---|---|---|
| 1 Lead Capture | ~85% ✅ | Vehicle-match quiz; unified alert engine |
| 2 CRM System of Record | ~80% ✅ | No unified Prisma `Contact` (lives in Supabase); fragmented consent |
| 3 Behavioral Tracking | ~70% 🟡 | Email open/click + SMS delivery webhooks; page-view/visit granularity |
| **4 Lead Scoring** | **~40% 🟡** | **Action-based scoring not wired (9 of 10 spec signals)** |
| 5 Segmentation | ~65% 🟡 | Spec's named segments not seeded |
| 6 Make.com Brain | ~90% ✅ | Inbound Make callback hardening; per-step retry/analytics |
| 7 Email Campaigns | ~85% ✅ | Trade-In campaign; campaign scheduler cron |
| 8 SMS Campaigns | ~80% ✅ | Twilio inbound (STOP/HELP) webhook; market-alert templates |
| 9 Internal Tasks | ~70% 🟡 | High-lead-score → priority-outreach auto-task |
| 10 Attribution | ~80% ✅ | Multi-touch + post-deal milestones; unified report |
| 11 Retargeting | ~45% 🟡 | Only non-converting social audience; other 9 audiences absent |
| 12 Dealer Growth | ~80% ✅ | Auto tier promotion/demotion from scorecard |
| 13 Affiliate Growth | ~80% ✅ | Payout-processor integration (stubbed); affiliate-facing dashboard |
| 14 Customer Success | ~50% 🟡 | Day 30 / 60 / 365 milestones (only 7d + 180d exist) |

---

## LAYER-BY-LAYER DETAIL

### Layer 1 — Lead Capture Engine — ~85% ✅
**Built:** `VehicleRequest`, `VehicleRequestFinancing` (incl. lease fields), `SavedSearch`, `Shortlist`/`ShortlistItem`, `TradeInSubmission`, `RefinanceApplication`, `FinancingScenario`, `ContentArticle` (articles + buying guides), `AmipsPage` (market reports), lead-magnet capture (`/api/leads/lead-magnet`), `SocialPost`/`SocialLead` (all 5 platforms), `Conversation`/`AiChatSession` (Zura), `Affiliate`/`AffiliateClick`, `CreatorNetwork`/`CreatorAttribution`, `Dealer` onboarding.
**🟡 Partial:** `InventoryPriceAlert` covers price-drop only; incentive/trade-value alerts have backing data but no alert model.
**❌ Missing:** Vehicle-match quiz (no model/flow); unified alert engine; content-download (PDF) tracking; referral-partner bonus model.

### Layer 2 — CRM System of Record — ~80% ✅
**Built:** `Buyer`, `Dealer`, `Affiliate` profiles with core PII; `LeadScore`; `PrequalConsent`, `AcceptedTerms`, `BuyerPreferences` (consent); affiliate `AffiliateProfile`/`TaxProfile`/`PaymentProfile`; dealer `DealerVerification`/`DealerLicense`. Canonical contact registry = Supabase `contacts` table.
**🟡 Partial:** Tags live only in Supabase `contacts.contact_tags`; consent split across 3+ tables.
**❌ Missing:** Unified Prisma `Contact` model; contact merge/dedup; per-type consent change history.

### Layer 3 — Behavioral Tracking Engine — ~70% 🟡
**Built:** Auction/offer/deal/pickup progression, `AffiliateClick` attribution, `SocialPerformance`, `Document`/`DocumentRequest` uploads, `Financing*` activity, `Conversation`/`BuyerOpportunity`, `BuyerActivityEvent` (ad-hoc), `EmailSendLog` (sends).
**🟡 Partial:** `ContentAttribution` is conversion-link only; exit-intent endpoint exists w/o event model; no offer `viewedAt`.
**❌ Missing:** Email **open/click** + SMS **delivery/read** tracking (no Resend/Twilio event webhooks); page-view granularity; returning-visit identity; time-on-site; form-abandonment.

### Layer 4 — Lead Scoring Engine — ~40% 🟡  ← **PRIMARY GAP**
**Built:** `lib/services/acquisition/scoring.service.ts` (deterministic + Groq), `lib/crm/score-policy.ts` (no-downgrade), `LeadScore` model, `/api/crm/dispatch/score` (Make callback, multi-plane resolve), `Buyer.leadScore`/`leadTemperature`, `BuyerOpportunity.leadScore`, `migrations/06_add_contact_lead_score.sql`.
**🟡 Partial:** Scoring uses ~5 static intake signals (timeline/budget/vehicle/trade-in/zip/phone). Of the spec's 10 action triggers, **only Vehicle Request** influences score.
**❌ Missing — the spec's action→points table is not wired:**
| Action | Points | Wired? |
|---|---|---|
| Landing Page Visit | +1 | ❌ |
| Article Read | +5 | ❌ |
| Vehicle Search | +10 | ❌ |
| Calculator Use | +20 | ❌ |
| Zura Conversation | +25 | ❌ |
| Vehicle Request | +100 | 🟡 (intake only) |
| Offer View | +50 | ❌ |
| Offer Favorite | +75 | ❌ |
| Offer Accepted | +200 | ❌ |
| Deal Completed | +500 | ❌ |

No per-action scoring-event table, no API to log an action and accrue points, no score decay.

### Layer 5 — Segmentation Engine — ~65% 🟡
**Built:** `lib/services/segment.service.ts` (whitelist fields, AND/OR → PostgREST, count cache), `SegmentBuilder.tsx`, `/api/admin/crm/segments/*`, lifecycle taxonomy, audit log.
**🟡 Partial:** Engine works but the spec's **named segments are not seeded** — Buyer (Cold/Warm/Hot/Ready), Vehicle (SUV/Truck/EV/Luxury/Family), Finance (Refinance/Trade-In/Financing/Lease), Lifecycle (Visitor/Lead/Request/Auction/Offer/Customer).
**❌ Missing:** Materialized membership snapshots; auto-promotion on behavior; segment-based send gating.

### Layer 6 — Make.com Automation Brain — ~90% ✅
**Built:** `emitDomainEvent()` spine, signed HMAC outbound `make-webhook.ts`, workflow engine (trigger/condition/delay/action nodes; 10m–30d delays; template vars; cycle guard), 14 trigger types, **24 prebuilt workflows**, Inngest resume-after-delay, activation validation, `workflow-automation` cron.
**🟡 Partial:** No data-driven multi-target fan-out; no per-step retry policy; no workflow completion analytics.
**❌ Missing:** Inbound Make→app callback hardening beyond dispatch routes; Make scenario status sync.

### Layer 7 — Email Campaign System — ~85% ✅
**Built:** Resend client `resend.service.ts` w/ idempotency vs `EmailSendLog`, **41 templates**, `campaigns`/`campaign_recipients` tables, `/api/admin/crm/campaigns/*`, template CRUD + versioning, welcome + nurture template migrations (`08_*`, `09_*`). Welcome/Vehicle-Request/Financing/Refinance/Dealer/Affiliate sequences exist as templates + prebuilt workflows.
**🟡 Partial:** `scheduled_at` exists but no scheduler cron; no Resend bounce/open/click webhook.
**❌ Missing:** Trade-In campaign variant; per-category unsubscribe; A/B framework.

### Layer 8 — SMS Campaign System — ~80% ✅
**Built:** `twilio.service.ts` + hardened `crm-sms.ts` (consent + suppression + quiet-hours 08:00–21:00 local via `recipient-timezone.ts`), `sms_suppression`/`SmsOptOut`, campaign SMS fan-out, nurture-SMS prebuilt workflows (Day 1/3/7/14/30).
**🟡 Partial:** No Twilio inbound webhook (STOP/HELP/replies); market-alert SMS referenced but no templates.
**❌ Missing:** `/api/webhooks/twilio/sms` handler; dealer/affiliate SMS templates; SMS scheduler.

### Layer 9 — Internal Task Automation — ~70% 🟡
**Built:** `crm_tasks` table (priority/status/scope/assigned_to/due_at), `/api/admin/crm/tasks/*`, workflow `action.createTask` node, task nodes in 7 prebuilt workflows (vehicle-request → concierge review, offer reminder, pickup prep, dealer/affiliate nurture), timeline events.
**🟡 Partial:** No auto-assignment routing; no overdue escalation; no admin task dashboard component.
**❌ Missing:** **High-lead-score → Priority-Outreach** auto-task (no scoring→task trigger). (Dealer/affiliate-inactive already covered by reactivation workflows.)

### Layer 10 — Attribution Engine — ~80% ✅
**Built:** `RevenueAttribution` (Click→Request→Deal-Won), `SocialPost` UTM, `CreatorAttribution`, `ContentAttribution` cookies, `lib/social/attribution.service.ts`, `lib/analytics/attribution.ts`.
**🟡 Partial:** Last-touch + first-touch only; dealer ROI attribution thin.
**❌ Missing:** Multi-touch model; post-deal→service milestones; unified attribution report/export; click-fraud checks.

### Layer 11 — Retargeting Engine — ~45% 🟡
**Built:** `lib/social/retargeting.service.ts` builds Meta Custom Audience from non-converting social leads (90d, SHA-256 hashed).
**🟡 Partial:** Meta-only; batch (no real-time pixel).
**❌ Missing:** 9 of 10 spec audiences (Visitors, Vehicle Requests, Finance/Trade-In/Refi Leads, Abandoned Requests, Offer Viewed, Offer Not Accepted, Past Customers); Google/TikTok/LinkedIn pixels; audience analytics.

### Layer 12 — Dealer Growth Engine — ~80% ✅
**Built:** `DealerApplication`/`Invitation`/`AccountClaimToken`/`AgreementSignature`, `DealerVerification`/`License`, `DealerScorecardSnapshot` (+ cron), reactivation route + `dealer_reactivation` workflow, compliance flagging, `ViolationPatternRecord`.
**🟡 Partial / ❌ Missing:** Auto tier promotion/demotion from scorecard thresholds; dealer-facing performance dashboard API; training/certification; NPS.

### Layer 13 — Affiliate Growth Engine — ~80% ✅
**Built:** Application/approval (`AffiliateOnboardingReview`), onboarding (profile/tax/payment), 3-level `Commission` walk, `AffiliatePayout`/`PayoutMethod`/`PayoutSchedule`, `AffiliateClick`/`Referral` tracking, tiers + history, `affiliate-digest`/`affiliate-inactive` crons, `affiliate_reactivation` workflow.
**🟡 Partial / ❌ Missing:** `processPayouts()` payment-processor integration is stubbed; affiliate-facing analytics dashboard; recruitment funnel; DB-driven commission rates; fraud detection.

### Layer 14 — Customer Success Engine — ~50% 🟡
**Built:** `post_purchase` prebuilt workflow (thank-you → 7d review → 180d refi), `Testimonial`, `ReferralMilestone`, `DealTimeline`, `Notification`/`NotificationPreference`.
**🟡 Partial:** Only Day 7 + Day 180 of the spec's cadence exist.
**❌ Missing:** **Day 30 review request, Day 60 referral request, Day 365 vehicle-replacement** milestones; satisfaction-survey infrastructure (no Survey models/NPS); referral-request automation; win-back sequence.

---

## PROPOSED BUILD ORDER

Ordered by value × spec-precision × independence. Each batch keeps `pnpm tsc --noEmit` at 0 errors and `pnpm build` green, and ships its own test.

**Batch 1 — Action-based Lead Scoring (Layer 4) — HIGHEST VALUE, most precisely specified.**
- Add a `lead_scoring_event` table (action, points, contactId/sessionId, dedup key, source, occurredAt).
- Add a points map matching the spec's table exactly (Landing +1 … Deal Completed +500).
- Extend `/api/crm/dispatch/score` (or add `/api/crm/dispatch/track`) to accept an action, accrue points through the existing no-downgrade `score-policy.ts`, write the event + timeline.
- Emit scoring actions from existing seams (article read, vehicle search, calculator, Zura conversation, offer view/favorite/accept, deal completed) via `emitDomainEvent`.
- Recompute `leadTemperature` from cumulative score; this drives Batch 2.

**Batch 2 — Seed the spec's named segments (Layer 5).** Idempotent seed migration creating Cold/Warm/Hot/Ready, vehicle, finance, and lifecycle segments as rules over fields the engine already whitelists (lead_score, lead_temperature, lifecycle_stage, source, vehicle/finance interest).

**Batch 3 — High-lead-score → Priority-Outreach auto-task (Layer 9).** Trigger a `crm_tasks` insert (priority=urgent) when cumulative score crosses the Hot threshold; dedup per contact.

**Batch 4 — Engagement webhooks (Layer 3/7/8).** `/api/webhooks/resend` (open/click/bounce → `EmailSendLog` + suppression) and `/api/webhooks/twilio/sms` (STOP/HELP/delivery → suppression + score signal).

**Batch 5 — Customer-success cadence (Layer 14).** Extend `post_purchase` workflow with Day 30 review, Day 60 referral, Day 365 replacement nodes + the missing templates.

> Batches 1–3 form a coherent slice (score → segment → task) and are recommended to ship together first. 4 and 5 are independent follow-ons.
