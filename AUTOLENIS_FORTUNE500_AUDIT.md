# AutoLenis — Fortune 500 Fintech Ecosystem Audit (Phase 1 + Phase 2)

**Repo:** `AutolenisWebDeveloper/autolenisNewUpdatedfinal` · frontend root `frontend/`
**Stack:** Next.js (App Router), TypeScript (strict), Prisma + Supabase Postgres, Vercel, Stripe, Twilio + ElevenLabs/Polly, Groq, Gemini+Maps, Resend, Make.com + Inngest + QStash.
**Method:** Direct code inspection. Every claim cites `file:line`. State tags: `[WORKS] [BROKEN] [PARTIAL] [ABSENT] [INFERRED] [UNVERIFIED]`.
**Strategic reality:** Zero live dealers / auctions / revenue. This assesses **code-path & architecture readiness**, not data volume. "Correct-but-never-exercised" is explicitly distinguished from "broken." "No auction data exists" is *not* raised as a finding.

**Coverage:** 520 API routes, 373 lib files, 203 Prisma models, 4,687-line schema, 62 migrations, 42 scheduled crons + 45 cron routes, 4 event/job planes inventoried. Deep-audited along the priority path (first-transaction loop, dealer sourcing, affiliate chain, compliance, event/job architecture, env-sync). Deprioritized (inventoried, not deep-audited): AMIPS market-intelligence subsystem, Social engine (~14 crons + ~40 routes), SEO/content platform, Faith content, Inventory sync adapters, Insurance/trade-in detail. Exclusion rationale: off the first-transaction critical path and the four compliance-critical actors.

---

## 1) EXECUTIVE SUMMARY

AutoLenis is **far more complete than a pre-revenue staging codebase usually is**. The reverse-auction first-transaction loop is real and largely automated end-to-end: deposit → Stripe webhook auto-launches the 48h auction and auto-invites dealers → dealer offers in a serializable transaction → ranking → buyer selection → Deal → fee capture. FCRA adverse-action, audit logging, and marketplace-not-lender posture genuinely PASS. The affiliate program — described as "pending" — is in fact 80% built (attribution, onboarding, dashboards, commission tree all wired). **The platform's weakness is not its happy path; it is reliability-under-failure, the money-out edges, and a handful of live compliance defects.** Perceived quality = min(visual polish, operational reliability) — and the operational floor has specific holes.

**Top issues by severity × leverage:**

| # | Issue | Sev | Why it matters |
|---|-------|-----|----------------|
| 1 | **Auction post-close has no reconciler** — `processAuctionClose` only runs for auctions closed in a trailing **6-minute window** (`cron/auction-close/route.ts:28-37`). One missed/slow cron tick permanently drops the buyer's win/no-offer notice and the zero-offer auto-refund, with no retry. | **P0** | Silent failure at the highest-trust money moment; stranded $99. The single biggest reliability risk. |
| 2 | **Affiliate payout rail is a dead-end** — `AffiliatePayout` is created PENDING and **never advanced**; the admin settle route doesn't exist (`affiliate-payout.service.ts:32,55-61`). A second, conflicting per-commission `mark-paid` path corrupts state. | **P0** | No way to actually pay affiliates via the batch rail; double-pay/double-count risk. |
| 3 | **Commission computed off a hardcoded $499 constant**, not the actual deal (`commission.service.ts:37`). | **P0** | Every non-standard deal mis-pays partners; not auditable. |
| 4 | **FTC: unsubstantiated savings claims** ("save $2,000–$4,000", "$2,300 average") live on buyer/marketing pages with **zero transactions** (`how-it-works/page.tsx:258`, `for-buyers/page.tsx:510`). | **P0** | Deceptive-claim exposure; contradicts the site's own disclaimer. |
| 5 | **TCPA: SMS consent auto-granted from mere phone presence** — `consent_sms = !!phone`, no opt-in checkbox/disclosure (`LandingPageClient.tsx:438`). Well-built send gates then trust a defective flag. | **P0** | $500–$1,500/msg statutory exposure on proactive SMS. |
| 6 | **Buyer can accept an offer while the auction is still ACTIVE**, ending the 48h window early (`select-offer/route.ts:35-68`). | **P1** | Undermines the core "competition = best price" promise. |
| 7 | **Out-of-network recruitment has an automated top & bottom but a manual middle** — no prospect→dealer conversion link, plus per-application manual approval (`unified-buyer-intake.service.ts:393`, `applications/[appId]/approve`). | **P1** | Dealer supply (the marketplace's cold-start constraint) scales linearly with admin headcount. |
| 8 | **Multiple notification planes fire on the same event** (QStash + Inngest + Make) with no authoritative owner (`webhooks/stripe/route.ts:164,183`). | **P1** | Double-send (CAN-SPAM/TCPA) or silent-drop depending on env flags. |
| 9 | **Twilio webhook signature `www.`/apex parity** — voice rebuilds the signed URL from `NEXT_PUBLIC_APP_URL` (apex default) while SMS uses a separate `TWILIO_WEBHOOK_URL` (`twilio-verify.ts:4`, `sms/inbound/route.ts:54`). Host mismatch → 403 on all inbound incl. STOP. | **P1** | Breaks opt-out handling (compliance) + voice. |
| 10 | **Abandoned-deposit recovery never fires** — the `deposit_pending` trigger is defined but never emitted, so the prebuilt 1h→24h→72h deposit-nudge workflow is dead (`workflow.prebuilt.ts:119`, `lib/types/crm.ts:342`). | **P2** | Direct conversion loss at the $99 gate. |

**Biggest single risk:** Finding F-001 (auction-close reconciliation gap) — it is the only critical-path notification with no idempotency-keyed recovery, and it fails silently at the moment the buyer has paid and is waiting.

**Highest-ROI fix:** Add a `processedAt` marker + a reconcile query (`status=CLOSED AND processedAt IS NULL`) replacing the 6-minute window (Effort S–M, closes a P0). Pair it with the consent-capture checkbox (F-006, Effort S, closes a P0 compliance) — together the two cheapest closes of two P0s.

**Operating-model verdict (preview of §18):** **Enterprise-trending, not yet Fortune-500.** The automation ratio is genuinely high and the founder is *not* a required step in the normal happy path — but reliability-under-failure, money-out settlement, and live compliance copy are below the bar.

---

## 2) CURRENT-STATE ARCHITECTURE ASSESSMENT

**Strengths (verified):**
- **First-transaction loop is automated, not admin-gated.** Deposit webhook auto-creates+launches the auction and auto-invites dealers (`webhooks/stripe/route.ts:81-127`, `auction.service.ts:25-31`, `dealer-invitation.service.ts:62-182`). No admin click is required for a normal transaction to proceed.
- **Buyer journey is state-derived, not manually advanced.** `buyer/journey-status/route.ts:30-68` computes the stage from real DB facts (prequal/shortlist/deposit/auction/deal). Admin journey routes are concierge *overrides*, not gates.
- **Strong transactional discipline** in offer submission (Serializable txn, dup guard, validation — `offer.service.ts:85-148`) and Stripe webhook (atomic event-claim + signature verify — `webhooks/stripe/route.ts:29-59`).
- **Real structural-trust mechanics exist:** `OfferComparisonPanel.tsx`, `LiveAuctionView.tsx`, Contract Shield subsystem (service + cron + buyer/public pages), refundable $99 deposit, no-credit-impact prequal, Zura concierge knowledge/voice.
- **Idempotency is solid** where present: `idempotency_keys`, `lib/inngest/idempotency.ts`, `lib/crm/dispatch-idempotency.ts`; QStash signed; Resend/Twilio/Stripe webhooks signature-verified.

**Structural weaknesses:**
- **Four parallel event/job planes** (Make.com domain-event spine, Inngest, QStash job chains, legacy in-app `WorkflowEngine`) overlap on buyer/dealer notifications with **no declared authoritative owner per notification class** (F-012).
- **Two parallel auction/offer models** — `Auction`/`Offer` (live, buyer-paid path) vs `VehicleOffer`/`DealerOfferSubmission` (admin concierge path) — that never converge into the same Deal/fee/ranking pipeline (F-009).
- **Reliability is fire-once in two critical places** (auction post-close F-001; no automated DLQ drainer F-035), against an otherwise idempotent system.

---

## 3) WORKFLOW & RELATIONSHIP MAPPING (first-transaction loop)

```
Buyer request ─► shortlist ─► prequal (gate) ─► $99 deposit (Stripe PI, auto-capture)
   │                                                   │
   │                                  webhooks/stripe ─┤ (auto, no admin)
   ▼                                                   ▼
 Auction PENDING ─► launchAuction ACTIVE (endsAt = now+48h) ─► inviteDealersToAuction (geo≤150mi, score, top 8)
   │                                                   │
   │  dealers: AuctionInvitation + email + QStash reminders
   ▼                                                   ▼
 Dealer submitOffer (Serializable txn, validation, junk-fee, budget) ─► Offer SUBMITTED
   │
   ▼  (48h elapse)  cron/auction-close */5  ──► closeExpiredAuctions() ─► processAuctionClose() [6-min window ⚠ F-001]
   │                                              releaseAuctionLoad · rankOffers · buyer email · zero-offer auto-refund
   ▼
 Buyer select-offer ─► Deal FINANCING_PENDING (⚠ allowed while ACTIVE, F-007) ─► $400 fee PI ─► FEE_PAID
   │                                                                                   │
   │  affiliate: walkCommissionTree on fee payment (⚠ $499 constant F-004, fee-trigger F-016)
   ▼                                                                                   ▼
 Deal → INSURANCE_PENDING → CONTRACT → SIGN → PICKUP (scan) ─► purchase_completed ─► COMPLETED
```

Cross-plane note: `deposit_paid`/`auction_started`/`offer_received`/`offer_selected` are emitted to Make.com **and** QStash jobs send the actual buyer SMS/email — the redundancy that creates F-012.

---

## 4) ACTOR × LIFECYCLE MATRIX (automation level per stage)

| Lifecycle stage | Buyer | Dealer | Admin | Affiliate | Automation |
|---|---|---|---|---|---|
| Registration | self-serve | self-serve (claim) | — | self-serve (auto-ACTIVE) | Full |
| Onboarding | organic (state-derived) | 4-step wizard | override only | 7-step wizard | Full |
| Prequal / qualification | self-serve + FCRA notice | n/a | exception review | n/a | Full |
| Vehicle request submit | self-serve | n/a | n/a | referral rides along | Full |
| Dealer matching | n/a | auto-invited (geo+score) | n/a | n/a | Full |
| Out-of-network sourcing | n/a | Gemini+Maps discovery | **manual approve** | n/a | Semi (manual middle) |
| Auction (48h) | live status view | offer submission | exception | tracks referral | Full |
| Offer ranking | sees ranked panel | n/a | n/a | n/a | Full (gaps F-025/26) |
| Acceptance | self-serve | won/lost email | n/a | n/a | Full (gap F-007) |
| $99 / $400 capture | self-serve (Stripe) | n/a | override links | accrues commission | Full |
| Financing / insurance / contract | guided | n/a | **assist** | n/a | Assisted |
| Pickup / close | QR scan | QR scan | assist | commission visible | Assisted |
| Commission → payout | n/a | n/a | **manual mark-paid** | requests payout | **Broken (F-002/003)** |
| Post-sale follow-up | review request | scorecard | exception | digest | Semi |

---

## 5) CROSS-ACTOR PROCESS SUMMARY (POST-SUBMIT) — the required walkthrough

### 5A. BASELINE (no affiliate) — from vehicle-request submit to post-sale

| Stage | Buyer | Dealer | Admin | System / evidence | State |
|---|---|---|---|---|---|
| **Submit** | Submits request; must hold valid prequal + ≥1 shortlist item to reach deposit | — | Nothing required | `vehicle_request_submitted` emitted; deposit gated `buyer/deposit/create-intent` | `[WORKS]` |
| **$99 deposit** | Pays $99 (Stripe PI, **auto-captured**) | — | Nothing | `deposit.service.ts:10-27`; **auto-capture not a hold → real refund needed later (F-008)** | `[WORKS]` |
| **Auction launches** | Sees auction go live, 48h countdown | **Top-8 dealers receive invite + email + reminders** | Nothing (auto) | `webhooks/stripe/route.ts:81-127`; `dealer-invitation.service.ts:62-182` | `[WORKS]` |
| **48h live window** | Sees `timeRemaining`, `offerCount`, `dealersInvited`, anonymized engagement — **no amounts** | Submit offers (OTD + financing, validated, junk-fee scan) | Nothing | `buyer/auctions/[id]/live-status`; `offer.service.ts:85-148` | `[WORKS]` |
| **Close (48h)** | *Should* receive "you have offers / no offers" + refund if zero | Win/lost email | Nothing — **unless cron misses → buyer silently gets nothing (F-001)** | `cron/auction-close/route.ts:28-37` (6-min window, no reconciler) | `[PARTIAL]` |
| **Ranking** | Sees ranked OfferComparisonPanel | — | Nothing | `best-price.service.ts:29-102` — cash vs financed on incomparable axes; junk-fee not in ranking (F-025/26) | `[PARTIAL]` |
| **Acceptance** | Selects an offer → Deal created | Winner notified | Nothing | `select-offer/route.ts:46-68` — **selectable while ACTIVE (F-007)** | `[PARTIAL]` |
| **$400 fee** | Pays remaining concierge fee | — | Send-link override available | `service-fee.service.ts:7-45`; `webhooks/stripe/route.ts:208-238` | `[WORKS]` |
| **Financing** | Uploads letter / coordinates | — | **Assists** (coordination) | `buyer/deal/financing`, `vehicle-request-financing` | `[PARTIAL]` |
| **Insurance** | Requests/uploads proof (hard gate) | — | Reviews insurance request | Deal can't COMPLETE without insurance (`deal.service.ts`) | `[WORKS]` |
| **Contract / e-sign** | Signs (in-house e-sign + DocuSign) | — | Resend/void controls | `buyer/esign/[dealId]`, `esign.service.ts:155` | `[WORKS]` |
| **Pickup / close** | QR pickup | QR scan → `purchase_completed` | Pickup schedule/check-in | `dealer/pickup/scan/route.ts:112` | `[WORKS]` |
| **Post-sale** | Review request | Scorecard snapshot | Exception only | `jobs/review-request`, `cron/dealer-scorecard-snapshot` | `[WORKS]` |

**Where the baseline depends on an automation firing:** auction launch + dealer invite (Stripe webhook), 48h close + buyer notify + refund (the */5 cron — the fragile link), all buyer SMS/email (QStash jobs), and the CRM/Make spine (only if `MAKE_WEBHOOK_URL` set — otherwise loop events write only timeline rows, F-019).

### 5B. AFFILIATE-INVOLVED — same flow when buyer was referred

| Concern | What happens | Where it breaks today | State |
|---|---|---|---|
| **Referral capture** | `?ref=AFF-XXXX` → 30-day `affiliate_ref` cookie (`proxy.ts:352-360`); sitewide `ReferralCapture` writes `AffiliateClick` (`referral.service.ts:54-87`) | — | `[WORKS]` |
| **Attribution → affiliate** | Commission-bearing `AffiliateReferral` is written **only if the code survives into the signup form field** (`actions.ts:242,283`) | **Cookie-only arrivals → "converted click" but no `AffiliateReferral` → zero commission (F-017)** | `[PARTIAL]` |
| **Persistence to close** | Deliberately **not** on the Deal; resolved later via `Buyer.userId → AffiliateReferral → affiliateId` at fee-payment time (`webhooks/stripe/route.ts:271-282`) | Works *iff* `AffiliateReferral` exists (see above) | `[WORKS] by design` |
| **Commission trigger** | `walkCommissionTree` fires on **service-fee payment**, not deal close (`stripe/route.ts:281`) | Over-accrues if deal later cancels; clawback is manual (F-016) | `[PARTIAL]` |
| **Commission amount** | `PREMIUM_FEE_CENTS` ($499 constant) × rate (L1 15%, L2/L3 3%) (`commission.service.ts:37`) | **Not the actual deal fee → wrong on any non-standard deal (F-004)** | `[PARTIAL]` |
| **Affiliate visibility** | Real Prisma-backed dashboard: earnings, network, commissions, notifications, leaderboard | Income calculator seeds demo numbers (F-047, cosmetic) | `[WORKS]` |
| **Admin approve** | PENDING→APPROVED | Register already auto-ACTIVE, so approve is partly redundant (F-038) | `[WORKS]` |
| **Payout** | (i) per-commission admin `mark-paid` works; (ii) self-serve `requestPayout` creates `AffiliatePayout(PENDING)` | **PENDING payout never advances — settle route absent; `processPayouts()` is a stub; two rails corrupt state (F-002, F-003)** | `[BROKEN]` |

**One-paragraph affiliate narrative (state-tagged):** A referred buyer clicks `?ref` → click recorded `[WORKS]`; if the code reaches the signup form, an `AffiliateReferral` is written `[WORKS, F-017 latent break]`; the buyer transacts and at **fee payment** (not close) a 3-level commission tree accrues off a **$499 constant** `[PARTIAL, F-004/F-016]`; the affiliate sees real PENDING commissions on a fully wired dashboard `[WORKS]`; an admin approves them `[WORKS]`; then payout forks into a working per-commission rail and a **dead-end batch rail that can never be settled** `[BROKEN, F-002/F-003]`. **The chain captures, attributes, accrues, and displays correctly but breaks hard at money-out and miscomputes money-amount.**

---

## 6) FORTUNE 500 EXPERIENCE ASSESSMENT

| Actor | Grade | Evidence / gap |
|---|---|---|
| **Buyer** | **Enterprise** | Concierge feel real (Zura, state-derived journey, OfferComparisonPanel, Contract Shield, refundable $99). Friction: early-accept undercuts auction (F-007); silent close-failure risk (F-001); unsubstantiated savings copy (F-005). |
| **Dealer** | **Mid-market → Enterprise** | Clean invite→claim→onboard→offer flow; serializable offer txn. Gaps: invited for makes they don't sell (F-023); no reply detection (F-021); ACTIVE without captured signature (F-020). |
| **Affiliate** | **Mid-market** | Surprisingly complete UI + attribution, but money-out is broken (F-002/003) and amounts wrong (F-004). Not payable today via the self-serve rail. |
| **Admin** | **Enterprise** | Genuinely exception-oriented for the happy path (not a required step). But manual dealer approval (F-011) and manual affiliate settlement (F-002) are linear-headcount choke points at scale. |

---

## 7) AUTOMATION MATURITY ASSESSMENT

| Process | Level | Note |
|---|---|---|
| Auction creation + dealer invite | **Fully automated** | Stripe webhook driven |
| 48h close + notify + refund | **Semi** | Automated but no reconciler (F-001) |
| Offer validation + ranking | **Fully automated** | Ranking quality gaps (F-025/26) |
| Out-of-network discovery (Gemini+Maps) | **Fully automated** | Real, cached, idempotent |
| Out-of-network → active dealer | **Manual** | No conversion link + manual approve (F-010/11) |
| Buyer lifecycle communications | **Semi** | Works if Make/QStash configured; abandoned-deposit nudge dead (F-037) |
| Affiliate commission accrual | **Fully automated** | Wrong basis/trigger (F-004/16) |
| Affiliate payout | **Manual / broken** | F-002/003 |
| Compliance (FCRA notice) | **Fully automated** | PASS |
| Dealer followup sequence | **Fully automated** | No inbound-reply auto-stop (F-021) |

---

## 8) FINDINGS REGISTER (sorted by severity)

> Schema: `ID | Title | Sev | State | Category | Evidence | Business impact | Recommended action | Effort | Confidence`. Dependencies noted where relevant.

### P0

**F-001 | Auction post-close has no reconciler — missed cron tick permanently drops buyer notice + strands $99 | P0 | [PARTIAL] | Reliability/Event-integrity**
Evidence: `app/api/cron/auction-close/route.ts:28-37` selects only `closedAt >= now-6min`; `processAuctionClose` (`auction.service.ts:89-238`) called only here + admin manual close — no sweep. Impact: one slow/skipped */5 tick or a per-auction throw leaves auction CLOSED with buyer never told win/no-offer, dealer `currentAuctionLoad` leaked, **zero-offer auto-refund never issued** → $99 silently kept; no retry. Action: **Automate** — add `processedAt` marker, reconcile on `status=CLOSED AND processedAt IS NULL`, make `processAuctionClose` idempotent. Effort: M. Confidence: High.

**F-002 | Affiliate batch payout rail is a dead-end (AffiliatePayout never leaves PENDING; settle route absent) | P0 | [ABSENT] | Payout/Financial**
Evidence: `affiliate-payout.service.ts:32` (only `.create`), `:55-61` (`processPayouts` stub returns 0), `:58` points at `POST /api/admin/affiliates/payouts/[payoutId]/mark-paid` which does not exist; no `affiliatePayout.update` anywhere. Impact: affiliates can request payouts that can never be settled; financial liability untracked. Action: **Build** the admin settle route + reconcile payout↔commission, or disable `requestPayout` until ready. Effort: M. Confidence: High. Depends-on: F-003.

**F-003 | Two conflicting affiliate payout mechanisms corrupt commission state | P0 | [PARTIAL] | Data-flow/Financial**
Evidence: `affiliate-payout.service.ts:42-45` sets `Commission.paidAt` at request time but leaves status APPROVED; `admin/affiliates/commissions/[id]/mark-paid/route.ts:32-35` sets status PAID. Impact: same commission "paid" two ways; double-count/double-pay; summaries disagree (`getCommissionSummary` keys off status, `commission.service.ts:86`). Action: **Consolidate** to one rail; add `Commission.payoutId` FK; set status only on real settlement. Effort: M. Confidence: High.

**F-004 | Commission computed from hardcoded $499 constant, not the actual deal fee | P0 | [PARTIAL] | Financial-correctness**
Evidence: `commission.service.ts:37` uses `PREMIUM_FEE_CENTS` (`constants.ts:7`). Impact: any deal whose fee ≠ $499 pays wrong commission; not per-deal auditable. Action: **Reengineer** — pass actual deal fee into `walkCommissionTree`; persist the basis on `Commission`. Effort: S. Confidence: High.

**F-005 | FTC: unsubstantiated quantitative savings claims live on buyer/marketing copy | P0 | [WORKS, unsubstantiated] | Compliance**
Evidence: `how-it-works/page.tsx:258` ("save $2,000–$4,000"), `for-buyers/page.tsx:510` ("average of $2,300"), `lp/[campaign]/LandingPageClient.tsx:64,895`, `about/page.tsx:75`, `page.tsx:195-197`. Contradicts disclaimer at `pricing/page.tsx:291`. Impact: FTC §5 deceptive-claim exposure with zero buyers; state UDAP. Action: **Redesign copy** — remove/qualify specific dollar averages as clearly-labeled illustrative until transaction-substantiated. Effort: M. Confidence: High.

**F-006 | TCPA: proactive SMS consent auto-granted from mere phone presence | P0 | [PARTIAL] | Compliance**
Evidence: `lp/[campaign]/LandingPageClient.tsx:376,438` sets `consent_sms: !!phone`, no disclosure; persisted `public/request-vehicle/route.ts:521`; correct send-gates then trust it (`crm-sms.ts:77-91`, `qstash/notify.ts:103-131`). Impact: typing a phone number is not TCPA express consent; $500–$1,500/msg. Action: **Add** explicit unchecked SMS-consent checkbox + autodial/recurring-msg disclosure; set `consent_sms` only from it. Effort: S. Confidence: High.

### P1

**F-007 | Buyer can select an offer while auction still ACTIVE (ends 48h early) | P1 | [PARTIAL] | Conversion-loss/Fairness**
Evidence: `select-offer/route.ts:35-68` checks only `status !== "CANCELLED"` then force-closes. Impact: kills competition mid-window, breaks the best-price promise, cuts off dealers. Action: **Improve** — block until `endsAt` passed or require explicit disclosed `forceEarly`. Effort: S. Confidence: High.

**F-008 | All PaymentIntents auto-capture; "$99 deposit" is a charge, not a hold | P1 | [WORKS-as-coded] | Payments**
Evidence: no `capture_method:"manual"` anywhere; `deposit.service.ts:10-15`, `service-fee.service.ts:14-21`; `cron/holds` actually issues refunds. Impact: every no-win requires real money-out refund (fees, refund-failure surface tied to F-001, dispute exposure). Action: **Reengineer** — use `capture_method:"manual"` + capture-on-win / cancel-on-no-win if product intends a hold. Effort: M. Confidence: Medium.

**F-009 | Two parallel auction/offer systems | P1 | [PARTIAL] | Tech-debt/Architecture**
Evidence: `Auction/Offer` live path vs `VehicleOffer/DealerOfferSubmission` admin path (`admin/vehicle-requests/[id]/send-to-dealers/route.ts:53-64`; both named in `dealer/offers/route.ts:22-36`). Impact: concierge path never feeds Deal/fee/ranking; double bug surface. Action: **Consolidate** to one canonical model. Effort: XL. Confidence: High.

**F-010 | Out-of-network recruitment has no prospect→dealer conversion path | P1 | [ABSENT] | Scalability**
Evidence: `unified-buyer-intake.service.ts:393` creates `DealerProspect`; no code converts a prospect to `DealerInvitation`/`Dealer`. Impact: recruited dealers must re-enter via public form; open funnel. Action: **Automate** — one-click claim/invitation token in outreach email. Effort: M. Confidence: High. Depends-on: F-011.

**F-011 | Per-application manual admin approval is the dealer-onboarding bottleneck | P1 | [WORKS-but-manual] | Scalability**
Evidence: `admin/dealers/applications/[appId]/approve/route.ts:26` — one POST per dealer, no bulk/rules. Impact: dealer supply scales with admin headcount (the cold-start constraint). Action: **Automate** — rules-based auto-approve (license format + Maps placeId verified) with exception-only review. Effort: M. Confidence: High.

**F-012 | Same lifecycle event drives multiple notification planes → double-send / silent-drop | P1 | [PARTIAL] | Event-integrity**
Evidence: `webhooks/stripe/route.ts:164` (QStash `auction-active` sends buyer notify) **and** `:183` (Make `deposit_paid`); exit-intent fires Inngest `:46` + Make `:65`. No mutual-exclusion flag. Impact: duplicate buyer messaging (CAN-SPAM/TCPA) or silent gap by env config. Action: **Reorganize** — declare one authoritative plane per notification class; gate others on cutover flag. Effort: M. Confidence: High.

**F-013 | Twilio webhook signature `www.`/apex host parity risk | P1 | [PARTIAL] | Env-sync**
Evidence: `lib/voice/twilio-verify.ts:4,35` rebuilds signed URL from `NEXT_PUBLIC_APP_URL` (default apex `autolenis.com`); `sms/inbound/route.ts:54` uses separate `TWILIO_WEBHOOK_URL`; `dispatch-request.ts:242` defaults `www.`. Impact: host mismatch with Twilio console → 403 on all inbound incl. STOP (compliance) + voice. Action: **Consolidate** to one canonical public URL incl. host; unify the two env vars. Effort: S. Confidence: Medium.

**F-014 | Dual SMS suppression planes — Prisma `SmsOptOut` read but never written | P1 | [BROKEN] | Compliance/Reliability**
Evidence: `crm-sms.ts:86` reads `prisma.smsOptOut`; no writer exists; STOP writes only Supabase `sms_suppression` + `Buyer.optedOutSms` (`twilio/sms/inbound/route.ts:96-101`). Impact: dead read creates false assurance; planes can diverge. *Note:* opt-outs ARE honored today because the canonical `sms_suppression` store is read by all send paths. Action: **Consolidate** — remove the dead read or have STOP write it too. Effort: S. Confidence: High.

**F-015 | Voice confirmation SMS bypasses suppression/consent gates | P1 | [PARTIAL] | Compliance**
Evidence: `lib/voice/handle-turn.ts:381`, `twilio/voice/status/route.ts:116` call raw `sendSms` (`twilio.service.ts:25`, no gate). Impact: a previously-opted-out number still receives these. Action: **Improve** — route through `SuppressionService.isSmsSuppressed` first. Effort: S. Confidence: High.

**F-016 | Affiliate commission triggers on fee payment, not deal close | P1 | [PARTIAL] | Commission-trigger**
Evidence: `webhooks/stripe/route.ts:208,281`; no `purchase_completed` gate. Impact: accrues before close; refund/cancel leaves over-accrual (clawback manual). Action: **Reengineer** — gate on close, or auto-reverse on deal cancel. Effort: M. Confidence: High.

**F-017 | Affiliate attribution lost when cookie `?ref` doesn't reach signup form field | P1 | [PARTIAL] | Attribution**
Evidence: `proxy.ts:352-360` (cookie) vs `actions.ts:242,283` (form field); `AffiliateClick` vs `AffiliateReferral` populated separately. Impact: cookie-only arrivals → converted click but no commission. Action: **Improve** — signup reads `affiliate_ref` cookie server-side as fallback. Effort: S. Confidence: Medium.

**F-018 | Affiliate commission accrual not gated on W-9 / FTC compliance | P1 | [PARTIAL] | Compliance**
Evidence: only `payouts/request/route.ts:22-25` gates; `commission.service.ts:38-48` does not; `register/route.ts:173` ACTIVE at signup. Impact: accrual for affiliates with no tax info; 1099/IRS + FTC-disclosure exposure. Action: **Improve** — block/un-payable until W-9 + FTC ack. Effort: S. Confidence: Medium.

**F-019 | emitDomainEvent automation inert in default config | P1 | [PARTIAL] | Automation/Reliability**
Evidence: `lib/events/emit.ts:203-217` (no forward if `MAKE_WEBHOOK_URL` unset), `:222` (in-app engine off by default). Impact: the four loop events write only timeline/scoring rows; no downstream automation unless both env flags set — easy to ship "events working" that do nothing externally. Action: **Improve** — treat as required deploy config + health check. Effort: S. Confidence: High.

### P2 (condensed)

- **F-020 | Dealer ACTIVE without captured signature if DocuSign send fails | [PARTIAL] | Compliance** — `dealer/onboarding/route.ts:147-170` sets ACTIVE writing no `DealerAgreementSignature` (fire-and-forget DocuSign); dedicated `dealer/agreement/sign/route.ts` does write it. Make signature a hard precondition. M.
- **F-021 | No inbound-reply detection in dealer followup | [PARTIAL] | Automation** — `webhooks/resend/route.ts:140-145` defers it; `replyDetectedAt` set only by manual pause. Wire Resend Inbound. M.
- **F-022 | Public dealer-application has no rate-limit/captcha | [PARTIAL] | Security** — `public/dealer-application/route.ts` Zod-only. Add IP rate-limit + Turnstile. S.
- **F-023 | In-network match ignores vehicle make/inventory + capacity config | [PARTIAL] | Conversion-loss** — `dealer-invitation.service.ts:97` passes `[]`; hardcoded `>=5` ignores `auction-capacity.service.ts`. Feed real vehicle data + capacity. M.
- **F-024 | Geo filter degrades to "invite everyone" for ZIPs absent from static `ZIP_COORDS` + O(N) per-dealer query | [PARTIAL] | Scalability** — `dealer-invitation.service.ts:74,85,94-100`. Real geocoding + batched query. M.
- **F-025 | Junk-fee detection naive substring, not used in ranking; legit doc-fee flagged; best-price double-counts | [PARTIAL] | Pricing-integrity** — `junk-fee.service.ts:4-13`, `best-price.service.ts:48-49`. Feed detector into ranking. M.
- **F-026 | "All-in price" (`totalCostCents`) never computed; cash vs financed ranked on incomparable axes | [PARTIAL] | Pricing-integrity** — `best-price.service.ts:18,29-89`. Compute true all-in. M.
- **F-027 | Stripe webhook side-effects can re-fire on retry between claim and `processed=true` | [WORKS-mostly] | Payments** — `webhooks/stripe/route.ts:34-59,438,446`. Move processed-mark into the primary txn. M.
- **F-028 | `JWT_SECRET` falls back to "placeholder" for invite-token HMAC | [PARTIAL] | Security** — `admin/dealers/invite/route.ts:19`. Throw in prod. S.
- **F-029 | Inconsistent password policy (claim/invite `min(8)` vs set-password 12+complexity) | [PARTIAL] | Security** — `dealer/claim/route.ts:85`, `auth/set-password/route.ts:13`. Unify to strong policy. S.
- **F-030 | Password change doesn't revoke other-device sessions (stateless JWT ≤30d) | [PARTIAL] | Security** — `auth/set-password/route.ts:78-82`. Add `passwordChangedAt`. M.
- **F-031 | Inconsistent admin authZ on auction mutations | [WORKS] | Security** — `launch-auction` role-gated; `admin/auctions` POST + `best-price/run` any-admin. Uniform gate. S.
- **F-032 | `admin/auctions` POST creates ACTIVE auction without inviting dealers | [PARTIAL] | Correctness** — dead auctions possible. Invite on create. S.
- **F-033 | `x-vercel-cron: 1` header alone authorizes every cron | [INFERRED] | Security/Env-sync** — `cron/*/route.ts:18-20`. Require `CRON_SECRET` unconditionally or verify edge strips the header. S.
- **F-034 | Documented Groq→Anthropic LLM fallback does not exist | [PARTIAL] | Reliability** — `lib/ai/groq-client.ts:52-77` (Groq→Groq), `kill-switch.ts:3` bans others. Voice + discovery fallbacks DO exist. Accept single-provider risk explicitly or add a true secondary. M.
- **F-035 | No automated DLQ drainer; QStash failures not captured in `jobs_dead_letter` | [PARTIAL] | Reliability** — `admin/operations/dlq/[id]/retry` is manual; only Inngest writes DLQ. Add drain cron + QStash coverage. M.
- **F-036 | MicroBilt webhook decline doesn't trigger adverse-action (conditional FCRA gap) | [PARTIAL] | Compliance** — `webhooks/microbilt/route.ts:34-48` handles only `completed`. Synchronous path IS covered. Route webhook declines through `sendAdverseActionEmail`. S.
- **F-037 | `deposit_pending` phantom → abandoned-deposit recovery never fires | [PARTIAL] | Conversion-loss** — `lib/types/crm.ts:342` defined, 0 emitters; prebuilt 1h→24h→72h nudge dead (`workflow.prebuilt.ts:119`). Emit on deposit-intent-created. S.
- **F-038 | Affiliate register auto-activates (ACTIVE), making admin approve redundant/bypassable | [PARTIAL] | Onboarding** — `register/route.ts:169-181`. Decide gate. S.
- **F-039 | 3 cron routes unscheduled in `vercel.json` | [PARTIAL] | Env-sync** — `lead-magnet-sequence`, `social-lead-nurture` rely on cutover flag; `social-video-generate` invoked inline. Re-add or document. S.
- **F-040 | Consent/suppression gate duplicated across 3 planes (drift risk) | [WORKS] | Tech-debt** — `functions.ts:289`, `qstash/notify.ts:109`, Make dispatch. Centralize. M.
- **F-041 | Two-system migration split (Prisma + 15 ordered psql + manual SQL) — fresh-env fragility | [WORKS] | Tech-debt/Env-sync** — documented in `prisma/MIGRATIONS.md`; no actionable drift. Single provisioning command. M.

### P3 (condensed)

- **F-042 | Budget gate silently skipped when prequal missing** — `offer.service.ts:54-65`. S.
- **F-043 | `handleDepositPaid` dead duplicate diverges from webhook** — `deposit.service.ts:29-64`. Delete. S.
- **F-044 | Scorecard snapshot cron may duplicate rows** — `cron/dealer-scorecard-snapshot/route.ts:40-51`. Upsert. S.
- **F-045 | CAN-SPAM address drift / text-only unsubscribe in one dealer template** — `email-template.service.ts:418`. Env-driven address + link. S.
- **F-046 | Admin-decide adverse-action omits FCRA reason codes** — `admin/prequal/[id]/decide/route.ts:178-184`. Pass codes. XS.
- **F-047 | Income calculator seeds hardcoded demo numbers** — `income-calculator/page.tsx:119-123`. S.
- **F-048 | `Commission.dealId` / `AffiliatePayout` lack FK relations** — schema.prisma:658,2102. M.
- **F-049 | Affiliate `processPayouts()` is a stub (no Stripe Connect/ACH)** — `affiliate-payout.service.ts:55-61`. XL (post-launch).

---

## 9) COMPLIANCE & REGULATORY FINDINGS

| Requirement | Verdict | Evidence |
|---|---|---|
| **FCRA** adverse-action on decline | **PASS** `[WORKS]` | `prequal.service.ts:382-436`; `admin-prequal.service.ts:622-678`; template `email/templates/adverse-action.tsx`; sent via Resend + ComplianceEvent logged on all 3 synchronous decline paths. Gaps: F-036 (webhook), F-046 (reason codes). |
| **FTC** savings substantiation | **GAP (P0)** | F-005 — specific dollar averages with zero transactions. |
| **TCPA** explicit consent before proactive SMS | **PARTIAL (P0/P1)** | Send-gates well-built (fail-closed, quiet hours, STOP). Defects upstream: F-006 (consent capture), F-014 (suppression plane), F-015 (voice bypass). Consent timestamp captured (`20260507000000_add_prequal_consent_accepted_at`). |
| **Marketplace-not-lender** | **PASS** `[WORKS]` | No "we finance/lend/approved you"; explicit "AutoLenis is not a lender" (`refinance/eligibility/page.tsx:408`). |
| **No unsupported guarantees** | **PASS (minor puffery)** | Outcomes disclaimed (`pricing/page.tsx:291`); minor "dealer engagement is guaranteed" (`compare/page.tsx:319`). |
| **Audit logging** of sensitive actions | **PASS** `[WORKS]` | Refunds, impersonation start/end, user/role create, Stripe, prequal decisions all logged; append-only forensics trigger migration present. Two tables (`AuditLog`/`AdminAuditLog`) — naming only. |

---

## 10) RANKED AUTOMATION OPPORTUNITIES (leverage ÷ effort)

| Rank | Opportunity | Leverage | Effort | Score | Finding |
|---|---|---|---|---|---|
| 1 | Auction-close reconciler (`processedAt` sweep) | 10 | S/M(2) | **5.0** | F-001 |
| 2 | Explicit SMS-consent checkbox | 9 | S(1) | **9.0** | F-006 |
| 3 | Commission basis = actual deal fee | 8 | S(1) | **8.0** | F-004 |
| 4 | One-click dealer claim token in outreach | 9 | M(2) | **4.5** | F-010 |
| 5 | Rules-based dealer auto-approval | 9 | M(2) | **4.5** | F-011 |
| 6 | Emit `deposit_pending` → abandoned-deposit nurture | 7 | S(1) | **7.0** | F-037 |
| 7 | Declare authoritative notification plane | 8 | M(2) | **4.0** | F-012 |
| 8 | Offer "all-in price" ranking + junk-fee in score | 6 | M(2) | **3.0** | F-025/26 |
| 9 | Inbound-reply auto-stop for dealer followup | 5 | M(2) | **2.5** | F-021 |
| 10 | Automated DLQ drainer | 6 | M(2) | **3.0** | F-035 |

*(Leverage 1–10 weighted toward the first-transaction loop; effort S=1/M=2/L=3/XL=4.)*

---

## 11) OPERATIONAL BOTTLENECKS

1. **Dealer approval** (F-011) — linear admin headcount; the marketplace cold-start constraint.
2. **Affiliate settlement** (F-002/003) — manual + broken batch rail.
3. **Auction-close single point of failure** (F-001) — no recovery.
4. **Financing/insurance coordination** — admin-assisted, not yet automated.

## 12) ADMINISTRATIVE WORKLOAD ANALYSIS (removable)

| Manual task | Frequency | Removable by | Est. removal |
|---|---|---|---|
| Approve each dealer application | per dealer | F-011 rules-based | ~80% |
| Settle each affiliate commission | per commission | F-002 settle route + batch | ~90% |
| Convert recruited prospect manually | per prospect | F-010 claim token | ~100% of the middle step |
| Mark dealer "replied" to stop sequence | per reply | F-021 inbound parsing | ~100% |
| Chase abandoned deposits | per buyer | F-037 emit event | ~100% (currently zero, all lost) |

The founder is **not** a required step in the normal buyer transaction (good); the workload is concentrated in **dealer onboarding and affiliate settlement** — both fixable to exception-only.

## 13) RECOMMENDED WORKFLOW IMPROVEMENTS
Gate offer-acceptance to post-`endsAt` (F-007); make signature a hard ACTIVE precondition (F-020); auto-convert prospects (F-010); rules-based dealer approval (F-011).

## 14) RECOMMENDED SYSTEM-ARCHITECTURE IMPROVEMENTS
Declare one authoritative notification plane and gate the rest (F-012); centralize consent/suppression (F-014/F-040); converge the two auction/offer models (F-009); unify the public-URL/Twilio env vars (F-013).

## 15) RECOMMENDED AUTOMATION ENHANCEMENTS
Auction-close reconciler (F-001); DLQ drainer (F-035); abandoned-deposit nurture (F-037); commission auto-reverse on cancel (F-016); affiliate payout settlement automation → Stripe Connect (F-002/F-049).

## 16) SCALABILITY, RELIABILITY & PERFORMANCE
Batch the per-dealer invitation query + real geocoding (F-024); idempotency-keyed reconcilers on all critical-path background work (F-001/F-035); explicit single-provider LLM risk acceptance or true fallback (F-034); single fresh-env provisioning command (F-041).

---

## 17) FUTURE-STATE FORTUNE 500 OPERATING MODEL (Phase 2 target)

- **Every critical-path background job is idempotent + reconciled** (no fire-once paths). A nightly reconcile sweep proves "no CLOSED-unprocessed auction, no PENDING-stuck payout, no accrued-uncredited commission" exists.
- **One authoritative notification plane** (recommend: domain-event spine → a single dispatcher that owns email/SMS with centralized consent/suppression); other planes demoted to internal jobs only.
- **Self-scaling dealer supply:** discovery → enriched outreach → one-click claim → rules-based auto-approval → exception-only human review.
- **Affiliate as a real financial product:** correct per-deal basis, close-gated accrual with auto-reversal, W-9-gated, Stripe Connect settlement, single payout rail.
- **Compliance-as-design:** explicit consent capture, substantiated or clearly-illustrative claims, suppression enforced on every channel including voice.
- **Money as authorization holds** where the product implies "deposit," not auto-capture-then-refund.

---

## 18) FORTUNE 500 OPERATING MODEL VALIDATION (current-state verdict)

| Dimension | Grade | Verdict | Evidence |
|---|---|---|---|
| 1. Operating leverage / automation ratio | Enterprise | **PASS** | Happy path automated end-to-end; founder not a required step. |
| 2. Exception-only administration | Enterprise (with 2 holes) | **GAP** | Dealer approval (F-011) + affiliate settlement (F-002) are required routine steps. |
| 3. Scalability economics | Mid-market | **GAP** | Dealer supply + affiliate payout scale with headcount; per-dealer O(N) query (F-024). |
| 4. Structural trust | Enterprise | **PASS** | Reverse-auction, refundable $99, Contract Shield, no-credit-impact prequal are real and visible — *except* F-007 lets a buyer bypass the auction and F-005 over-claims savings. |
| 5. State transparency | Enterprise | **PASS (with risk)** | State-derived journey + live-status view are strong; F-001 can leave the buyer in a black box at close. |
| 6. Reliability as felt quality | Mid-market | **GAP** | The decisive critical-path notification (auction close) is fire-once with no reconciler (F-001); QStash failures un-DLQ'd (F-035). |
| 7. Compliance as design | Enterprise (FCRA) / Mid-market (TCPA-FTC) | **PARTIAL** | FCRA/audit/lender PASS; consent capture + savings copy + suppression are live gaps (F-005/006/014/015). |
| 8. Concierge intelligence | Enterprise | **PASS** | Zura, smart defaults, state-derived journey, proactive comms. |

**Overall: Enterprise-trending, not yet Fortune-500.** The platform *feels* and largely *operates* at an Enterprise level on the happy path. It is held back from Fortune-500 by **(a) reliability-under-failure** (one un-reconciled critical path), **(b) money-out integrity** (affiliate payout broken/mis-priced), and **(c) live compliance copy/consent** — not by missing features. Closing the six P0s plus F-007/F-012/F-013 moves the operating model across the line.

---

## 19) PHASE 1 — STABILIZATION PLAN (close the P0s + load-bearing P1s)
1. Auction-close reconciler (F-001). 2. SMS-consent checkbox + disclosure (F-006). 3. Fix FTC savings copy (F-005). 4. Affiliate payout: disable the broken self-serve rail or build settlement (F-002/003). 5. Commission basis = actual fee (F-004). 6. Gate offer-acceptance to post-`endsAt` (F-007). 7. Unify Twilio URL/env (F-013). 8. Remove dead `SmsOptOut` read / route voice SMS through suppression (F-014/015).

## 20) PHASE 2 — AUTOMATION PLAN
One authoritative notification plane (F-012); one-click dealer claim (F-010) + rules-based approval (F-011); emit `deposit_pending` nurture (F-037); commission auto-reversal (F-016); DLQ drainer (F-035); inbound-reply auto-stop (F-021).

## 21) PHASE 3 — SCALE PLAN
Stripe Connect affiliate settlement (F-049); converge dual auction/offer models (F-009); batched/geocoded matching (F-024); true LLM fallback or explicit risk acceptance (F-034); single fresh-env provisioning (F-041); ranking on real all-in cost (F-025/026).

## 22) RISKS, DEPENDENCIES & ROLLBACK
- **F-001** reconciler: must be idempotent (re-running `processAuctionClose` cannot double-refund/double-notify) — guard on `processedAt`. Reversible (additive column + query).
- **F-008** hold-vs-capture: changing capture semantics affects refund flows and Stripe reporting — stage behind a flag; reversible per-PI.
- **F-012** plane consolidation: risk of *under*-sending during cutover — keep both with a kill-switch until parity proven. Reversible via flag.
- **F-002/003** payout: financial — reconcile existing commission states before enabling any new rail; one-way once money moves.
- **F-005/006** compliance copy/consent: low technical risk, high legal upside; reversible.

## 23) ASSUMPTIONS & UNVERIFIED ITEMS
- Make.com scenario **consumption** of forwarded events is `[UNVERIFIED]` (external to repo) — F-012/F-019 impact depends on it.
- Whether Vercel strips client-supplied `x-vercel-cron` at the edge is `[UNVERIFIED]` — determines F-033 severity.
- Production Twilio console webhook host (`www.` vs apex) is `[UNVERIFIED]` — determines whether F-013 is active or latent.
- `$99` is intended as a **deposit/charge** vs an **authorization hold** is an `[INFERRED]` product question behind F-008.
- Deprioritized subsystems (AMIPS, Social, SEO, Faith, Inventory adapters, Insurance/trade-in) were inventoried but not deep-audited; findings there are out of this pass.

---
*Phase 1 audit complete. Evidence-tagged; every finding carries severity, state, effort, confidence. Highest-value artifacts (Exec Summary §1, Cross-Actor Walkthrough §5, Findings Register §8) are front-loaded per the output budget.*
