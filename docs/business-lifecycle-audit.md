# AutoLenis Business Lifecycle Audit & Implementation Plan (Prompt 2, Phase 0)

**Status:** AUDIT + PLANNING ONLY — no application code, schema, or migrations changed in this phase.
**Baseline SHA:** `101f7f5f8f311bc9905d543036ef76c52cb79437` (`origin/main`, merge of PR #324 "Inngest final repository removal").
**Audit branch:** `claude/business-lifecycle-audit`.
**Production DB inspected (read-only):** Supabase project `supabase-AutoLenis` (`aieybibvewmvrubcpthm`), as of 2026-08-24.
**Method:** repository trace (6 parallel domain audits) + read-only production row/status counts. Evidence tags: `VERIFIED—REPOSITORY`, `VERIFIED—PRODUCTION`, `ASSUMPTION`, `NOT VERIFIED—REQUIRES LIVE INFRASTRUCTURE`.

> **Headline.** AutoLenis is an elaborately built, largely well-architected lifecycle platform with **near-zero real transactional throughput**. Buyer intake is genuinely live and ongoing (to 2026-08-23) but **stalls at `SUBMITTED`**. The auction/deposit cluster was exercised **once** on 2026-07-02 as an **admin-seeded test** (6 auctions, 6 admin-override deposits, **zero real dealer offers**). The only human-operated funnel that carries real dealer submissions is the **concierge "System B"** (`VehicleOffer`), which is a **transactional dead-end** with no link to `Deal`/`Deposit`. **`deals = 0`** across all three offer systems. There is effectively **zero executable dealer supply**.

---

## 1. Authoritative intended lifecycle

The intended end-to-end revenue lifecycle, reconciled across routes, services, the Prisma schema (`frontend/prisma/schema.prisma`), and state machines. Where the code contradicts itself the conflict is noted and resolved in later sections.

| Stage | Entry condition | Authoritative state | Responsible system | Expected next state | Terminal / failure |
|---|---|---|---|---|---|
| **Buyer intake** | Buyer contacts platform (web form, AI voice/chat) | `BuyerOpportunity` (`completed`, `lead_temperature`) | AI concierge intake (`buyer_opportunities`, `intake-pipeline.service.ts`) | `VehicleRequest(SUBMITTED)` | abandoned lead |
| **Vehicle request** | Request captured | `VehicleRequestStatus` machine: `SUBMITTED → INTAKE → ACTIVE_SOURCING → OFFER_READY → OFFER_SENT → OFFER_ACCEPTED → DEAL_CREATED` (or `CLOSED_NO_MATCH`/`CANCELLED`/`EXPIRED`) | `vehicle-request` module | `INTAKE`/`ACTIVE_SOURCING` | `CLOSED_NO_MATCH` |
| **Prequal / deposit** | Buyer commits | `Deposit(PENDING→PAID→REFUNDED/FAILED)`, `$99` (9900¢) | Stripe (`create-intent` → webhook) | auction created | `FAILED` |
| **Dealer supply** | Territory targeted | `dealer_prospects` → verified/active `Dealer` | dealer-prospecting + recruitment | contactable, invitable dealer | suppressed |
| **Dealer recruitment/onboarding** | Prospect or application | `DealerApplicationStatus`, `DealerOnboardingStatus`, `DealerStatus(PENDING→ACTIVE→SUSPENDED→TERMINATED)` | dealer-recruitment + agreement + verification | `ACTIVE` | rejected |
| **Dealer verification** | Onboarding | `DealerVerification`, `DealerLicense`, `DealerAgreementSignature` | verification + agreement | verified, gated `ACTIVE` | blocked |
| **Dealer inventory** | Dealer active | `InventoryItem` (LANE_1 dealer-owned) via feed/CSV/manual | inventory adapters + orchestrator | fresh, quality-scored stock | stale-swept |
| **Inventory normalization/sync** | Source configured | `InventorySource`/`InventorySyncRun`/`InventoryFeedLog` | inventory orchestrator + crons | current inventory | feed error |
| **Matching** | Request + inventory + dealers | `VehicleMatchScore`, `VehicleRequestMatchResult` | matching / dealer-targeting | ranked dealer set + matched vehicles | no match |
| **Dealer sourcing** | Coverage sufficient | `AuctionInvitation` (scored top-8, radius ladder 25/50/100/150 mi) | `dealer-invitation.service.ts` | invited dealers | fail-closed → 0 |
| **Auction** | Paid deposit | `AuctionStatus(PENDING→ACTIVE→CLOSED/EXPIRED/CANCELLED/REOPENED)`, ~48h | `auction.service.ts` | dealer bids | `CLOSED` no-offer |
| **Dealer bidding / offers** | Invited dealer bids | `Offer(DRAFT→SUBMITTED→ACCEPTED/DECLINED/WITHDRAWN/EXPIRED)` | `offer.service.ts` (Serializable txn, budget cap, anti-snipe) | ranked offers | none submitted |
| **Best Price Report / selection** | Auction closed with offers | ranked report (Cash/Monthly/Overall) | `best-price.service.ts` → buyer `select-offer` | offer accepted | none |
| **Deposit → award → deal** | Offer selected | `Deal(PENDING→ACTIVE→FINANCING_PENDING→FEE_PENDING→FEE_PAID→INSURANCE_PENDING→CONTRACT_*→SIGNING_PENDING→SIGNED→PICKUP_*→COMPLETED)` | `select-offer.service.ts` + `deal.service.ts` (guarded, `DealStatusHistory`) | deal progression + dealer award | `CANCELLED`/`REFUNDED` |
| **E-sign** | Contract approved | `ESignStatus(PENDING→SENT→DELIVERED→COMPLETED/DECLINED/VOIDED)` | DocuSign (`esign.service.ts`) | `SIGNED` | stalls unconfigured |
| **Financing / refinance** | Buyer needs financing | `CreditApplicationStatus` (in-house) or `RefinanceStatus` (OpenRoad redirect) | financing-orchestrator / refinance-lead | approved / handed off | `INELIGIBLE` |
| **Delivery / pickup** | Signed | `PickupStatus(NOT_SCHEDULED→PROPOSED/DEALER_COUNTERED→SCHEDULED→CHECKED_IN→COMPLETED)` | `pickup.service.ts` (QR) | `COMPLETED` | `EXCEPTION` |
| **Completion / reconciliation** | Pickup complete | `Deal(COMPLETED)`, commissions, ledger | deal + payments + reconcilers | closed deal | manual |
| **Post-deal** | Completed | review / referral / refinance nudges | deferred lifecycle jobs | retention | — |

**Resolved contradictions (see later sections):** (a) three parallel offer systems exist (§7); (b) two dealer agreement/onboarding-completion paths each do half the job (§4); (c) the buyer-facing "$99 refund guarantee" contradicts the coded non-refundable retention (§3); (d) sourcing is gated on a paid deposit, not on the request, so requests structurally cannot self-advance (§6).

---

## 2. Actual implementation map (subsystem → owning code)

- **Buyer intake:** `lib/services/acquisition/intake-pipeline.service.ts`, `buyer_opportunities`; live.
- **Vehicle request:** `app/api/public/request-vehicle/route.ts`, `VehicleRequestStatus` machine; live but stalls.
- **Deposit/payment:** `app/api/buyer/deposit/create-intent/route.ts`, `app/api/webhooks/stripe/route.ts`, `lib/services/payment/*`, `lib/payments/deposit-state.ts`.
- **Dealer prospecting:** `lib/services/acquisition/*` (gemini-maps, compound-search, apollo), `dealer_prospects`/`dealer_intelligence`/`lead_scores`.
- **Dealer recruitment/onboarding:** `lib/services/dealer-recruitment/*`, `app/api/dealer/onboarding/route.ts`, `app/api/dealer/agreement/sign/route.ts`, `lib/services/agreement/*`.
- **Dealer verification:** `DealerVerification`/`DealerLicense` models — **no writers** (dead).
- **Inventory:** `lib/services/inventory/*` (adapters, orchestrator, dedup, match, quality), `app/api/cron/inventory-*`, `app/api/admin/inventory/**`, `app/api/dealer/inventory/**`.
- **Matching / sourcing:** `lib/services/auction/dealer-invitation.service.ts`, `coverage.service.ts`, `lib/services/inventory/inventory-match.service.ts` (dead).
- **Auction/offer (canonical, System A):** `lib/services/auction/*`, `lib/services/offer/*`, `app/api/dealer/offers/**`, `app/api/buyer/auctions/**`.
- **Concierge offer (System B):** `app/api/admin/vehicle-offers/**`, `app/api/public/dealer-offer/[token]/**`, `app/api/public/buyer-offer-review/[reviewToken]/**` (no service; inline in routes).
- **Request offer (System C):** `lib/services/vehicle-request/vehicle-request-offer.service.ts`, `app/api/buyer/requests/[requestId]/offer/respond/route.ts`.
- **Deal lifecycle:** `lib/services/deal/*`, `lib/services/esign/*`, `lib/services/pickup/*`, `app/api/webhooks/docusign/**`.
- **Financing/refinance:** `lib/services/financing/*` (unwired), `lib/services/refinance/*` (live OpenRoad redirect).
- **Deferred lifecycle jobs:** `lib/qstash/*`, `app/api/jobs/<name>/route.ts` (12 jobs, all live on QStash).
- **Internal automation substrate (Prompt 1):** `lib/services/comms/comms-outbox.service.ts` + `cron/comms-outbox-drain`; `lead_nurture_schedule` + `cron/lead-nurture-drain`; `jobs_dead_letter` + `cron/dlq-drain`; `cron-monitor.service.ts`/`cron-schedule.ts`.

---

## 3. Lifecycle classification matrix

Classification legend: **WPE** = Working—Production Exercised · **WNE** = Working—Not Production Exercised · **PARTIAL** · **BROKEN** · **FAKE** = Fake-Success · **DUP** = Duplicate · **DEAD** · **MISSING** · **NV** = Not Verified—Requires Live Infrastructure.

| Stage | Classification | Prod exercised? | Critical finding (evidence) |
|---|---|---|---|
| Buyer intake (AI concierge) | **WPE** | Yes (44, live to 2026-08-23) | Real live funnel; `gemini-maps.service.ts` fail-closed; `buyer_opportunities=44` (39 completed). |
| Vehicle request | **WPE / PARTIAL** | Yes (17) but stalls | 12/17 `SUBMITTED`, only 2 `ACTIVE_SOURCING`, 1 `CLOSED_NO_MATCH`. No auto-advance past `INTAKE` (§6). |
| Deposit (real Stripe) | **WNE** | No | `create-intent`+webhook+idempotency all sound; `payment_provider_events=0`. |
| Deposit (admin override) | **WPE** | Yes (6 PAID) | 6 PAID + 1 PENDING, all `$99`, all 2026-07-02; **3 of 6 PAID carry no `stripePaymentIntentId`** — admin-seeded, not settled (§8A). |
| Dealer discovery | **WPE** | Yes (1532) | `dealer_prospects=1532`, `dealer_intelligence=437`, `lead_scores=40`. |
| Dealer entity-resolution / rooftop / contact enrich | **WNE** | No | `dealer_rooftops=0`, `dealer_contact_profiles=0` — resolver/enricher never ran on the 1532. |
| Apollo enrichment/reveal | **NV** | No | `apolloEnabled()` gated on `APOLLO_API_KEY`+`APOLLO_REVEAL_ENABLED`; `apollo_reveals=0`. Ledger/refund logic **honest** (§4). |
| Dealer outreach | **BROKEN / WNE** | No (`dealer_outreach_log=0`) | `sendDealerEmail` returns early on `missingEmailEnvVars` **before logging**; prospects lack emails (`contacts=35`). No touch ever fired. |
| Dealer application/claim | **WPE** | Yes (small) | Transactional approve/claim; `dealer_applications=1`, `dealer_invitations=11` (4 ACCEPTED/6 EXPIRED/1 PENDING). |
| Dealer verification (identity/business/license) | **MISSING / DEAD** | No | `DealerVerification` (schema:3173) **0 code refs**; `DealerLicense` (schema:3186) **never created**; `verifications=0`, `licenses=0`. |
| Dealer agreement / activation | **DUP + FAKE** | Yes (2 ACTIVE) | Two paths; the activating path writes **no signature/certificate**; `dealer_agreement_signatures=0` under 2 ACTIVE dealers (§4, FS-B). |
| Dealer capacity/availability/makes | **WNE** | No | `dealer_capacity_configs=0`, `dealer_availability=0` → routing uses defaults (maxLoad 5, no preferred makes). |
| Dealer inventory (dealer-owned, feeds) | **DEAD** | No | `DealerFeedConfig` captured but never pulled; `CustomAdapter` never imported; **all 206 items unowned** (`dealer_id`/`added_by_admin_id` NULL). |
| Inventory ingestion (admin/CSV/manual) | **PARTIAL–REAL** | Yes | Admin manual/CSV/search-add persist real rows; `admin_inventory_search_runs=39`, `inventory_upload_batches=2`. |
| Inventory sync accounting | **MISSING / FAKE** | No | No writer for `InventorySource`/`InventorySyncRun`/`InventoryFeedLog`; all `= 0`; syncs report 100% healthy while ingesting nothing (§5, FS-D/E). |
| Inventory quality scoring | **DEAD** | No | `computeQualityScore` 0 callers; `inventory_quality_scores=0`. |
| Matching (buyer↔inventory) | **DEAD** | No | `findMatchedVehicles`/`saveVehiclePreferences` 0 callers; `VehicleMatchScore`/`VehicleRequestMatchResult` never written; all `= 0`. |
| Dealer sourcing / invitation scoring | **WNE** | Partly (6 invitations) | Scored top-8, geo fail-closed, prospects **never invitable**; gated on paid deposit; ~0 executable supply (§6). |
| Auction (System A) | **WPE (to invite only)** | Partly | `auctions=6` all CLOSED (2026-07-02), each linked to buyer+deposit; `auction_invitations=6`, `auction_vehicles=2`. |
| Dealer bidding — canonical `Offer` | **WNE** | No | **`offers=0`** — no invited dealer ever submitted a canonical bid; best-price/select/deal never ran. |
| Dealer bidding — concierge `VehicleOffer` (System B) | **WPE** | Yes | Only path with real submissions: `vehicle_offers=6`, `dealer_offer_submissions=2`, `buyer_offer_reviews=3`. Transactional dead-end (§7, FS-H). |
| Request offer `VehicleRequestOffer` (System C) | **WNE / DORMANT** | No | Wired to `Deal.vehicleRequestOfferId`; `vehicle_request_offers=0`. |
| Best Price Report | **PARTIAL / FAKE** | No | Buyer route reimplements ranking with **fabricated junk-fee figures** (§7, FS-I); `best_price_calculation_logs=0`. |
| Buyer selection → Deal | **WNE** | No | `select-offer.service.ts` `FOR UPDATE`, at-most-one Deal; `deals=0`. |
| Dealer award | **WNE** | No | Durable `dealerAwardDispatchedAt` + `cron/dealer-award-dispatch`; never fired. |
| Deal progression / status machine | **WNE** | No | `advanceDealStatus`/`canTransition` guarded, insurance hard-gate; `deal_status_history=0`. |
| E-sign (DocuSign) | **WNE / NV** | No | Webhook HMAC verify, idempotent; mock fails safe (stalls at `SIGNING_PENDING`); `e_sign_envelopes=0`. Real envelope = **NV**. |
| Financing (in-house) | **DEAD / MISSING** | No | `requestLenderDecision` invoked by no route/job; only `MockLenderAdapter`; buyer apply stops at `SUBMITTED`; `credit_applications=0`. |
| Refinance (OpenRoad) | **WPE** | Yes (15) | Lead qualify → redirect `openroadlending.com/applyone/?aid=1445`; `refinance_applications=15` (7 REDIRECTED/4 QUALIFIED/4 INELIGIBLE), `refinance_compliance_logs=15`. Lead handoff only — no credit decision. |
| Pickup / delivery | **WNE** | No | Local QR (no external API), insurance gate; `pickups=0`. |
| Completion / reconciliation | **WNE** | No | `deals=0`; durable reconcilers exist but two gaps (§8, §9). |
| Post-deal jobs (review/referral) | **WNE** | Barely | 12 QStash jobs live; deal/auction/offer paths barely exercised. |

---

## 4. Fake-success inventory (critical)

Each row: file · claimed vs actual · consequence · root cause · required correction (described only) · risk tier (A internal/data · B external/comms/dealer-facing · C money/contract/consequential). **No code changed.**

| ID | File / function | Claimed | Actual | Consequence | Root cause | Correction (described) | Tier |
|---|---|---|---|---|---|---|---|
| **FS-A** | `components/buyer/PreIntelligencePanel.tsx:72` (buyer `/deposit`) | "$99 Refund Guarantee … returned within 3 business days — no questions asked" | No-offer/no-dealer paths **never auto-refund**; `deposit-activation.service.ts:54,149-161` retains; `auction.service.ts:172-173` admin-discretionary only | Buyers pay $99 on a written auto-refund promise the system doesn't honor; consumer-protection / chargeback exposure | UI copy not reconciled with deposit-retention policy | Either implement no-offer auto-refund, or change copy to "admin-reviewed refund" — do not ship the guarantee text while retention is coded | **B/C** |
| **FS-B** | `app/api/dealer/onboarding/route.ts:147-193` (AGREEMENT step) | `success`, dealer `ACTIVE`, `agreedToTermsAt` set | No `DealerAgreementSignature`, no SHA-256/IP/UA, no ESIGN certificate; DocuSign is `void…catch` fire-and-forget, silently skipped when unconfigured | ACTIVE dealers bound only by a bare timestamp — no enforceable, tamper-evident network agreement; `signatures=0` under 2 ACTIVE | Activation path and legal-signature path built separately, never unified | Route AGREEMENT completion through the same signature-writing txn as `agreement/sign`; require a signature row before `ACTIVE` | **C** |
| **FS-C** | `app/api/dealer/onboarding/route.ts:117-123` (LICENSE step) | License step "done", advance | Stores free-text `licenseNumber`; never creates `DealerLicense`/`DealerVerification`; no format/registry check; `DealerVerification` is dead | Unlicensed/unverified entity can reach `ACTIVE` and bid on real buyer auctions; `licenses=0`, `verifications=0` | Verification models never wired | Create `DealerLicense`/`DealerVerification` on LICENSE step (min. format validation); gate activation on verified license | **C** |
| **FS-D** | `lib/services/inventory/marketcheck.adapter.ts:56-65` | Sync ran, 100% healthy | With no `MARKETCHECK_API_KEY` returns `vehicles:[]` and **no `error`**; `computeAdapterHealth` scores it 100%; cron logs SUCCESS | Operators believe inventory is live/fresh when it is static seed data | Absence-of-config modeled as clean success; health denominator is error-count, not "did we ingest" | Emit distinct NOT_CONFIGURED status; persist `InventorySyncRun`/`FeedLog`; cron reports degraded when 0 sources active | **A/B** |
| **FS-E** | `app/api/cron/inventory-sync-full/route.ts:13-28`; `-priority` | `success:true` | No `InventorySyncRun` ever written → a green cron is indistinguishable from a no-op; `inventory_sync_runs=0` | Accounting tables designed, never wired | Wrap each run in `InventorySyncRun` (RUNNING→SUCCEEDED/FAILED) with fetched/upserted/deactivated counts | **A** |
| **FS-F** | `lib/services/inventory/autotrader.adapter.ts:75-79`; `custom.adapter.ts:53-55` | Adapter integration | `extractListings()`/XML/CSV branches `return []` by design; dead (not imported) | Latent: re-enabling silently ingests nothing while scoring healthy | Placeholder parsers left in tree | Remove dead adapters or implement real parsers before any re-enable | **B** |
| **FS-G** | `app/api/cron/inventory-stale-sweep/route.ts:75-104` | Emails dealer "inventory feed sync failure" | Dealer DMS/feed path is DEAD — platform never attempts the sync it blames the dealer for | False external-facing signal to dealers who configured a feed URL | Sweep assumes a feed puller that doesn't exist | Suppress feed-failure email until feed ingestion is actually implemented | **B** |
| **FS-H** | `app/api/public/buyer-offer-review/[reviewToken]/respond/route.ts:75-129` | Buyer "accepted"; `success:true`; emails; `requestStatus="buyer_interested"` | Creates **no `Deal`, no `Deposit`, no `Offer`**; never touches journey/deal state | The only production-exercised offer path cannot advance to financing/e-sign/pickup — `deals=0` follows directly | System B built as standalone lead-capture, never joined to transactional core | Converge System B accept into `Deal`/`Deposit`, or relabel surface as "express interest" (see §7) | **C** |
| **FS-I** | `app/api/buyer/auctions/[auctionId]/best-price/route.ts:84,103,117` | "Junk fees" figure in Best Price Report | `junkFeesCents = (sorted[0].feesCents*0.3)|0` for Cash card, hardcoded `0` for Monthly/Overall; ignores real `junkFeeItems` | Buyer sees fabricated junk-fee numbers in the flagship transparency feature | Buyer route reimplements ranking instead of consuming `rankOffers` | Drive all three cards from `rankOffers`' real `junkFeesCents`; delete the 0.3 heuristic and zeros | **B** (High if it renders; masked by `offers=0`) |
| **FS-J** | `best-price.service.ts` (no writer) | `BestPriceCalculationLog` audit trail | No writer anywhere; `best_price_calculation_logs=0` | Ranking is unauditable after the fact | Model defined, writer never implemented | Write `BestPriceCalculationLog` inside `rankOffers` capturing weights/inputs/outputs | **A** |
| **FS-K** | `app/api/admin/deals/[dealId]/action/route.ts:226-258` (REFUND_TRIGGERED) | `{ refunded: true }` | When deposit has no `stripePaymentIntentId`, both the Stripe refund and the `deposit.update→REFUNDED` are skipped, deal forced to `REFUNDED` | Deposit stays `PAID` while deal is `REFUNDED`; success claimed with no settlement | Refund gated solely on `stripePaymentIntentId` truthiness; no-PI branch neither reconciles nor qualifies | Mark deposit `REFUNDED` or return `refunded:false`/needs-manual (mirror the correct `DEAL_CANCELLED` path at `:202`) | **C** |
| **FS-L** | `lib/services/auction/coverage.service.ts:96-208` | `coverage = registered + prospects` (dealers "ready to compete") | Prospects gated on channel config + outreach never fired → effective prospect coverage 0; only 2 registered dealers | Overstates executable competitiveness to buyers | Coverage conflates presence with executable supply | Gate buyer-facing supply claims on invitable-now `registered` count | **B** |
| **FS-M** | `schema.prisma:2751` (`VehicleMatchScore`), `:2960` (`VehicleRequestMatchResult`) | Per-buyer match scoring / results | No writer; tables `= 0`; any surface reading them renders permanent empty state as "found nothing" | Implies a matching capability that does not exist | Models defined, scorer never built | Implement scorer or mark surfaces not-yet-implemented | **A** |
| **FS-N** | `lib/services/dealer/dealer-onboarding.service.ts:7-14` | Onboarding `steps[]`/`complete` status | `license`/`inventory` hardcoded `done:false` → `complete` always false | Any consumer misreports onboarding forever (appears unused) | Stub never wired to live step machine | Wire to live step machine or delete | **A** |

**Non-finding (verified honest):** the Apollo credit-ledger / reveal / **refund** logic truthfully represents real spend. Atomic fail-closed draw (`apollo-credit-ledger.service.ts:75-79`), guarded refund (`:96-99`), matched-but-emailless kept as `billed:true` (never refunded), `throwOnError:true` on the paid call so transport errors are treated as possibly-billed, reveal-store-write failure keeps the credit and only releases the claim, idempotent `(rooftopId, cycleKey)`. No fabricated contacts. Live Apollo HTTP path is **NV**.

---

## 5. Dealer operating lifecycle audit

Full trace: discovery → entity resolution/dedup → contact intelligence → Apollo enrichment → outreach → application/onboarding → rooftop/users/roles → identity/business/license verification → agreement/terms → service-area/makes/capacity/availability → activation → auction eligibility → participation → scoring → suspension/reactivation.

**What works and is exercised:** discovery (1532 prospects, real Gemini, fail-closed), application intake + admin approval (transactional, rollback), invitation → claim (token/expiry/JWT), dealer-user creation, and the guarded suspend/reactivate/terminate machine (`admin-dealer-command-center.service.ts:658-755`).

**What is built but never exercised in production:** rooftop entity-resolution (`dealer-rooftop.service.ts:85-195`, `rooftops=0`), contact intelligence (`dealer-contact-profile.service.ts`, `contact_profiles=0`), scorecard snapshots (`dealer-scorecard.service.ts`, `snapshots=0`), capacity/availability config (all `= 0` → defaults).

**Structural failures (see §4 FS-B, FS-C):**
- **Verification is absent.** `DealerVerification` is entirely dead code; `DealerLicense` is write-never. There is **no identity/business/license gate before activation**. Two activators (admin `approveDealerByAdmin`, self `onboarding`) both flip `PENDING→ACTIVE` with no verification, signature, or license precondition.
- **Split agreement flow.** `POST /api/dealer/agreement/sign` writes the signature + tamper-evident certificate but does **not** activate; `PATCH /api/dealer/onboarding` (AGREEMENT step) activates but writes **no** signature/certificate. Production's 2 ACTIVE dealers with 0 signatures confirm dealers go live through the activating-but-unsigned path.
- **Outreach never fires.** `dealer_outreach_log=0` — root cause is upstream: prospects lack emails (`contacts=35`) and the email channel short-circuits on `missingEmailEnvVars` *before* writing a log row. The 1532 discovered prospects have **no running path to "contactable dealer."**

**Apollo / dealer-spend truthfulness:** honest (non-finding above).

**Top dealer gaps blocking real supply:** (1) no verification gate; (2) discovered→contactable substrate has zero prod rows; (3) outreach never fires; (4) ACTIVE dealers lack enforceable signed agreements; (5) capacity/makes unset degrades routing even for the 2 live dealers.

---

## 6. Inventory ingestion / sync audit

**Intended entry model:** adapter-based ingestion into one `inventory_items` table with a 3-lane provenance model (LANE_1 dealer-owned/verified, LANE_2 external-listing name-matched to an ACTIVE dealer, LANE_3 open-market). Intended channels: MarketCheck aggregator, dealer DMS feeds (`DealerFeedConfig` + `CustomAdapter`), dealer/admin manual + CSV, scheduled sync crons (full 6h / priority 1h / stale-sweep 30m), freshness via `lastSeenAt`.

**Ingestion-method classification:**

| Method | Class | Evidence |
|---|---|---|
| MarketCheck aggregator (orchestrator) | **PARTIAL / NOT CONFIGURED** | Real client but key-gated; empty+healthy no-op when unset (FS-D); never persists source/run rows |
| Admin search-tool (MarketCheck query) | **PARTIAL** | Returns to UI only, no persist; uses a **different host** (`marketcheck-prod.apigee.net`) than the adapter (`api.marketcheck.com`) |
| Admin search-tool → add | **REAL** | `sourceAdapter:"manual_admin"`, LANE_1 |
| Admin manual create / CSV bulk | **REAL** | `manual_admin` / `csv_upload_admin` + `addedByAdminId`; writes `InventoryUploadBatch` |
| Dealer manual / CSV bulk | **PARTIAL** | Sets `dealerId`+LANE_1 but **omits `sourceAdapter` and `lastSeenAt`** (provenance + freshness lost) |
| Dealer DMS/feed (`DealerFeedConfig`) | **DEAD** | Config captured at onboarding, read by stale-sweep, but **nothing ever fetches it**; orchestrator hardcodes `ADAPTERS=[MarketCheck]`; `CustomAdapter` never imported |
| CustomAdapter (generic feed) | **STUB / DEAD** | JSON parse only; XML/CSV `return []`; never instantiated |
| AutoTrader / cargurus / carsdotcom / truecar / edmunds adapters | **DEAD (FAKE-shaped)** | Never imported; AutoTrader `extractListings()` always `return []` (FS-F) |
| Webhook/event ingestion | **MISSING** | No inventory webhook route exists |
| Sync accounting (`InventorySource`/`SyncRun`/`FeedLog`) | **MISSING** | No writer anywhere; all `= 0` (FS-E) |
| Quality scoring / buyer matching | **DEAD** | `computeQualityScore`, `findMatchedVehicles`, `saveVehiclePreferences` — 0 callers |
| Stale sweep | **REAL** | Deactivates non-LANE_1 items past 48h; emails affected dealers (but see FS-G) |

**Provenance of the 206 production items (reconstruction, `VERIFIED—REPOSITORY` on mechanism, `ASSUMPTION` on exact origin):** all 206 have `source_adapter=NULL`, no `dealer_id`, no `added_by_admin_id`, and no LANE_2 — a fingerprint that only the **orchestrator** (which omits `sourceAdapter`/`dealerId` and lands everything in LANE_3) or **`seed.ts`** can produce. Best-fit: an orchestrator run against MarketCheck during a window when the key was set (created ≤ 2026-08-16, `lastSeenAt` ≤ 2026-08-18) produced LANE_3/NULL/unowned rows; an admin then used `PATCH /api/admin/inventory/bulk-lane` (which changes `lane` via `updateMany` **without** touching `sourceAdapter`) to promote **95** rows to LANE_1 (→ the 95 LANE_1 all `is_active=true`, never swept); the stale sweep deactivated the remaining **111** LANE_3 rows (→ all `is_active=false`). The empty accounting tables reflect **absent writers**, not "sync never ran."

**Top inventory gaps:** (1) dealer DMS/feed ingestion is DEAD — the single biggest blocker to real dealer supply; (2) sync accounting entirely unwired (unverifiable "success"); (3) provenance dropped on the primary path; (4) quality-scoring + matching dead; (5) dealer-created items lack `sourceAdapter`/`lastSeenAt`; (6) zero inventory test coverage; (7) endpoint/VIN-normalization inconsistencies risk duplicate rows.

---

## 7. Supply + matching audit

**How supply is determined:** there is **no `lib/services/matching/` directory**. "Matching" is dealer-targeting for a reverse auction, triggered **only by a paid $99 deposit** (`webhooks/stripe/route.ts:167 → inviteDealersToAuction`); `createAuction` requires a `depositId`. A parallel admin path (`admin/buyers/[buyerId]/launch-auction`) selects dealers manually with **no scoring/geo/inventory** and **fabricates a PAID deposit** if none exists.

**Scoring math (`dealer-invitation.service.ts:41-78`):** base 50; tier bonus (PLATINUM +30 / GOLD +20 / STANDARD +10 / PROBATION −20); −5 × `currentAuctionLoad`; hard cut at load ≥ 5; +`offerWinRate`×20; −`junkFeeRatio`×15; **+25 make-match (bonus, never a gate)**; makes come from self-declared `DealerCapacityConfig.preferredMakes`, **not actual inventory**. Caps: `MAX_INVITATIONS_PER_AUCTION=8`, `MIN_COVERAGE_DEALERS=3`, `RADIUS_TIERS=[25,50,100,150]`. Candidate pool = `dealer` (ACTIVE, non-placeholder) — **prospects are never invitable**. Geocode is fail-closed (unplaceable buyer → 0 dealers).

**Presence vs executable supply:** discovered PRESENCE = 1532 prospects (not invitable). Registered = 2 ACTIVE (< `MIN_COVERAGE_DEALERS` 3), with **no dealer-owned inventory**. **Executable supply (verified + active + contactable + relevant inventory) ≈ 0.** Matching is geographic + self-declared-attribute heuristics only; inventory-based matching (`findMatchedVehicles`, `VehicleMatchScore`, `VehicleRequestMatchResult`) is **entirely dead and unwired**.

**Root cause requests stall at `SUBMITTED`:** (1) only `SUBMITTED→INTAKE` auto-advances, and it is conditional (make+ZIP+email) inside a fire-and-forget `after()`; (2) `INTAKE→ACTIVE_SOURCING` has **no** automatic path (only admin routes write it — matching the 2 `ACTIVE_SOURCING` rows); (3) the intake pipeline enriches + discovers prospects and sets only a soft `coverageHoldAt/Reason` flag, never changing `status` or launching an auction; (4) sourcing requires a paid deposit that isn't happening, and executable registered supply is ~0.

---

## 8. Auction + offer audit

**Three offer-bearing subsystems** (the codebase itself merges "System A" + "System B" in `app/api/dealer/offers/route.ts:22-36`):

- **System A — canonical reverse auction** (`Auction`/`AuctionInvitation`/`Offer` → `Deal.offerId`). Fully wired end-to-end with strong concurrency guards (Serializable `submitOffer`/`reviseOffer`, `SELECT…FOR UPDATE` selection, atomic anti-snipe, atomic `postCloseProcessedAt` close claim). **`offers=0`** — never carried a bid past invitation. **WNE.**
- **System B — concierge `VehicleOffer`** (admin-created, token-based; `VehicleOffer` has **no FK to `Auction`/`Deposit`/`Deal`/`Buyer`** — buyer is loose `buyerEmail`/`buyerName` strings). The **only** path with real data (`vehicle_offers=6`, `dealer_offer_submissions=2`, `buyer_offer_reviews=3`). Buyer "accept" only emails + flips a string status — **no `Deal`/`Deposit`** (FS-H). **WPE but transactional dead-end.**
- **System C — `VehicleRequestOffer`** → `Deal.vehicleRequestOfferId` (a **second** Deal offer-FK). Wired to deal creation; `vehicle_request_offers=0`. **WNE / dormant.**

**Duplicate authorities:** (1) three offer→selection→Deal authorities coexist; `Deal` carries two mutually-exclusive nullable offer FKs with no exactly-one enforcement; (2) **three** Best-Price ranking implementations (canonical `rankOffers`; admin `best-price/run` — the only writer of rank columns; buyer route — reimplements with fabricated junk fees + flat 7% APR); the engine and buyer report can disagree; (3) two `Offer`-creation authorities — `submitOffer` (budget cap + financing validation) vs outside-dealer route (**skips budget cap + financing validation**), so an outside dealer can inject an over-budget offer; (4) two dealer-invitation authorities (scored vs admin unscored); (5) `rankOffers` output discarded in `auction.service.ts:142`.

**Race conditions:** System A is well-guarded (no open races found). System B `buyer-offer-review/respond` does a non-transactional read-then-update with no idempotency guard — a double-click double-fires acceptance emails (low blast radius).

**Why offers=0 while System B holds real submissions:** the team operates **manual concierge sourcing through System B**; the automated auction (System A) ran only to invitation. Because System A's downstream is strictly gated on `Offer` rows, all of it is inert in production. `deals=0` confirms **no** offer path (A/B/C) has ever produced a deal. Note the 6 dead auctions **retained** $99 each on no-offer close.

---

## 9. Money / e-sign / financing audit (deeply gated — Tier C)

**A. Stripe / deposit / payment.** Real path (`create-intent` → Stripe → webhook → transactional idempotent claim) is sound and unit-tested but **never exercised in production** (`payment_provider_events=0`). The 6 PAID deposits came from **five non-webhook admin-override paths** (`mark-paid`, `deposit/override`, `launch-auction` inline, `journey/complete`, `journey/complete-all`) — all permission-gated and `AdminAuditLog`-recorded; 3 of 6 carry no `stripePaymentIntentId`. This is admin-seeded test data, **not** a client-trusted-status fake-success. Refund path is real and status-guarded (the one code defect is **FS-K**, the no-PI over-claim).

**B. DocuSign / e-sign.** Webhook HMAC verify (timing-safe, fail-closed), idempotent dedup (piggybacks `PaymentProviderEvent` with `docusign:` key), Contract-Shield hard-gate before signing. Mock mode fails **safe** (stalls at `SIGNING_PENDING`, no fake completion). Real envelope creation is **NV**. Gap: **no cron re-fetches a missing signed PDF** (`documentKey` can stay null).

**C. Financing / refinance.** **Real & exercised:** refinance = **OpenRoad lead handoff** (qualify → persist → compliance-log → redirect; 15 apps; no AutoLenis credit decision). **Planned / unwired:** in-house financing decisioning (credit-application machine, `financing-orchestrator`, ECOA adverse-action, adapter registry) is built + tested but the orchestrator (`requestLenderDecision`) is **invoked by no route/job**, buyer apply stops at `SUBMITTED`, and the only adapter is a scripted `MockLenderAdapter` (every named real adapter → fail-closed `UnconfiguredLenderAdapter`). **No real lender approval capability exists.**

**D. Deal completion.** `select-offer.service.ts` (`FOR UPDATE`, at-most-one Deal), `advanceDealStatus`/`canTransition` (guarded, insurance hard-gate before COMPLETED, `DealStatusHistory`), durable dealer-award marker + cron, pickup QR + insurance gate — all present, guarded, tested, **and entirely unexercised** (`deals=0`, `deal_status_history=0`, `pickups=0`, `service_fee_payments=0`, `commissions=0`). Minor inconsistency: the webhook fee-paid advance records fee fields on the Deal but never creates a `ServiceFeePayment` row (the only writer, `recordFeePayment`, is dead) — `service_fee_payments` stays 0 even after real fees.

**Durability gaps to track:** (1) financing approval side-effects only append audit breadcrumbs with **no cron draining them**; (2) **no signed-PDF re-fetch job**. The deposit→auction post-commit is best-effort but **made durable** by `deposit-activation.service.ts` + reconcile cron.

---

## 10. Deferred QStash business-lifecycle map

**All 12 deferred jobs are LIVE on QStash today** (every producer is an active `dispatch()`, every `app/api/jobs/<name>` consumer exists and HMAC-verifies). **Zero internal substrate has been built for any of them.** Idempotency is **weak across all 12**: `qstash/notify.ts::notifyContact` has no dedup key, so a `retries:3` redelivery re-sends within a touch; DB-state guards only stop the *sequence* on conversion.

| # | Job | Producer | Guard | Risk | Internal replacement target | Notes |
|---|---|---|---|---|---|---|
| 1 | deposit-reminder | `buyer/deposit/create-intent:143`; `buyer/onboarding/complete:52` | `hasPaidDeposit` | A | schedule table (3 steps) → comms_outbox | keep; distinct from deposit-activation-reconcile |
| 2 | auction-active | `webhooks/stripe:208` | — | A | comms_outbox single send + seed schedule | keep live-notify |
| 3 | auction-midpoint | chained +12h | `hasSelectedOffer` | B | schedule off `Auction.endsAt` | **not 1:1** — fixed chain fragile to `AuctionExtensionLog` |
| 4 | auction-closing | chained +12h | **NONE ⚠** | B | endsAt-driven touch | **missing `hasSelectedOffer` guard**; **duplicate** of `cron/auction-close` buyer notify |
| 5 | dealer-invited | `dealer-invitation.service.ts:309` | — | A | comms_outbox + seed schedule | keep invite notify |
| 6 | dealer-bid-reminder | chained | `hasDealerBid` | B | fold into existing `cron/dealer-invitation-reminder` | **largely obsolete/duplicate** (existing cron is endsAt-driven + idempotent) |
| 7 | offer-received | `dealer/offers:81` | — | A | comms_outbox + seed schedule | keep |
| 8 | offer-follow-up | chained | `hasSelectedOffer` | B | schedule + comms_outbox | keep |
| 9 | deal-complete | `admin/deals/[id]/pickup/complete:109` | — | A | comms_outbox + seed schedule | keep |
| 10 | form-submitted | `request-vehicle:603` + 4 voice/auth | — | B/A | comms_outbox + seed schedule | consolidation candidate w/ lead-nurture |
| 11 | check-form-completion | chained | `hasPaidDeposit` | B | schedule (3 steps) — analogue of `lead_nurture_schedule` | keep |
| 12 | review-request | chained +3d; **then dispatches refinance-outreach +60d & referral-nudge +27d** | — | C | comms_outbox single send | **coupled cutover**: migrating it must swap the two Prompt-1 `dispatch()` calls to the dormant `enqueueRefinanceOutreach`/referral-nudge functions |

**Internal substrate available (Prompt 1, dormant for these 12):** Layer A durable schedule tables + drain crons (`lead_nurture_schedule` + `cron/lead-nurture-drain` = closest pattern: `run_at` delay, `UNIQUE(idempotency_key, step)`, claim-CAS, cancel-on-convert); Layer B `comms_outbox` + `cron/comms-outbox-drain` (`enqueueEmail/Sms` with `ON CONFLICT(dedup_key) DO NOTHING` = the enqueue-once idempotency `notifyContact` lacks, TCPA/suppression gates); DLQ `jobs_dead_letter` + `cron/dlq-drain`. Prod corroborates dormancy (`comms_outbox=0`, `lead_nurture_schedule=0`, `jobs_dead_letter=0`).

**No 1:1 obligation:** #4 and #6 duplicate existing endsAt-driven crons and should be **consolidated, not ported**; #3/#4 should be re-derived from auction state. The already-migrated Prompt-1 non-deal jobs (refinance-outreach, referral-nudge, affiliate-inactive, affiliate-reengagement-2) are **not** re-counted here (only linkage: #12 is their live producer).

---

## 11. Dependency graph

```
                       [buyer intake — LIVE]
                               │
                        vehicle request ──────────────┐ (stalls at SUBMITTED)
                               │                       │
   ┌────────────────── EXECUTABLE DEALER SUPPLY ───────┴───────────┐
   │  dealer identity + VERIFICATION (missing)                     │
   │  + dealer INVENTORY ingestion (dead feeds)                    │
   │  + dealer CONTACTABILITY/outreach (never fires)               │
   └──────────────────────────┬───────────────────────────────────┘
                               ▼
                     MATCHING (dead) ── inventory sync accounting (missing)
                               ▼
                    dealer SOURCING / targeting (gated on deposit)
                               ▼
                          AUCTION (System A)
                               ▼
              OFFERS  ── A canonical(0) │ B concierge(real, dead-end) │ C dormant
                               ▼
                        buyer SELECTION
                               ▼
                     DEPOSIT / payment (admin-override only)
                               ▼
              DEAL creation + status machine (deals=0)
                               ▼
         e-sign ── financing/refinance ── pickup/delivery
                               ▼
                    COMPLETION ── reconciliation
                               ▼
              POST-DEAL (review / referral / refinance jobs)
```

**Independently repairable now (no upstream prerequisite):** inventory sync accounting + provenance, matching writers, dealer verification/agreement integrity, deferred-job substrate migration, the money-path defect (FS-K) + durability crons, fake-success copy fixes.
**Cannot be meaningfully implemented before prerequisites:** sourcing progression (needs executable supply + verified dealers), offer-system convergence (needs the canonical-system decision), deal/e-sign/financing live verification (needs real Stripe/DocuSign/lender infra + at least one real offer flowing).

---

## 12. Risk tiers

**TIER A — autonomous, branch-safe** (data hygiene, entity resolution, inventory parsing/normalization/sync accounting, matching/scoring, internal deterministic logic, admin/read-only tooling, observability): inventory `InventorySource`/`SyncRun`/`FeedLog` wiring + NOT_CONFIGURED status (FS-D/E), provenance stamps, remove dead adapters (FS-F), matching writers (FS-M), `BestPriceCalculationLog` (FS-J), onboarding-status stub (FS-N), request auto-advance logic, coverage executable-supply reporting (FS-L).

**TIER B — external / communication / dealer-facing** (autonomous on-branch; **activation/cutover owner-gated** with a real-send verification strategy): dealer outreach enablement, the 12 deferred lifecycle comms + guard fixes (§10), fake-success copy fixes FS-A/FS-G, buyer Best-Price junk-fee fix FS-I, dealer feed-failure email suppression.

**TIER C — money / contract / consequential external state** (isolated, deeply reviewed, **production activation + real-transaction verification owner-gated**; must **not** be buried in an autonomous batch): dealer agreement-signature + certificate unification (FS-B), license/identity verification gate (FS-C), REFUND_TRIGGERED no-PI fix (FS-K), System-B→Deal convergence decision + build (FS-H), financing decisioning wire-up vs refinance-only, signed-PDF + financing-breadcrumb reconciliation crons, all live Stripe/DocuSign/lender verification.

---

## 13. Production throughput reality

`VERIFIED—PRODUCTION` (read-only, 2026-08-24). Key counts only:

| Stage | Count / status | Exercised? |
|---|---|---|
| buyers / dealers (ACTIVE) / affiliates / admins | 14 / **2** / 2 / 1 | — |
| buyer_opportunities | **44** (39 completed; hot 23/warm 9), live to 2026-08-23 | **Yes (live)** |
| vehicle_requests | **17** — SUBMITTED 12, ACTIVE_SOURCING 2, INTAKE 2, CLOSED_NO_MATCH 1 | Yes; **stalls** |
| dealer_prospects / intelligence / lead_scores | **1532** / 437 / 40 (to 2026-06-19) | Discovery yes |
| dealer_verifications / licenses / agreement_signatures | **0 / 0 / 0** | **No** |
| dealer_outreach_log / apollo_reveals | **0 / 0** | **No** |
| dealer_rooftops / contact_profiles / capacity_configs / availability | 0 / 0 / 0 / 0 | No |
| dealer_applications / invitations | 1 / 11 (4 ACCEPTED, 6 EXPIRED, 1 PENDING) | Yes (small) |
| inventory_items | **206** — all `source_adapter` NULL, all unowned; LANE_1 95 (active), LANE_3 111 (inactive) | Admin/search only |
| inventory_sources / sync_runs / feed_logs / quality_scores | **0 / 0 / 0 / 0** | **No** |
| vehicle_match_scores / request_match_results / buyer_inventory_prefs | **0 / 0 / 0** | **No** |
| auctions / invitations / vehicles | 6 (all CLOSED, 2026-07-02) / 6 / 2 | Test burst |
| **offers (canonical)** / auction_extension_logs / best_price_calc_logs | **0** / 0 / 0 | **No** |
| vehicle_offers / dealer_offer_submissions / buyer_offer_reviews | 6 / 2 / 3 (to 2026-07-02) | **Yes (System B)** |
| vehicle_request_offers | 0 | No |
| deposits | 7 (6 PAID / 1 PENDING, all `$99`, 2026-07-02; **3 PAID have no PI**) | Admin override |
| payment_provider_events / webhook_events | **0 / 0** | **No** |
| **deals** / status_history / timeline / notes | **0 / 0 / 0 / 0** | **No** |
| service_fee_payments / commissions / dealer_payments / affiliate_payouts | 0 / 0 / 0 / 0 | No |
| e_sign_envelopes / pickups / documents | 0 / 0 / 1 | No |
| financing / credit_applications / external_pre_approvals | 0 / 0 / 0 | No |
| refinance_applications / compliance_logs | **15** (REDIRECTED 7 / QUALIFIED 4 / INELIGIBLE 4) / 15, to 2026-08-20 | **Yes** |
| cron_job_logs / health_check_logs / jobs_dead_letter | 11635 / 1135 / 0 | Ops live |

**Elaborate systems with zero production usage** (decision evidence, **not** an automatic-deletion mandate): dealer verification, inventory sync accounting + feeds, buyer↔inventory matching, canonical `Offer`/best-price/select/Deal chain, in-house financing decisioning, e-sign, pickup, commissions/payouts.

---

## 14. Implementation batches (fewest coherent programs)

Six programs, dependency- and risk-ordered. Each: objective · included findings · prerequisites · tier · systems touched · autonomy/gate · migrations · tests · review · live-verification · DoD.

### Batch 1 — Executable Inventory & Matching Foundation (TIER A · autonomous)
- **Objective:** make inventory ingestion truthful and wire the dead matching layer so "supply" becomes measurable.
- **Includes:** FS-D, FS-E, FS-F, FS-M, FS-J, FS-L; provenance stamps on all ingestion paths; dealer manual/bulk `sourceAdapter`+`lastSeenAt`; VIN-normalization/endpoint consistency; `VehicleMatchScore`/`VehicleRequestMatchResult` writers + wire `findMatchedVehicles`.
- **Prerequisites:** none.
- **Systems:** `lib/services/inventory/*`, `inventory` crons, `lib/services/auction/coverage.service.ts`, matching models.
- **Migrations:** likely none (writers for existing tables); **any new column = called out explicitly and owner-gated for prod cutover.**
- **Tests:** new inventory-sync-accounting + matching unit suites (currently zero inventory coverage); `pnpm test:all`.
- **Review:** two-pass (`autolenis-code-verification`).
- **Live verification:** MarketCheck sync with a real key in staging (NV in Phase 0).
- **DoD:** a sync writes `InventorySyncRun`/`FeedLog`; NOT_CONFIGURED is distinct from success; matching persists scored rows; no fake-healthy empty sync.

### Batch 2 — Dealer Onboarding Integrity & Verification Gate (TIER C-isolated · owner-gated activation)
- **Objective:** no dealer reaches `ACTIVE` without a signed agreement + certificate and a verified license.
- **Includes:** FS-B, FS-C, FS-N; unify the two agreement paths; create `DealerVerification`/`DealerLicense`; gate activation.
- **Prerequisites:** none (independent), but **policy decision** (does gating lock out the 2 existing dealers?).
- **Systems:** `app/api/dealer/onboarding`, `agreement/*`, dealer verification models, activation authorities.
- **Migrations:** none expected (existing models); backfill/exception plan for the 2 live dealers.
- **Autonomy/gate:** branch build autonomous; **activation-policy change owner-gated** (contractual/regulatory).
- **Live verification:** DocuSign envelope in staging (NV).
- **DoD:** activation requires a signature row + verified license; existing dealers reconciled per owner decision.

### Batch 3 — Request → Sourcing Progression (TIER A/B · autonomous build, cutover-gated)
- **Objective:** requests advance `SUBMITTED→INTAKE→ACTIVE_SOURCING` on real coverage, and the sourcing gate is made intentional.
- **Includes:** the §7 stall root cause; reconcile the admin `launch-auction` duplicate/deposit-fabrication path; define the sourcing gate (deposit vs coverage — **business decision**).
- **Prerequisites:** Batch 1 (executable supply signal) + Batch 2 (verified dealers).
- **Autonomy/gate:** logic autonomous; the deposit-vs-coverage gate decision is owner input.
- **DoD:** a well-formed request with sufficient verified/contactable coverage reaches `ACTIVE_SOURCING` automatically and deterministically.

### Batch 4 — Offer-System Convergence (TIER B/C · owner-decision-gated)
- **Objective:** one canonical offer→selection→Deal authority; the live concierge path either converges to `Deal`/`Deposit` or is explicitly relabeled.
- **Includes:** FS-H, FS-I; unify ranking on `rankOffers`; outside-dealer offer validation gap; the two Deal offer-FKs; `BestPriceCalculationLog`.
- **Prerequisites:** Batch 3; **the canonical-system decision (§16).**
- **Autonomy/gate:** the architecture decision is owner-gated; implementation autonomous once decided; buyer/dealer-facing activation gated.
- **DoD:** exactly one offer path reaches `Deal`; buyer Best-Price shows real junk fees; no over-budget injection.

### Batch 5 — Lifecycle Communications on Internal Substrate (TIER B · autonomous build, real-send owner-gated)
- **Objective:** migrate the 12 deferred jobs (§10) onto Layer A schedule tables + `comms_outbox` (enqueue-once dedup), consolidating the two duplicates and performing the coupled review-request cutover.
- **Includes:** all 12; add missing `auction-closing` guard; fold `dealer-bid-reminder` into existing cron; couple #12 to the Prompt-1 dormant enqueue functions.
- **Prerequisites:** Batches 3–4 (real auction/offer/deal events to drive comms) — first-touch transactional sends (Group 1) can start earlier.
- **Migrations:** new per-lifecycle schedule table(s) mirroring `lead_nurture_schedule` — **called out; prod cutover owner-gated.**
- **Autonomy/gate:** build autonomous; **QStash→internal cutover + real send owner-gated** with a verification strategy.
- **DoD:** each migrated job sends exactly once via `comms_outbox`; QStash route retired only after its internal owner is live; no double-send.

### Batch 6 — Money / Contract / Financing Hardening & Live Verification (TIER C · isolated, owner-gated)
- **Objective:** correct the one money defect, close durability gaps, and decide/verify the financing and payment/e-sign live paths.
- **Includes:** FS-K; financing-breadcrumb drain cron; signed-PDF re-fetch cron; `ServiceFeePayment` write on real fee; financing decision (build in-house vs refinance-only — **business decision**); FS-A deposit-refund policy reconciliation.
- **Prerequisites:** Batch 4 (a real offer/deal to run money through).
- **Autonomy/gate:** isolated branch; **all production activation + real-transaction verification owner-gated**; no real transaction testing until owner authorizes.
- **Live verification:** real Stripe settlement + webhook delivery; DocuSign JWT envelope + webhook; any real lender — all **NV** until infra provided.
- **DoD:** refund reports truthfully; reconcilers drain; live paths verified in a controlled owner-gated run.

> **Production migration rule:** every batch with a migration requires `prisma migrate deploy` at cutover (owner-gated) unless the repo's verified manual-SQL mechanism applies; because production migration history is known to drift, **each cutover must verify PHYSICAL SCHEMA, not just `_prisma_migrations`.**

---

## 15. Live-verification requirements (all NOT VERIFIED — REQUIRES LIVE INFRASTRUCTURE in Phase 0)

- **Stripe:** real deposit settlement + `payment_intent.succeeded`/`charge.refunded` webhook delivery + signature (`payment_provider_events=0` today).
- **DocuSign:** JWT envelope creation, recipient view, `envelope-completed` webhook, signed-PDF storage.
- **MarketCheck:** valid `MARKETCHECK_API_KEY` → confirm a real ingest writes `InventorySyncRun`/`FeedLog`.
- **Apollo:** `APOLLO_API_KEY` + `APOLLO_REVEAL_ENABLED` → confirm ledger draw/refund against real billing.
- **Twilio / Resend:** real SMS/email send with suppression + TCPA gates (dealer outreach + lifecycle comms).
- **Lender:** any real financing adapter (only `MockLenderAdapter` exists).
Minimal read-only production re-queries for future phases (no PII): the count queries in §13; e.g. `SELECT count(*), count(stripe_payment_intent_id) FROM deposits WHERE status='PAID';` to reconfirm authoritative-vs-override settlement.

---

## 16. Unresolved business decisions (owner input required)

1. **Canonical offer system:** A (automated auction), B (concierge `VehicleOffer`), or C (`VehicleRequestOffer`)? Should B converge into `Deal`/`Deposit` or be relabeled "express interest"? (Blocks Batch 4.)
2. **Sourcing gate:** keep sourcing gated on a paid $99 deposit, or advance on request + verified coverage? (Blocks Batch 3.)
3. **$99 deposit refundability:** the buyer UI promises automatic refund on no-offer; the code retains it. Which is the policy? (FS-A — consumer/legal.)
4. **Dealer inventory channel:** are dealer DMS feeds in scope (build `CustomAdapter`), or admin/CSV/manual only? (Shapes Batch 1.)
5. **Verification gating:** require identity/license verification before `ACTIVE`, and how are the 2 existing ungated dealers reconciled? (Blocks Batch 2.)
6. **In-house financing:** build lender decisioning, or remain refinance/OpenRoad-only? (Blocks Batch 6.)
7. **Supply floor:** `MIN_COVERAGE_DEALERS=3` vs 2 active dealers — recruit up, or relax the floor?

---

## 17. Recommended first execution batch

**Batch 1 — Executable Inventory & Matching Foundation (TIER A, fully autonomous, branch-safe).**
It has **no prerequisites**, is the safest tier, directly removes the most operationally dangerous fake-successes (silent 100%-healthy empty syncs, FS-D/E), and turns "dealer supply" from an unmeasurable claim into a real signal by wiring the dead matching layer — the prerequisite for every downstream repair (sourcing, auction, offers). It touches no money, contracts, or external sends, so it can run through implement → two-review → full test matrix → production-readiness on the feature branch without an activation gate.

---

*Phase 0 complete. No application code, schema, or migrations were changed. No production data was mutated. No emails/SMS/invitations/payments/refunds/envelopes/financing submissions were sent.*

---

## 18. Architecture Decisions (Prompt 2 · Step 0 — locked)

Locked from repository evidence before implementing Batch 1, so the batch cannot reinforce a dead, duplicate, or non-canonical path. Evidence tags as elsewhere. **None required an owner STOP** — each is unambiguously supported by the code/schema; #10's full offer convergence is explicitly deferred to Batch 4 and Batch 1 stays offer-agnostic.

| # | Decision (locked) | Rationale / evidence |
|---|---|---|
| 1 | **Canonical dealer-owned inventory = `InventoryItem`** (single table) with `dealerId` → ACTIVE `Dealer`, `lane = LANE_1`. | One table, provenance discriminators distinguish ownership. `VERIFIED—REPOSITORY`: `InventoryItem.dealer` relation, `assignLane` LANE_1 semantics, inventory-intelligence skill. |
| 2 | **The `Dealer` entity owns inventory** via `InventoryItem.dealerId`. Rooftop is future; `Dealer` is the current FK. | `VERIFIED—REPOSITORY`: schema `InventoryItem.dealerId` → `Dealer`. `DealerRooftop` has 0 prod rows and no inventory FK. |
| 3 | **Provenance = `sourceAdapter` (provider) + `dealerId` (dealer-owned) + `addedByAdminId` (admin).** Sync accounting via `InventorySource`/`InventorySyncRun`; feed accounting via `InventoryFeedLog`. | `VERIFIED—REPOSITORY`: existing columns; skill "provenance is `sourceAdapter`". Item-level provenance needs **populating**, not new columns. |
| 4 | **A truthful sync** persists an `InventorySyncRun` per source with an explicit outcome — `SUCCESS` / `ZERO_RESULTS` / `NOT_CONFIGURED` / `DEFERRED` / `FAILED`. Health is computed **only over configured sources that actually ran**; unconfigured are skipped, never scored. An all-unconfigured run yields `healthScore = null`, never 100. | Fixes FS-D/FS-E. `VERIFIED—REPOSITORY`: `InventorySyncRun` fields; skill rule "health scores must stay honest". |
| 5 | **Canonical demand entity = `VehicleRequest`.** Request-scoped match output = **`VehicleRequestMatchResult`**; buyer-scoped recommendation score = **`VehicleMatchScore`**. | `VERIFIED—REPOSITORY`: `VehicleRequestStatus` machine (`ACTIVE_SOURCING`/`OFFER_*`), both match models present but unwritten. |
| 6 | **Downstream sourcing consumes `VehicleRequestMatchResult`.** Batch 1 persists it; Batch 3 sourcing reads it. | `VERIFIED—REPOSITORY`: model carries `requestId` + `source`(lane) + `matchScore` — request-scoped by design. |
| 7 | **Matching supports BOTH** inventory-based (this batch) and dealer-capability targeting (existing sourcing), at **different stages**. Batch 1 = inventory-based request matching only. | `VERIFIED—REPOSITORY`: dealer-capability scoring already lives in `dealer-invitation.service.ts`; inventory matching was dead. Keeping them separate avoids a parallel engine. |
| 8 | **Executable-supply eligibility** = `isActive` ∧ `priceCents>0` ∧ attributable provenance ∧ fresh (LANE_1 exempt while active; external LANE_2/3 must be seen within 48 h). Stale sweep continues to deactivate. | Row-existing ≠ executable. Automatically **excludes the 206 historical orphan rows** (null provenance) without rewriting them. `VERIFIED—REPOSITORY`: `isActive`/`lastSeenAt`/lane columns + stale-sweep. |
| 9 | **Matching ↔ sourcing boundary:** matching answers "which eligible vehicles satisfy this request" (persist `VehicleRequestMatchResult`); sourcing answers "which dealers to invite" (`dealer-invitation.service.ts`). Batch 1 owns matching only. | `VERIFIED—REPOSITORY`: the two concerns already live in distinct services. |
| 10 | **Canonical downstream offer spine = System A (`Offer`/`Auction` → `Deal.offerId`).** Batch 1 couples ONLY to `VehicleRequest` + `InventoryItem` + match models — it writes to **no** offer path (`Offer`, `VehicleOffer`, `VehicleRequestOffer`, `Auction`), so it cannot reinforce the dead/duplicate System B/C. Full convergence deferred to **Batch 4**. | `VERIFIED—REPOSITORY`: §7/§8 — only System A reaches `Deal` with guarded selection. Decision scoped to "don't couple wrong"; convergence is a separate owner-gated batch. |

## 19. Batch 1 — Implementation Status (delivered on this branch)

**Delivered (Tier A, branch-only; no money/contract/comms/offer side effects):**
- **Inventory truthfulness** — adapter `AdapterRunResult` now carries `configured` + explicit `outcome`; MarketCheck & Custom adapters classify NOT_CONFIGURED / ZERO_RESULTS / DEFERRED / FAILED / SUCCESS; orchestrator persists one `InventorySyncRun` per source, computes health only over sources that actually ran (`null`, never 100, when none configured), and stamps `sourceAdapter` provenance + normalized-VIN identity on every ingested row. Fixes **FS-D, FS-E**.
- **Dead-adapter removal** — the 5 returns-nothing web-scrape stubs deleted (**FS-F**); intended `CustomAdapter` retained and made honest.
- **Provenance/freshness on dealer write paths** — dealer manual/CSV routes now stamp `sourceAdapter` + `lastSeenAt`.
- **Executable-supply eligibility** — `inventory-eligibility.ts` (`executableSupplyWhere` + pure `isExecutableSupply`) is the single source of truth; orphan/stale/unpriced rows excluded; the 206 historical orphans are excluded **without** being rewritten.
- **Canonical matching wired** — `request-inventory-match.service.ts` persists `VehicleRequestMatchResult` idempotently (`@@unique([requestId, inventoryItemId])` + upsert + scoped prune in one transaction); deterministic pure scoring (`inventory-match-score.ts`); truthful outcomes MATCHED / ZERO_MATCHES / NO_ELIGIBLE_SUPPLY / SKIPPED_TERMINAL; execution failure throws (never masquerades as zero). Buyer-facing `findMatchedVehicles` rewired onto the same eligibility+scoring and now persists the previously-dead `VehicleMatchScore`. Fixes **FS-M**; supersedes **FS-L** eligibility gap.
- **Observability** — new `inventory-match-refresh` cron (auth-gated, read+match+persist only) records the truthful roll-up via existing `CronJobLog`; FS-G false "feed sync failure" dealer email suppressed until a feed sync is actually attempted.
- **Additive schema** — `SyncRunStatus += {NOT_CONFIGURED, ZERO_RESULTS, DEFERRED}`, `InventorySourceType += MARKETCHECK`, `@@unique` on `InventorySource(type,name)` and `VehicleRequestMatchResult(requestId,inventoryItemId)`.

**PRODUCTION CUTOVER REQUIRES `prisma migrate deploy` — OWNER-GATED** (migration `20261010000000_batch1_inventory_matching_truthfulness`, guarded with `IF NOT EXISTS` / `ADD VALUE IF NOT EXISTS`; verify **physical** schema, not just `_prisma_migrations`). No production data is mutated and the 206 historical inventory rows are **not** backfilled or reattached.

## 20. Batch 2 — Dealer Onboarding Integrity & Verification Gate (delivered on this branch)

**Locked owner decisions:** gate enforcement is **flag-gated, default OFF** (`FLAGS.DEALER_VERIFICATION_GATE`; DB feature flag → `false` when no row); the 2 existing ACTIVE dealers are **grandfathered** (never re-evaluated or auto-deactivated). License verification is deterministic **format/presence validation with record creation — no external provider**; only an admin action may set a license `verified`.

**Gate placement (corrected during independent review).** The real lifecycle is: application/invite → dealer PENDING → **admin approval flips PENDING → ACTIVE** → the (now ACTIVE, able to sign in) dealer onboards and collects a license + signs the agreement. PENDING dealers cannot sign in, so signature/license are gathered *after* activation — gating `PENDING → ACTIVE` on them is unsatisfiable and would deadlock approval. FS-C's real harm is an *unverified dealer bidding on a real buyer auction*, so the gate is enforced at **auction eligibility**: when enabled, only ACTIVE dealers with a signed agreement AND an admin-verified license are invited to compete. This is satisfiable and correctly grandfather-shaped — an existing ACTIVE dealer keeps portal access but is simply not invited to bid until verified.

**Delivered (Tier C, branch-only; no schema change, no external comms, no production mutation):**
- **FS-B fixed (agreement):** new shared authority `lib/services/agreement/dealer-agreement.service.ts` (`recordDealerAgreementSignature` + `finalizeDealerAgreementCertificate`). BOTH the onboarding-wizard AGREEMENT step and `/api/dealer/agreement/sign` route through it, so a dealer can never be marked "agreed" without a real, tamper-evident `DealerAgreementSignature` (SHA-256 + IP + user-agent) and a certificate generated off the request path.
- **FS-C fixed (license/verification):** `lib/services/dealer/dealer-verification.service.ts` — the LICENSE step validates format/presence and creates a real `DealerLicense` + a `DealerVerification` in the **PENDING (verified=false)** state; format validation is explicitly *not* authoritative verification. New admin route `POST /api/admin/dealers/[dealerId]/verify-license` (OPERATIONAL_ROLES) is the only path that sets `verified = true`, with an audit trail.
- **Verification gate (auction eligibility):** `lib/services/dealer/dealer-auction-eligibility.service.ts` — `filterAuctionEligibleDealerIds` is applied in `inviteDealersToAuction` candidate selection. Flag OFF → no-op (selection unchanged); flag ON → only signed + license-verified dealers are invited. `listLegacyUnverifiedActiveDealers` gives admins the grandfathered-dealer follow-up list.
- **FS-N fixed:** `getDealerOnboardingStatus` now computes `license`/`inventory`/`agreement` from real rows instead of hardcoded `false`.
- **Feature flag** `dealer_verification_gate` registered (default OFF).

**No migration** (all models — `DealerVerification`, `DealerLicense`, `DealerAgreementSignature`, `FeatureFlag` — pre-exist). Enabling the gate is a single owner-gated feature-flag flip; existing dealers are never touched (they only need an admin license-verification to become invite-eligible once the gate is on).

## 21. Batch 3 — Request → Sourcing Progression (delivered on this branch)

**Locked owner decisions:** **deposit-first** — reaching `ACTIVE_SOURCING` surfaces matched inventory + coverage but does **not** launch the competitive dealer auction (that stays gated on the $99 deposit) and does **not** create any Offer or Deal (the vehicle-request module keeps deal/offer creation admin-only); **advance + flag** — thin coverage (below `MIN_COVERAGE_DEALERS`) does **not** block advancement, it only sets the existing coverage-hold marker. Tier A: no money, no external comms, no schema change.

**Root cause fixed.** Requests stalled at `SUBMITTED` because the only auto-advance was a best-effort, conditional (make+zip+email) `INTAKE` bump inside `request-vehicle`'s `after()` that silently failed, and `INTAKE → ACTIVE_SOURCING` had no automatic path at all.

**Delivered:**
- **`lib/services/vehicle-request/request-progression.service.ts`** — `advanceVehicleRequest` deterministically advances `SUBMITTED → INTAKE → ACTIVE_SOURCING`. Each transition is a conditional `updateMany` on the exact prior status (concurrency-safe, idempotent) and writes a `VehicleRequestEvent` (`AUTO_INTAKE`, `AUTO_SOURCING`). At the sourcing step it runs the Batch-1 matcher (`matchInventoryForRequest`) and the coverage gate (best-effort — neither ever blocks advancement). It **stops at `ACTIVE_SOURCING`**; `OFFER_READY`+ and terminal statuses are never touched. `isWellFormedForIntake` = geocodable ZIP + vehicle intent (make/model/notes).
- **`reconcileRequestProgression`** — scans `SUBMITTED`/`INTAKE` requests and advances each (bounded, per-request isolated); the reliable backstop behind the best-effort inline advance. Wired into the existing **`coverage-hold-reconcile`** cron (runs progression, then coverage-hold release) — no new cron surface.
- **`request-vehicle` route** — the ad-hoc INTAKE-only `after()` advance now calls `advanceVehicleRequest` (full progression), still off the request path.
- **Admin `launch-auction` reconciliation** — the manual override now honors the Batch-2 verification gate: flag OFF (default) → unchanged; flag ON → hand-picked but unverified dealers are dropped (reported in the audit log as `droppedUnverifiedDealerIds`; 400 if none remain). The admin's hand-pick capability, comp-deposit, and outside-invite flow are otherwise unchanged (deeper money/offer convergence stays with Batches 4/6).

**No migration**; `VehicleRequestStatus` is a pre-existing stored column (distinct from the derived buyer-journey stage, which is untouched). No auction launch, deposit, offer, or deal is created by progression.

## 22. Batch 4 pre-build decision — Canonical offer system (LOCKED)

**Decision: System A — the canonical reverse-auction `Offer` (`Auction`/`AuctionInvitation`/`AuctionVehicle`/`Offer` → `Deal.offerId`) is the one authoritative offer → buyer-selection → deposit → Deal spine.** Engineering-resolved from repository evidence; chosen on architecture, not row count (all three paths have `deals`=0; no path has ever produced a Deal).

**Why A (verified field-level):** it is the only system where the *dealer* authors a validated, component-level OTD offer (`assertOtdComponentsMatch`, junk-fee/APR/budget validation) tied by real FKs to a deposit-gated `Auction`, a real `Buyer`, and (optionally) real `InventoryItem` via `AuctionVehicle.inventoryItemId`; where status is an enum (`OfferStatus`); where acceptance is a locked, idempotent transaction (`commitOfferSelection`: `SELECT … FOR UPDATE` + `Deal.offerId @unique` + re-check) that produces a `Deal`; and where the entire downstream (best-price ranking, Stripe, DocuSign, dealer-award dispatch, reconciliation) already hangs off `Deal.offerId`. It already absorbs the "sourced / unregistered dealer" case via the Outside-Dealer placeholder + `externalDealer*` fields and the working `outside-dealer-offer` route that mints a real `Offer`.

**System B (`VehicleOffer` concierge) — adapter + retire the dead-end.** Real value = admin concierge intake (rich buyer context) + public dealer submission w/ document upload. Convergence: on "send to buyer", mint a (deposit-policy-gated) `Auction` and convert each non-rejected `DealerOfferSubmission` into a real `Offer` (registered `dealerId`, else outside placeholder + `externalDealer*`), running the JSON price through `assertOtdComponentsMatch`; present via the authenticated best-price surface; route buyer acceptance through `commitOfferSelection`. **Delete the `buyer-offer-review/[reviewToken]/respond` fake-success** (it only flips `BuyerOfferReviewItem.status` + `VehicleOffer.requestStatus="buyer_interested"` and emails — no `deal/deposit/offer.create`, no `Deal` FK anywhere in System B → FS-H root cause). Legacy `VehicleOffer`/`DealerOfferSubmission`/`BuyerOfferReview` models remain **read-only intake history**.

**System C (`VehicleRequestOffer`) — adapter + retire the write path.** It creates a `Deal` via `Deal.vehicleRequestOfferId` but carries **no dealer identity**, a single `priceCents` (no OTD), and an unlocked `deal.create` (weaker than A). Re-express an admin-concierge offer as an `Offer` on an `Auction` built from the `VehicleRequest` (`Auction.vehicleRequestId` FK already exists); stop writing `Deal.vehicleRequestOfferId` (keep the column read-only for history).

**Target authoritative lifecycle:** `VehicleRequest` → sourcing/matching (Batch 1) → `Auction` (deposit-policy-gated) + dealer participation → dealer-authored `Offer` (validated OTD) → best-price report → buyer `select-offer` (`commitOfferSelection`, `FOR UPDATE`) → `Deal` (single FK `Deal.offerId`) → agreement/e-sign/financing → pickup/completion → reconciliation. After convergence there is exactly ONE "accepted offer" authority: `Deal.offerId`.

**Production compatibility (trivial):** `offers`=0 and `vehicle_request_offers`=0 (nothing to migrate); `deals`=0 with both offer FKs null (deprecating `Deal.vehicleRequestOfferId` write-side conflicts with zero rows); System B's `vehicle_offers`=6 / `dealer_offer_submissions`=2 (1 of 2 with a real `Dealer` FK) / `buyer_offer_reviews`=3 are lead-capture rows with no `Deal` linkage → retained read-only, no migration required for correctness.

**Batch 4 boundary — CHANGES:** make `Deal.offerId` the sole accepted-offer authority; converge B and C into A (mint `Auction`+`Offer`, validated OTD, real/placeholder dealer, provenance preserved); route all buyer acceptance through `commitOfferSelection`; delete/redirect the B dead-end; fix FS-I (fabricated junk fees in the buyer best-price route) + unify ranking on `rankOffers` + write `BestPriceCalculationLog` + close the outside-dealer offer validation gap (budget/financing). **LEAVES for the money/e-sign/financing batch (Batch 6):** Stripe deposit/refund mechanics, DocuSign envelope creation, financing submission, deal-completion/status downstream, service-fee — Batch 4 wires Deal *creation* via the canonical path but does not redesign the downstream money/contract mechanics.

**Irreducible owner decision (one):** the concierge **deposit-timing policy** — must every buyer-facing offer flow through the deposit-gated auction (concierge becomes a pre-$99 intake funnel), or does the admin-sourced/concierge path remain a **deposit-optional** mode that still converges into `Deal.offerId` (requiring a deposit-optional auction, since `Auction.depositId` is currently a required `@unique` FK)? This does not change the canonical choice (A); it only shapes how B/C converge.

**OWNER DECISION (superseded — see §23):** an initial "deposit-optional concierge" decision was taken and built, then **reversed**. The governing rule is now **a deposit is required before an auction** (`Auction.depositId` stays a required `@unique` FK). The deposit-optional convergence was reverted; see §23.

## 23. Batch 4 — Canonical offer convergence: BUILT, then REVERTED to "deposit required before auction"

**What happened.** Batch 4 was first built on the resolved decision *deposit-optional concierge* — it made `Auction.depositId` nullable and converged the System-C concierge accept path onto the canonical `Deal.offerId` spine by minting a **deposit-less** synthetic CLOSED `Auction` + canonical `Offer`. That schema change was then rolled back on the working database (validated: `deposit_id` NOT NULL restored, `concierge_source_ref` column/index removed), and the owner reversed the decision to **"we need a deposit before running an auction."** The deposit-optional convergence has been **reverted on this branch** to match.

**Governing rule (current):** no auction — competitive *or* concierge — exists without a `$99` deposit. The competitive reverse-auction path already enforced this (`createAuction(buyerId, depositId)` → `launchAuction` → `ACTIVE` always carries a real deposit); nothing else may create a deposit-less auction.

**Reverted (no longer on the branch):**
- **Schema back to baseline** — `Auction.depositId` is again `String @unique` (NOT NULL), relation `deposit Deposit` (non-optional); `Offer.conciergeSourceRef` removed. `schema.prisma` is byte-identical to the pre-Batch-4 baseline; **no Batch 4 migration exists** (the `20261011000000_batch4_canonical_offer_convergence` forward migration + rollback runbook were deleted). Production never received it. *(If a working/dev DB still carries the forward migration in its `_prisma_migrations` ledger, reconcile with `prisma migrate resolve --rolled-back "20261011000000_batch4_canonical_offer_convergence"` or reset that DB.)*
- **`concierge-offer.service.ts`** adapter and its test suite — deleted (`test:offer` script removed).
- **System C** — `buyer/requests/[requestId]/offer/respond` restored to the legacy `deal.create({ vehicleRequestOfferId })` path (pre-Batch-4 behavior; a real `Deal`, non-canonical FK).
- **Nullable-`depositId` accommodations** in `auction.service.ts` (`createAuction` signature), `deposit-activation.service.ts` (sweep filter), and `offer.service.ts` (guarded deposit lookup) — reverted to baseline.

**KEPT (deposit-agnostic improvements, independently valid):**
- **FS-I fixed** — `app/api/buyer/auctions/[auctionId]/best-price/route.ts`: the three fabricated `junkFeesCents` (`feesCents * 0.3` on Best Cash, hardcoded `0` on Best Monthly / Best Overall) now read the Best Price engine's real per-offer `junkFeesCents`, keyed by `offerId` via `junkFor()` (falls back to `0` only when the engine is unavailable — `rankOffers(...).catch(() => [])`).
- **Best-price audit log** — `rankOffers` writes a `BestPriceCalculationLog` (weights + per-offer result) **opt-in and awaited** (`{ persistLog: true }`); only the terminal callers persist (`processAuctionClose`, admin explicit re-run). The polled buyer GET never writes — no unbounded rows, no floating promise (resolves the M2 finding). Uses the pre-existing `best_price_calculation_logs` table → **no migration**.
- **Buyer-facing dealer name helper** — `lib/services/offer/dealer-display.ts::buyerFacingDealerName` (registered dealer → its name; system-placeholder + external seller → external name; else "AutoLenis Concierge"), wired into `buyer/deal`, `buyer/deal/[dealId]/receipt`, `buyer/contracts/[contractId]` (also suppressing placeholder city/state/tier). This is valid **independent of concierge convergence**: it also prevents the pre-existing Outside-Dealer placeholder name ("AutoLenis Outside Dealer System") from leaking to a buyer whose winning *competitive* offer came from an outside/unregistered dealer.

**Verification after revert (this session):** `pnpm typecheck` ✓ · `pnpm lint` ✓ (0 errors) · `pnpm test:coverage-check` ✓ · `pnpm test:all` ✓ · `pnpm build` ✓. `schema.prisma` confirmed byte-identical to baseline `d0e1db7`; no dangling references to the deleted adapter/field.

**Deferred to the deposit-gated money batch (Batch 6):** converging the concierge / System-C accept path onto `Deal.offerId` **behind a required `$99` deposit** (mint the deposit-gated auction, then the canonical offer/deal), together with Stripe deposit/refund, DocuSign, financing, deal-completion, and service-fee mechanics. Until then System C keeps its legacy `Deal.vehicleRequestOfferId` behavior, and System B remains honest read-only lead-capture (unchanged). No production mutation, no real comms, no migration applied to production.

## 24. Batch 5 — Lifecycle Communications on Internal Substrate (delivered on this branch, DORMANT)

**Scope delivered (TIER B · autonomous build, real-send/QStash cutover owner-gated).** Built the internal replacement substrate for the **12 deferred QStash lifecycle-notification jobs** (§10), mirroring the Prompt-1 dormant reference (`outreach_touch_schedule` / `lead_nurture_schedule`) exactly. **Consolidated** into ONE sequence-discriminated schedule table + drain + cron + enqueue API. **Producers were NOT cut over** — every job still dispatches to QStash; the new substrate is dormant (empty/absent table → drain no-ops `NO_TABLE`/`NO_DUE`). The cutover (apply the raw SQL + swap each `dispatch()` for `enqueueLifecycleTouch(...)` + retire the QStash route) is the **owner-gated** step. This is the same "one authority at all times, never both" posture the reference used.

**Delivered:**
- **`prisma/migrations/manual_supabase_sql/lifecycle_touch_schedule.sql`** (NEW, raw Supabase table — NOT a Prisma model, NOT applied to prod). Columns mirror `outreach_touch_schedule` (+ a nullable `phone` for the `form_submitted` SMS fallback). `UNIQUE(base_key, sequence)` = enqueue-once (closes the QStash "producer fires twice → double send" gap `notifyContact` has no defense for); partial `run_at` drain index.
- **`lib/services/crm/lifecycle-touch-drain.service.ts`** (NEW) — `enqueueLifecycleTouch()` + `drainDueLifecycleTouches()` + a 16-entry `SEQUENCES` map porting all 11 buyer/dealer job bodies **verbatim** (3 deposit-reminder + 3 auction + dealer-invited + 3 offer + deal-complete/review-request + form-submitted + 3 check-form-completion). Sends through the SAME `notifyContact` (TCPA/DNC/suppression/STOP-gated) layer. Claim-CAS + stale-reclaim + `MAX_ATTEMPTS=4` + **columns-only terminal failure** (nothing to `jobs_dead_letter` → no DLQ resurrection), identical to the reference.
- **`app/api/cron/lifecycle-touch-drain/route.ts`** (NEW) + `vercel.json` (`*/15`) + `CRON_STALENESS` registry entry — wired live so monitoring proves it alive; no-ops until cutover.
- **Conversion guards re-checked at drain** (`hasPaidDeposit` / `hasSelectedOffer` reused from `lib/qstash/state`) — a converted buyer is `canceled` (no send, no chain), exactly as the QStash jobs early-exit on each delivery.
- **FIX (job #4):** `auction_closing` now honours `hasSelectedOffer` — the QStash `auction-closing` job had **no guard** and messaged buyers who had already selected an offer. Parity-correct: the migrated sequence skips a converted buyer.
- **CONSOLIDATION (job #6):** `dealer_invited` does **not** chain a bid reminder — the existing endsAt-driven, idempotent `cron/dealer-invitation-reminder` already nudges non-bidding invited dealers (verified). QStash `dealer-bid-reminder` is retired (not ported) at cutover.
- **COUPLED CUTOVER (job #12):** `review_request.postSend` enqueues the day-60 refinance outreach (`enqueueRefinanceOutreach`) and day-27 referral nudge (`enqueueOutreachTouch` `referral_nudge`) via the dormant internal functions — replacing the two QStash `dispatch()` calls. Fired **after** status=done and best-effort, so a coupling failure can never re-send the (non-deduped) review notify.

**Tests:** `lib/services/crm/__tests__/lifecycle-touch-drain.test.ts` (17 cases — enqueue idempotency/phone, NO_DUE/NO_TABLE, send+chain, the conversion-guard cancel, the #4 `auction_closing` guard, dealer entity, the #12 coupled enqueues, gated-still-done, unknown-sequence cancel, retry→failed@MAX, lost-claim skip, query-error throw) + `app/api/cron/__tests__/lifecycle-touch-drain-route.test.ts` (3 — auth/summary/500). Both land in existing globs (`test:crm-services`, `test:cron`) — no `package.json` change.

**Verification (this session):** `pnpm typecheck` ✓ · `pnpm lint` ✓ (0 errors) · `pnpm test:coverage-check` ✓ (161/161) · `pnpm test:all` ✓ (all suites `# fail 0`) · `pnpm build` ✓ (new cron route registered). Independent second review performed.

**Independent review — findings & resolution.** A second, independent review confirmed verbatim copy parity for all 12 jobs, exact chain delays, correct guard placement (incl. the #4 fix), the #12 coupling signatures/timing, the #6 consolidation (not a silent drop), and dormancy/no-double-send. No CRITICAL/HIGH. Three findings, all fixed:
- **M1 — `check_form_completion_*` widened reach.** The migrated chain carried `email`/`phone` and passed them to `notifyContact`, but the QStash `check-form-completion` job passed only `entityId` (target resolves from the linked contact). A buyer with no linked contact would be reached by the internal path but not by QStash — not behaviour-neutral. Fixed with a `deliverToContactOnly` flag on the three `check_form_completion_*` sequences (omit `email`/`phone`, resolve from contact) — exact parity.
- **M2 — chain-upsert throw could re-send.** A rare throw from the next-touch `upsert` would propagate to the drain loop, which resets the row to `pending` and re-sends the (non-deduped) notify — contradicting the "can never re-send" comment. Fixed by wrapping the chain upsert in try/catch (log + continue): once `status=done`, a dropped chain step is recoverable by re-enqueue; a double send is not.
- **L3 — dead `firstName || null`.** `postSend` received the `"there"`-defaulted name, persisting `"there"` downstream instead of null. Fixed by passing the raw nullable `first_name` to `postSend`.
Two tests added (contact-only delivery; chain-throw does not reset/re-send) → 19 service + 3 route cases. One item flagged for the owner at cutover (not a code defect): retiring QStash `dealer-bid-reminder` for the existing dealer-reminder cron drops that reminder's SMS (email-only cron) and shifts its timing to deadline-relative.

**NOT done (owner-gated cutover):** applying `lifecycle_touch_schedule.sql` to Supabase; swapping the 12 producers from `dispatch()` to `enqueueLifecycleTouch(...)`; retiring the QStash `app/api/jobs/*` routes and the `dealer-bid-reminder` chain. No producer references the new substrate yet; no real messages are sent by this change; no SQL applied to production.

## 25. Batch 6 — Money / Contract / Financing hardening (partial; decision-independent items delivered)

**Scope decision (TIER C · isolated, owner-gated).** Batch 6 splits into *decision-independent, no-live-infra hardening* (built here) and *parts blocked on an owner business-decision or live infrastructure* (deferred, below). Delivered only the safe hardening — no money is moved, no live credentials are used, no schema/SQL is applied.

**Delivered:**
- **FS-K — deposit-refund over-claim fixed.** `app/api/admin/payments/deposit/[depositId]/refund/route.ts` flipped a deposit to `REFUNDED` and notified the buyer "your refund has been processed, allow 3–5 business days" **unconditionally** — even for a deposit with no real captured Stripe charge (null `stripePaymentIntentId`, or a synthetic `pi_admin_` id; 3 of 6 PAID deposits have none). No money ever moved, so the notice + status were a fake success (and contradicted the route's own comment). Now: a no-real-charge deposit is **rejected** (`NO_STRIPE_CHARGE` 400) with no flip and no notification; the `PAID→REFUNDED` flip is a **status-guarded `updateMany`** (`409` on a concurrent refund) per the payments transition-matrix rule. The `charge_already_refunded` sync path is preserved.
- **`ServiceFeePayment` write on a real fee.** `service_fee_payments` never populated because its only writer (`recordFeePayment`) was dead. Added `writeServiceFeePayment(dealId, pi)` — the single idempotent row-writer (keyed on `dealId @unique`, P2002-safe, gross/credit/net = $499/$99/$400), reused by `recordFeePayment` — and call it **best-effort from the Stripe webhook fee path** (after the existing source-checked, no-regress status advance) so a real concierge/`service_fee` records the ledger row without ever rolling back the committed fee receipt.
- **Signed-PDF re-fetch cron (durability).** The `envelope-completed` webhook stores the executed DocuSign PDF **inline + best-effort**; a single blip leaves the envelope `COMPLETED` with `documentKey=null` and the buyer download 404s forever (no retry). New `lib/services/esign/signed-contract-refetch.service.ts::refetchMissingSignedContracts` scans `status=COMPLETED, documentKey=null, docusignEnvelopeId != null` and re-invokes the (now-exported) `retrieveAndStoreSignedContract`, writing `documentKey` under a still-null guard; failure-isolated per envelope. New `cron/signed-contract-refetch` (`*/30`) + `CRON_STALENESS` entry. **Dormant without real DocuSign** (`retrieveAndStoreSignedContract` returns null in mock mode).

**Tests:** `writeServiceFeePayment` (idempotency, P2002 race, non-P2002 propagates); FS-K route (no-PI + `pi_admin_` rejected with no flip/notify, real-PI refunds + guarded flip, non-succeeded PI refused, already-refunded, concurrent-409); refetch service (select predicate, restore-guarded, dormant-skip, failure-isolation) + cron route (auth/summary/500). New `test:esign` + `test:admin-payments` scripts wired into `test:all`.

**Verification (this session):** `pnpm typecheck` ✓ · `pnpm lint` ✓ (0 errors) · `pnpm test:coverage-check` ✓ · `pnpm test:all` ✓ (42 suites, `# fail 0`; webhooks suite unaffected) · `pnpm build` ✓ (new cron route registered). Independent second review performed.

**Independent review — findings & resolution.** The review confirmed the three delivered items correct, and caught that FS-K had only been fixed in **one of four** admin deposit-refund paths — the same over-claim (false "refund processed" with no money moved) survived in the three siblings. Fixed by extracting a shared primitive and routing all four through it:
- **`lib/services/payment/refund.service.ts::refundDepositCharge`** (NEW) — the ONE place a deposit's real charge is refunded: returns `NO_CHARGE` (no Stripe call, no flip) for a null/`pi_admin_` deposit, else issues one idempotency-keyed refund and a status-guarded `PAID→REFUNDED` flip (`charge_already_refunded` synced). Callers gate their buyer messaging on a `REFUNDED` result.
- **HIGH — `REFUND_TRIGGERED`** (`admin/deals/[dealId]/action`) sent "Your refund has been processed" + `refunded:true` unconditionally (null deposit, null PI, or `pi_admin_`). Now routes through the helper; the notification + `refunded` flag are gated on money actually moving.
- **HIGH — `AUCTION_REFUND_TRIGGERED`** (`admin/auctions/[auctionId]/action`) told the buyer "your deposit refunded" + `refunded:true` for a null-PI deposit (block skipped). Now helper-gated, honest messaging.
- **MEDIUM ×2 — `pi_admin_` 500 + unguarded flip** in `DEAL_CANCELLED` / `REFUND_TRIGGERED` / `AUCTION_REFUND_TRIGGERED`: the helper returns `NO_CHARGE` for `pi_admin_` (no more Stripe 500 that blocked admin cancels) and uses the guarded `updateMany` in place of the `findFirst`+unconditional-`update` anti-pattern.
- **LOW — `processRefund`** aligned with the `pi_admin_` guard; **LOW — `writeServiceFeePayment`** P2002 re-fetch documented (per-deal PI ⇒ the constraint hit is always `dealId`).
The clean dedicated route (`deposit/[depositId]/refund`) was already correct and keeps its richer PI-status-check + audit flow. New test: `refundDepositCharge` (NO_CHARGE for null/`pi_admin_`, REFUNDED + guarded flip for a real PI, ALREADY_REFUNDED on race, `charge_already_refunded` sync, unexpected-error propagation). Re-ran all gates green.

**DEFERRED — owner business-decision required (NOT built):**
- **FS-A — $99 deposit refundability (decision #3, consumer/legal).** The backend, the `lib/content/compliance` rule engine, the SEO layer, and the `/lp` pages all treat the $99 as a **one-time non-refundable Auction Access Fee, never auto-refunded**; but ~50 buyer-portal + email + AI/voice + nudge/SMS + public-marketing strings (incl. `legal/terms`, a "$99 Refund Guarantee" on `trust`, `PreIntelligencePanel`) promise it is fully refundable / auto-refunded. The *direction* of alignment — rewrite the copy to non-refundable, **or** build a refund path to honor the promise — is itself the business/legal decision. Not touched: rewriting legal/marketing terms without owner + legal sign-off is out of scope for autonomous hardening.
- **In-house financing (decision #6) + its breadcrumb-drain cron.** `requestLenderDecision` / the financing orchestrator is invoked by no route or job (buyer apply stops at `SUBMITTED`), so the approval-side-effect breadcrumbs it would drain are never produced. Building a drain for that path is premature scaffolding for an unwired, owner-gated feature (needs a real lender adapter; only `MockLenderAdapter`/`UnconfiguredLenderAdapter` exist). Default stays refinance/OpenRoad-only. Deferred with #6.

**NOT VERIFIED — requires live infrastructure:** real Stripe deposit/fee settlement + `charge.refunded` webhook delivery, DocuSign JWT envelope creation + `envelope-completed` webhook + real signed-PDF storage (which is what makes the re-fetch cron actually do work), and any real lender decision. No production mutation, no real transactions, no SQL applied to production.
