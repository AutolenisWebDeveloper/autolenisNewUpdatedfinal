# Parity map — AREA: schema (Data model & schema parity)

Repo: /home/user/autolenisNewUpdatedfinal (HEAD 0cd399f, branch claude/autolenis-transaction-implementation-hzyg4l). Read-only static inspection; no DB, no MCP, no tsc.
Spec: docs/transaction-flow/AUTOLENIS-COMPLETE-TRANSACTION-FLOW.md §4 (L143-230), §6.2 (L280-285), §12b/c (L752-765), §28 (L1378-1437), §32 (L1492-1522); visual: AutoLenis-Transaction-Flow.html DEALSTATES/SUPSTATES (L917-931) + S[].tables.
All paths below are relative to `frontend/` unless prefixed.

## 10-line summary

1. Every table the spec labels [BUILT] exists in `prisma/schema.prisma` (verified by `@@map`), but **none of the [BUILT — EXTEND] column additions in §4.1/§4.3/§4.4/§4.5/§6.2/§12b/§32 exist** — 0 of ~95 required new columns are present on vehicle_requests, offers, auction_invitations, deals, financing, external_pre_approvals, pickups, trade_in_submissions, contract_versions.
2. **None of the six spec-required new tables exist** anywhere (schema, 103 migrations, manual SQL, code): `queue_items`, `co_buyers`, `dealer_reaffirmations`, `deal_recaps`, `plan_snapshots`, `post_completion_obligations`. `QueueItemType`/`QueueItemStatus` enums exist (schema L1890/L1898, migration 20260423180146 L86/L89) with zero code references.
3. **No enum additions exist**: `VehicleRequestStatus` lacks DRAFT/PAYMENT_REQUIRED/RADIUS_AUTHORIZATION_REQUIRED (L1654); `DealStatus` lacks all 7 new states (L1513); `FinancingStatus` is still PENDING/SELECTED/APPROVED/DECLINED (L1711); `InsuranceStatus` lacks UNDER_REVIEW/REJECTED/EXPIRED (L1493).
4. Master-rule-10 FKs are both missing: `deposits.vehicle_request_id` (Deposit L401-414 has buyerId only) and `trade_in_submissions.vehicle_request_id` (L2056-2075 has buyerId only). Deposit→request lineage today is only `deposit → auction(depositId @unique) → auction.vehicleRequestId?` and the Stripe webhook creates the auction **without** a request id (app/api/webhooks/stripe/route.ts:208-214).
5. `comms_outbox` exists **only** as manual SQL (prisma/manual_supabase_sql/comms_outbox.sql) — not in Prisma, no Prisma migration, no RLS statement found. It covers dedup/run_at/claim/attempts/retry; it has **no** trigger-event column, no send-time transaction-state recheck, no cancellation rule, no `delivered` state, and terminal failure is `logger.error` only (no Operations alert).
6. `contract_scan_version_link` is real: Prisma `ContractScan.contractVersionId` (L654-669), migration `20261016000000_contract_scan_version_link`, mirror manual SQL, writer contract-shield.service.ts:188, gate dealer-contract.service.ts:80-91. Its header says "LOCAL / STAGING ONLY — NOT APPLIED TO PRODUCTION"; production state UNVERIFIED. It shares timestamp `20261016000000` with `ai_action_intent_lifecycle` (MIGRATIONS.md requires unique timestamps).
7. `InsuranceStatus.EXTERNAL_UPLOADED` is treated as satisfied and releases the vehicle today (deal.service.ts:41-45 `INSURANCE_SATISFIED`, app/api/dealer/pickup/scan/route.ts:76, upload-proof route auto-drives INSURANCE_PENDING→CONTRACT_PENDING) — BROKEN against §15/§32.
8. Offer data is DUPLICATED across four surfaces: `offers`, `vehicle_offers`+`dealer_offer_submissions`, `vehicle_request_offers` (a third surface the spec does not mention; `Deal.vehicleRequestOfferId` links to it), and `outside_auction_invites.offer_*`. Buyer criteria/trade data are duplicated on `vehicle_offers.buyer_*`.
9. DB-level enforcement of "one open request per buyer" and the 5-candidate shortlist cap does not exist: only `vehicle_requests(buyer_id,status)` (non-unique) and `shortlist_items(shortlist_id,inventory_item_id)` unique; `hasActiveRequest()` exists but has **no callers**; the cap is `MAX_SHORTLIST_ITEMS = 5` in lib/constants.ts:47 enforced in shortlist.service.ts:36 only. A precedent for the needed partial-unique index exists (`credit_applications_one_active_per_deal`, migration 20261007000000).
10. Stronger-than-spec safeguards to preserve: unique `outside_auction_invites(auction_id, rooftop_id)`; tamper-evident hash-chained `financing_audit_events`; hash-bound e-sign envelope + append-only `e_sign_envelope_history`; `Auction.vehicleRequestId` FK `onDelete: SetNull`; `DealerRooftop.websiteHost` unique; `DealStatusHistory.from/to` as free `String` (additive enum values will not break history rows).

---

## Rows

Legend: status ∈ ALREADY CORRECT | PARTIAL | BROKEN | MISSING | DUPLICATED | UNVERIFIED. "Evidence" = path:line (frontend/-relative unless noted).

### §4.1 vehicle_requests (spec L147-167)

| # | spec_ref | requirement | status | current implementation | evidence | stronger safeguard | required change | legacy path | notes |
|---|---|---|---|---|---|---|---|---|---|
| 1 | §4.1 L149 | Both entry methods create/attach exactly one `vehicle_requests` row; no new fulfillment table | PARTIAL | `VehicleRequest` model; unified intake `promoteOpportunity` creates one VR per BuyerOpportunity (idempotent on `buyerOpportunityId`), not one per buyer; inventory-selection path (shortlist→auction) creates no VR at all (Stripe webhook creates Auction w/o request) | prisma/schema.prisma:1032-1072; lib/services/acquisition/unified-buyer-intake.service.ts:277-320; app/api/webhooks/stripe/route.ts:208-214; lib/services/vehicle-request/vehicle-request.service.ts:21-26 (`hasActiveRequest`, no callers) | — | Make inventory selection create/attach a VR; wire `hasActiveRequest` (or a partial-unique index) into every Lane-1 create path | shortlist/deposit→auction path, unified intake | `hasActiveRequest` also omits EXPIRED from its notIn list (schema has EXPIRED) — an EXPIRED request blocks a new one if ever wired |
| 2 | §4.1 L149 | VR carries buyer, status lifecycle, budget, criteria, assigned admin, cancellation, coverage hold | ALREADY CORRECT | `buyerId,status,makePreference,modelPreference,yearMin,yearMax,maxBudgetCents,notes,assignedAdminId,cancelledAt,cancelReason,coverageHoldAt,coverageHoldReason` | schema.prisma:1033-1058 | coverage hold is flag-only (never a status) per comment L1045-1051 | none | — | "criteria" today = make/model/year only |
| 3 | §4.1 L149 | Attribution: `utm_source, utm_medium, utm_campaign, source_url, referrer, landing_source, ip_address, buyer_opportunity_id` | ALREADY CORRECT | all eight present (`@map`) | schema.prisma:1044-1055; index 1070 | — | none (note §5 rule 2 also wants `utm_content`, `affiliate_id` — absent on VR; out of this area) | — | landingSource/referrer create has a P2022 fallback in unified intake (L303-323) implying migration may lag in some env |
| 4 | §4.1 L153 | `entry_type` (INVENTORY_SELECTION / CUSTOM_REQUEST) | MISSING | no column, no enum | grep `entry_type` schema.prisma → none | — | Add nullable `entry_type` text/enum + backfill CUSTOM_REQUEST for existing rows | — | |
| 5 | §4.1 L154 | `inventory_item_id` on VR | MISSING | only `AuctionVehicle.inventoryItemId` (auction level, FK to InventoryItem) | schema.prisma:511-526 | — | Add `inventory_item_id` (FK, SetNull) | — | ShortlistItem.inventoryItemId has NO FK (lib/services/shortlist/shortlist-availability.ts:5) |
| 6 | §4.1 L155 | `deposit_id` on VR ("$99 attaches to the request") | MISSING | Deposit→Auction (`Auction.depositId @unique`) only; VR↔Deposit unlinked | schema.prisma:401-414, 420 | Auction.depositId unique = one auction per deposit (keep) | Add `deposit_id` (FK) on VR **and** `vehicle_request_id` on deposits (see §32 row) | stripe webhook auction creation | |
| 7 | §4.1 L156 | `pre_qualification_id` | MISSING | `PreQualification.buyerId @unique` (one per buyer); no request link | schema.prisma:308-344 | — | Add FK column; since prequal is 1:1 per buyer today, decide whether to relax to per-request | — | |
| 8 | §4.1 L157 | `co_buyer_id` | MISSING | no `co_buyers` table; only a boolean `coBuyer` in the public form schema, not persisted on VR | app/api/public/request-vehicle/route.ts:106; components/public/RequestVehicleFormClient.tsx:309,465 | — | Create `co_buyers` first, then FK | — | admin detail reads `meta.coBuyer` (app/admin/vehicle-requests/[id]/VehicleRequestDetailClient.tsx:270) — source of that meta not traced |
| 9 | §4.1 L158 | `trade_in_submission_id` | MISSING | none | schema.prisma:1032-1072 | — | Add FK (SetNull) | — | |
| 10 | §4.1 L159 | `city, state, zip, latitude, longitude` snapshot on VR | MISSING | Buyer has `address/city/state/zip` (no lat/lng); VR none | schema.prisma:35-39 (Buyer); BuyerOpportunity.zip 3935 | — | Add five columns; geocode at intake | — | DealerRooftop/InventoryItem carry lat/lng — geocode util likely exists (not traced) |
| 11 | §4.1 L160 | `authorized_max_radius_miles` (server-enforced) | MISSING | constant `SHORTLIST_RADIUS_MILES = 100` (shortlist only); `InventorySource.radiusMiles` is sweep config | lib/services/shortlist/shortlist-radius.ts:25; schema.prisma:2428 | — | Add int column (nullable) | — | |
| 12 | §4.1 L161 | `down_payment_cents` on VR | PARTIAL / DUPLICATED | `VehicleRequestFinancing.downPaymentCents` (1:1 with VR) and `FinancingScenario.downPaymentCents`, `VehicleOffer.buyerDownPayment` (String) | schema.prisma:1093, 2082, 3755 | — | Prefer reading VehicleRequestFinancing (single source) over adding a second writable copy; if added to VR, make VRF the derived view | — | domain-model invariant: one fact, one writable place |
| 13 | §4.1 L162 | `delivery_preference` (PICKUP/DELIVERY) | MISSING | none | — | — | Add | — | |
| 14 | §4.1 L163 | `body_type, drivetrain, exterior_colors, interior_colors, max_mileage, condition_preference, required_features, preferred_features, purchase_timeframe` | MISSING / DUPLICATED | Spread across `VehicleRequestFinancing.purchaseTimeframe` (1112), `BuyerInventoryPreference.preferredBodyStyles/maxMileage/features` (3007-3013, buyer-level), `VehicleOffer.buyerDrivetrain/buyerMaxMileage/buyerInteriorColor/buyerMustHave` (3757-3762), public form fields `interiorColor/mustHaveFeatures/openToAlternatives` sent only to notification metadata | app/api/public/request-vehicle/route.ts:644-652 | — | Add the criteria columns on VR; migrate form fields to write them; make VehicleOffer read them | public request-vehicle route, admin VehicleOffer intake | |
| 15 | §4.1 L165 | Status additions `DRAFT, PAYMENT_REQUIRED, RADIUS_AUTHORIZATION_REQUIRED` | MISSING | enum has 11 values | schema.prisma:1654-1666 | — | `ALTER TYPE "VehicleRequestStatus" ADD VALUE` ×3; update exhaustive maps (see "Enum enumerations" below) | — | |
| 16 | §4.1 L165 | Existing 11 values retained | ALREADY CORRECT | SUBMITTED…EXPIRED | schema.prisma:1654-1666 | — | none | — | |

### §4.2 buyer_opportunities (L169-171)

| # | spec_ref | requirement | status | current | evidence | safeguard | change | legacy | notes |
|---|---|---|---|---|---|---|---|---|---|
| 17 | §4.2 | Lead record with session, conversation, contact, ZIP, budget, timeline, trade indication, financing need, consent, lead score/temperature, source, intake state; parent of VR | ALREADY CORRECT | `BuyerOpportunity`: sessionId@unique, conversationId, consentSms/consentAt, source, budgetType/Amount, timeline, zip, hasTradeIn/tradeInDetails, financingNeeded, intakeProcessedAt/Attempts/FailedAt/FailureReason, leadScore/leadTemperature; `VehicleRequest.buyerOpportunityId` soft link | schema.prisma:3893-3997, 1054-1055 | intake retry/terminal fields | none | — | contact-detail columns not individually enumerated here (model tail read only) |

### §4.3 offers (L173-181)

| # | spec_ref | requirement | status | current | evidence | safeguard | change | legacy | notes |
|---|---|---|---|---|---|---|---|---|---|
| 18 | §4.3 L175 | `offers` auction-scoped, dealer-scoped, versioned (`version`,`original_offer_id`), ranked three ways, junk-fee itemization, APR flag | ALREADY CORRECT | `auctionId, dealerId, version, originalOfferId@unique, rankCash/rankMonthly/rankBalanced, bestPriceScore, junkFeeItems Json, aprFlag` | schema.prisma:571-612; migration 20260423003354 L774 | `originalOfferId @unique` (one revision chain) | none | — | |
| 19 | §4.3 L179 | Add `vin, stock_number, vehicle_year/make/model/trim, vehicle_condition, odometer, exterior_color, interior_color` | MISSING / DUPLICATED | none on `offers`; vehicle detail lives on `VehicleOffer.vehicleVin/Year/Make/Model/Trim/Mileage/Color/InteriorColor/Condition` and `DealerOfferSubmission.vehicles Json`, `VehicleRequestOffer.vehicleInfo Json`, `AuctionVehicle.year/make/model/trim/mileage` | schema.prisma:3733-3743, 3826, 1163, 515-526 | — | Add columns on `offers`; optionally `auction_vehicle_id` FK to bind offer→candidate (§22a) | admin VehicleOffer intake, outside-dealer offer page | no candidate binding exists (`auctionVehicleId` absent in offer/auction services) |
| 20 | §4.3 L179 | `availability_confirmed, doc_fee_cents, title_registration_cents, add_on_items, incentive_items, delivery_terms, delivery_fee_cents, out_of_state_registration_supported, expires_at` | MISSING | `feesCents` lump, `junkFeeItems`; no per-fee columns, no expiry | schema.prisma:576-581 | — | Add columns (Int cents / Json / Bool / timestamptz) | — | |
| 21 | §4.3 L179 | `required_feature_matches, required_feature_mismatches, condition_report_url, vehicle_history_report_url, photo_urls` | MISSING | none | — | — | Add (Json/String[]) | — | |
| 22 | §4.3 L181 | `vehicle_offers` stays as staff intake but **must write a canonical `offers` row**; criteria/trade read from VR | BROKEN / DUPLICATED | `VehicleOffer`→`DealerOfferSubmission`→`BuyerOfferReview` is a fully parallel offer model with no relation to `Offer`; a **third** surface `VehicleRequestOffer` (`Deal.vehicleRequestOfferId @unique`) also exists; `OutsideAuctionInvite.offer_*` embeds a fourth; `VehicleOffer.buyer_*` re-keys criteria and `buyerTrade*` re-keys trade | schema.prisma:3728-3856, 1160-1176, 620 (Deal.vehicleRequestOfferId), 478-487; consumers: lib/services/vehicle-request/vehicle-request-offer.service.ts, app/api/buyer/requests/[requestId]/offer/respond/route.ts, lib/services/auction/outside-invite.service.ts (writes `Offer` via `offerId` link L487) | OutsideAuctionInvite already links to a real `Offer` (`offerId @unique`) — pattern to copy | Make VehicleOffer/DealerOfferSubmission and VehicleRequestOffer write/point to `offers`; deprecate `Deal.vehicleRequestOfferId` in favour of `Deal.offerId` | app/buyer/deal/*, app/buyer/contracts/*, deal-document-link.service.ts read VehicleRequestOffer | spec says vehicle_offers has "6 records" — DB count UNVERIFIED |

### §4.4 auction_invitations (L183-187)

| # | spec_ref | requirement | status | current | evidence | safeguard | change | legacy | notes |
|---|---|---|---|---|---|---|---|---|---|
| 23 | §4.4 L185 | Three surfaces exist as described (registered/scored/no token; outside/tokenized/embedded offer; dealer onboarding) | ALREADY CORRECT | `AuctionInvitation` (auctionId, dealerId, invitationScore, sentAt/viewedAt/respondedAt, @@unique(auctionId,dealerId)); `OutsideAuctionInvite` (dealershipName, contactName, email, phone, token uuid @unique, rooftopId, expiresAt, sentAt/viewedAt/respondedAt, offer_* , offerId, @@unique(auctionId,rooftopId)); `DealerInvitation` (tokenHash, expiresAt, status…) | schema.prisma:530-543, 464-498, 3656-3679 | `@@unique([auctionId, rooftopId])` on outside invites (TOCTOU backstop, L491-495); DealerInvitation stores `tokenHash` (hashed) | none | — | |
| 24 | §4.4 L187 | Consolidate into `auction_invitations` adding `rooftop_id, dealership_name, contact_name, email, phone` | MISSING | AI has none; OAI has all but rooftop is soft key (no FK, by design L470-475) | schema.prisma:530-543, 473 | keep soft rooftop key (comment: deleting a rooftop must not cascade into offer history) | Add columns on AI; migrate OAI rows | outside-invite.service.ts, app/(public)/dealer-offer-outside/[token], app/api/public/outside-dealer-offer/[token], app/api/admin/offers | |
| 25 | §4.4 L187 | `token_hash` (unique, expiring, auction-and-rooftop-bound link) | MISSING (weaker) | OAI stores **plaintext** `token String @unique @default(uuid())`; AI has no token | schema.prisma:469 | DealerInvitation/BuyerRequestClaimToken/DealerAccountClaimToken already use SHA-256 `tokenHash` (3662, 3710, 3686) — copy that pattern | Add `token_hash @unique` + issue hashed tokens; drop plaintext after window | outside offer token routes | |
| 26 | §4.4 L187 | `expires_at, status, queued_at, delivered_at, bounced_at, declined_at, is_registered_dealer` | MISSING (expires_at PARTIAL) | OAI.expiresAt exists (483); no status/queued/delivered/bounced/declined/is_registered on either | schema.prisma:483, 530-543 | — | Add columns; derive status enum | — | |
| 27 | §4.4 L187 | Offer fields on `outside_auction_invites` move to `offers` | PARTIAL | OAI still carries `offerOtdCents/VehicleCents/TaxCents/FeesCents/Notes` **and** links `offerId → Offer` | schema.prisma:478-487 | offerId link | Stop writing offer_* on OAI; read via offerId | outside-invite.service.ts | |
| 28 | §4.4 L185 | `dealer_invitations` unchanged | ALREADY CORRECT | separate onboarding model | schema.prisma:3656-3679 | hashed token | none | — | |

### §4.5 deals (L189-195)

| # | spec_ref | requirement | status | current | evidence | safeguard | change | legacy | notes |
|---|---|---|---|---|---|---|---|---|---|
| 29 | §4.5 L191 | `deals` carries status, financing path, insurance status, fee fields, Contract Shield score/status, risk tier | ALREADY CORRECT | `status DealStatus, financingPath String?, insuranceStatus InsuranceStatus, feePaidAt/feeAmountCents/stripeFeePIId/feeRefundedAt/feeRefundedAmountCents, contractShieldScore/Status, riskScore/riskTier` | schema.prisma:615-634 | dealerAwardDispatchedAt/dealerAwardAttempts durable dispatch marker (630-640) | none | — | `financingPath` is String not `FinancingPath` enum (Financing.path is the enum) — two representations |
| 30 | §4.5 L191 | Cannot identify vehicle/VIN/dealership/auction/request | ALREADY CORRECT (as a defect statement) | Deal has `buyerId, offerId?@unique, vehicleRequestOfferId?@unique` only; lineage only via `offer→auction→(vehicleRequestId?, depositId)` and `offer.dealerId` | schema.prisma:617-620, 571-574, 456-470 | — | see rows 31-35 | — | `Deal.offerId` is nullable — a Deal may have neither offer link |
| 31 | §4.5 L195 | Lineage: `vehicle_request_id, auction_id, deposit_id, dealer_id, rooftop_id` | MISSING | none | schema.prisma:615-651 | — | Add 5 FK columns (SetNull) + indexes + backfill from offer chain where resolvable; orphans → Operations exception (§3) | — | |
| 32 | §4.5 L195 | `vin`, vehicle snapshot (`year, make, model, trim, odometer_at_offer`) | MISSING | none (VehicleRequestOffer.vehicleInfo Json, AuctionVehicle) | — | — | Add | — | |
| 33 | §4.5 L195 | `co_buyer_id, trade_in_submission_id` | MISSING | none | — | — | Add after co_buyers exists | — | |
| 34 | §4.5 L195 | `otd_cents_confirmed, down_payment_cents, plan_snapshot, recap_confirmed_by_buyer_at, recap_confirmed_by_dealer_at, vehicle_hold_until, condition_disclosure_acknowledged_at` | MISSING | none | grep schema → no matches for recap/vehicle_hold/otd_cents_confirmed | — | Add | — | |
| 35 | §4.5 L195 | `financing_terms_locked_at, financing_completed_at, funding_cleared_at, dealer_executed_contract_id, pickup_ready_at, possession_confirmed_at, completed_at` | MISSING | `Pickup.completedAt` exists (857); ESignEnvelope.executedDocumentKey (gated, 750-753) is the platform-generated executed artifact, not the dealer-executed copy | schema.prisma:857, 750-753 | — | Add | — | |

### §4.6 queue_items (L197-199)

| # | spec_ref | requirement | status | current | evidence | safeguard | change | legacy | notes |
|---|---|---|---|---|---|---|---|---|---|
| 36 | §4.6 | `QueueItemType` (8 values) and `QueueItemStatus` (5 values) exist | ALREADY CORRECT | enums declared | schema.prisma:1890-1907; prisma/migrations/20260423180146_complete_schema/migration.sql:86,89 | — | none | — | zero references in lib/app/components (only unrelated amips `ContentQueue`) |
| 37 | §4.6 | `queue_items` table with type, status, transaction reference, owner role, assigned admin, buyer-visible status, required action, deadline, return point, resolution, timestamps | MISSING | no table (multi-name search: queue_items/QueueItem/"queue_items" → none). Nearest existing: `FinancingReviewTask` (financing only: taskType, status OPEN/IN_PROGRESS/RESOLVED, assignedAdminId, resolution, resolvedBy/At), `PlatformAlert` (level/title/body/source/isResolved), `AffiliateOnboardingReview` | schema.prisma:5797-5818, 3081-3092, 2596 | FinancingReviewTask idiom (one open task per app/type, review-queue.service.ts:35) | Create `queue_items` (Prisma model + migration + RLS deny-all + indexes on (status,type),(assigned_admin_id),(entity_type,entity_id)); route §26 exceptions to it; consider FinancingReviewTask as a typed child or migrate it | ofac.service.ts / anti-circumvention.service.ts / health-alert.service.ts write PlatformAlert | do not build a second generic queue beside FinancingReviewTask without a migration plan |

### §4.7 supporting records (L201-228) — existence check

| # | record | status | evidence | notes |
|---|---|---|---|---|
| 38 | `pre_qualifications`, `prequal_consents` | ALREADY CORRECT | schema.prisma:344, 360 | PreQualification.buyerId @unique (308), expiresAt (311) |
| 39 | `deposits` (+ `vehicle_request_id`) | PARTIAL | schema.prisma:401-414 — no `vehicle_request_id` | see §32 row 3 |
| 40 | `service_fee_payments` with deposit credit | ALREADY CORRECT | schema.prisma:2834-2845 (`amountCents, depositCreditCents, netAmountCents, stripePaymentIntentId @unique`) | |
| 41 | `auctions` references `vehicle_request_id` and `deposit_id` | ALREADY CORRECT (nullable) | schema.prisma:456-470 (`depositId @unique`, `vehicleRequestId?` FK SetNull, index 468); migration 20261003000000 | Stripe-webhook auctions have null vehicleRequestId (route.ts:208-214) |
| 42 | `auction_extension_logs` | ALREADY CORRECT | schema.prisma:2846-2863 | |
| 43 | `best_price_weight_configs`, `best_price_calculation_logs` | ALREADY CORRECT | schema.prisma:1403, 2951 | |
| 44 | `financing` | PARTIAL | schema.prisma:2072-2085 | see §12b |
| 45 | `external_pre_approvals`, `external_pre_approval_documents` | PARTIAL | schema.prisma:2033-2051, 3331-3341 | EPAD.preApprovalId has no Prisma relation (FK in SQL UNVERIFIED) |
| 46 | `vehicle_request_financing` | ALREADY CORRECT | schema.prisma:1123-1150 (`vehicleRequestId @unique`, FK Cascade) | |
| 47 | `insurance_policies`, `insurance_quotes`, `insurance_providers` | ALREADY CORRECT | schema.prisma:2127-2144, 2111, 3608 | InsurancePolicy has provider, policyNumber, proofUrl, effective/expiry, verifiedAt/By — matches §15 "Recorded" |
| 48 | `trade_in_submissions`, `trade_in_valuations` | PARTIAL | schema.prisma:2056-2075, 3281 | see §6.2 |
| 49 | `contract_versions`, `contract_scans`, `contract_scan_rules`, `junk_fee_patterns` | ALREADY CORRECT (existence) | schema.prisma:2624-2639, 654-669, 657, 2939 | contract_versions additions missing (§32) |
| 50 | `e_sign_envelopes` (hash, consent snapshot, IP, certificate), `e_sign_envelope_history` | ALREADY CORRECT in schema; production UNVERIFIED | schema.prisma:700-772, 781-830; migrations 20261013/20261014/20261015 | code states 20261014/20261015 are "AUTHORED BUT DELIBERATELY UNAPPLIED in production" and prod has 28/35 columns (lib/services/esign/esign-schema-gate.ts:6-18; flag `ESIGN_EXECUTED_ARTIFACT_ENABLED`) |
| 51 | `pickups` (turn-taking counters + reminders) | ALREADY CORRECT | schema.prisma:853-876 (`proposedTime/By/At, counterCount, proposedReminderSentAt, counterReminderSentAt`, PickupStatus PROPOSED/DEALER_COUNTERED) | |
| 52 | `comms_outbox` | PARTIAL | prisma/manual_supabase_sql/comms_outbox.sql (not Prisma; no migration; no RLS) | see comms_outbox section |
| 53 | `document_requests`, `documents`, `document_versions` | ALREADY CORRECT | schema.prisma:2203-2215 (dueAt), 2188, 3294 | |
| 54 | `circumvention_attempts` | ALREADY CORRECT | schema.prisma:2752 | |
| 55 | `identity_firewall_entries` | ALREADY CORRECT | schema.prisma:2764 | |
| 56 | `dealer_scorecard_snapshots`, `sla_violations` | ALREADY CORRECT | schema.prisma:1269, 3356 | |
| 57 | `buyer_request_claim_tokens` | ALREADY CORRECT | schema.prisma:3708-3721 (`tokenHash @unique`, `vehicleRequestId?`, expiresAt, consumedAt) | hashed, single-use |
| 58 | `vehicle_request_due_diligence_checkpoints` | ALREADY CORRECT | schema.prisma:1152-1165 (name, order, completedBy/At) | |
| 59 | `deal_status_history`, `deal_timeline`, `audit_logs`, `admin_audit_logs` | ALREADY CORRECT | schema.prisma:2810-2822 (from/to **String**), 2978-2990, 2643-2656, 1437 | history from/to are strings → additive DealStatus values are safe here |
| 60 | `idempotency_keys`, `webhook_events`, `payment_provider_events`, `jobs_dead_letter` | ALREADY CORRECT | migrations/01_phase1_foundation.sql:224-233 (raw, key_hash PK, execution_status CHECK); schema.prisma:2786, 865-874 (`eventId @unique`); jobs_dead_letter raw (MIGRATIONS.md list) | idempotency_keys/jobs_dead_letter are not Prisma models |

### §6.2 trade-in (L280-285)

| # | spec_ref | requirement | status | current | evidence | safeguard | change | legacy | notes |
|---|---|---|---|---|---|---|---|---|---|
| 61 | §6.2 L282 | `trade_in_submissions` gains `vehicle_request_id`, `deal_id` | MISSING | buyer-level only (`buyerId`); `submitTradeIn(buyerId, data)` | schema.prisma:2056-2075; lib/services/trade-in/trade-in.service.ts:7-22 | — | Add both FKs (SetNull) + indexes; update submitTradeIn signature; backfill by buyer's single open VR where unambiguous, else queue_items | trade-in service/route, VehicleOffer.buyerTrade* | |
| 62 | §6.2 L282 | Standalone trade creates lead + **draft** VR then attaches; trade never floats | MISSING | no DRAFT status; no attach path | schema.prisma:1654-1666; trade-in.service.ts | — | depends on rows 15, 61 | — | |
| 63 | §6.2 L284 | Packet fields `lienholder_name, payoff_good_through_date, title_in_hand, title_state, has_second_key, photo_urls, bringing_to_pickup` | MISSING | only `loanStatus`, `loanBalanceCents`, `condition`, `notes` | schema.prisma:2063-2067 | — | Add 7 columns | — | `VehicleOffer.buyerTradePayoff` (String) duplicates payoff loosely |

### §12b financing status model (L752-758)

| # | spec_ref | requirement | status | current | evidence | safeguard | change | legacy | notes |
|---|---|---|---|---|---|---|---|---|---|
| 64 | §12b L754 | `FinancingStatus` currently PENDING/SELECTED/APPROVED/DECLINED | ALREADY CORRECT (as stated) | 4 values | schema.prisma:1711-1716 | — | — | — | |
| 65 | §12b L756 | Add `NOT_STARTED, IN_PROGRESS, TERMS_LOCKED, COMPLETED, FAILED, EXPIRED, NOT_REQUIRED_CASH` | MISSING | — | schema.prisma:1711 | — | `ALTER TYPE "FinancingStatus" ADD VALUE` ×7; there is **no** typed `Record<FinancingStatus>` map to update — writers are literal: financing-orchestrator.service.ts:107-125 (`status: "APPROVED"`), app/api/buyer/financing/route.ts:64-81 (`FinancingStatus.SELECTED`) | — | `CreditApplicationStatus` (5728) is a separate lender-decisioning machine that feeds Financing (comment 5722-5727) — do not merge |
| 66 | §12b L758 | Path `DEALER, EXTERNAL, CASH` | ALREADY CORRECT | `FinancingPath` enum; `Financing.path` | schema.prisma:1844-1848, 2076 | — | none | — | `Deal.financingPath` is a String duplicate (618) |
| 67 | §12b L758 | Add `down_payment_cents, external_reference, evidence_document_id, terms_locked_at, completed_at, verified_by, verified_at, expires_at, failure_reason` | MISSING | Financing has `lenderName, approvedAmountCents, aprRate, termMonths, monthlyPaymentCents, selectedAt` only; related data on CreditApplication.lenderReferenceId, ExternalPreApproval.expiryDate/reviewedBy/reviewedAt, VehicleRequestFinancing.downPaymentCents | schema.prisma:2072-2085, 2033-2051, 1093 | — | Add 9 columns (all nullable) | — | |

### §12c evidence (L760-765)

| # | spec_ref | requirement | status | current | evidence | safeguard | change | legacy | notes |
|---|---|---|---|---|---|---|---|---|---|
| 68 | §12c L762 | `external_pre_approvals` models lender name, amount, APR, term, expiry, document, reviewer, review time | ALREADY CORRECT | `lenderName, approvedAmountCents, aprRate, termMonths, expiryDate, documentUrl, reviewedBy, reviewedAt`, status enum SUBMITTED/REVIEWING/APPROVED/REJECTED/ADDITIONAL_INFO_REQUIRED | schema.prisma:2033-2051, 1718-1724 | — | none | — | |
| 69 | §12c L762 | gains `deal_id` | MISSING | buyerId only | schema.prisma:2035 | — | Add `deal_id` FK (SetNull) + index | — | |
| 70 | §12c L762 | `external_pre_approval_documents` holds artifacts | ALREADY CORRECT | `preApprovalId, documentUrl, mimeType, sizeBytes, uploadedAt, verifiedAt` | schema.prisma:3331-3341 | — | declare Prisma relation/FK if absent in SQL (UNVERIFIED) | — | |
| 71 | §12c L762 | `vehicle_request_financing` remains pre-deal preference feeding the checkpoint | ALREADY CORRECT | 1:1 with VR | schema.prisma:1123-1150 | — | none | — | |
| 72 | §12c L764 | Buyer can never mark financing completed; only Finance/Ops admin against evidence | PARTIAL | buyer route writes `Financing.status = SELECTED` (not completed); no admin "complete" endpoint exists because COMPLETED status does not exist | app/api/buyer/financing/route.ts:64-81 | — | Keep buyer writes ≤ SELECTED/IN_PROGRESS; add admin-only completion writer | — | authz detail belongs to deal-lifecycle area |
| 73 | §12c L764 | Every recording writes source, external ref, amount, down payment, APR, term, payment, expiration, VIN, verifier, time into the financing audit trail [BUILT] | PARTIAL | `FinancingAuditEvent` (sequence @unique, eventType, actorType, actorId, creditApplicationId?, dealId?, buyerId?, ruleId?, payload Json, prevHash/hash) + `appendFinancingAuditEvent` | schema.prisma:5697-5718; lib/services/financing/financing-audit.service.ts:53,92,205 | **tamper-evident hash chain + monotonic sequence** — preserve | Add an event type for financing completion; the listed facts go in `payload` (typed columns not required) | — | table exists in schema; migration 20261004000000_phase5_block1_rules_audit (not opened) |

### §28.1 primary Deal states (L1380-1405)

| # | spec_ref | requirement | status | current | evidence | safeguard | change | legacy | notes |
|---|---|---|---|---|---|---|---|---|---|
| 74 | §28.1 | [BUILT] states FINANCING_PENDING, FEE_PENDING, CONTRACT_PENDING, CONTRACT_REVIEW, CONTRACT_APPROVED, SIGNING_PENDING, SIGNED, INSURANCE_PENDING, PICKUP_SCHEDULED, COMPLETED, CANCELLED | ALREADY CORRECT | in `DealStatus` | schema.prisma:1513-1530 | — | none | — | |
| 75 | §28.1 | [NEW] `DEALER_CONFIRMATION, RECAP_PENDING, DEALER_EXECUTED, FUNDING_PENDING, PICKUP_READINESS, HANDOVER_PENDING, FROZEN_PENDING_RELEASE` | MISSING | — | schema.prisma:1513 | — | `ALTER TYPE "DealStatus" ADD VALUE` ×7 and update every exhaustive enumeration (list below) | — | |
| 76 | §28.1 L1405 | `PENDING, ACTIVE, FEE_PAID, PICKUP_COMPLETE, REFUNDED` retained & mapped forward | PARTIAL | all five are live, first-class states in the transition table and UI; not yet "supporting-record facts" | lib/services/deal/deal.service.ts:15-36; components/admin/AdminDealTabs.tsx:31-34 | — | Keep enum values; stop new transitions into FEE_PAID/PICKUP_COMPLETE/REFUNDED once supporting records carry those facts | service-fee.service.ts:175, stripe webhook route.ts:503-504, mark-paid route:33, journey complete routes | |

**Exhaustive DealStatus enumerations (must be updated when values are added):**
- lib/services/deal/deal.service.ts:15 `TRANSITIONS: Record<DealStatus, DealStatus[]>` (typed — compile error on omission), :36 `TERMINAL`
- lib/domain/status-labels.ts:70 `DEAL_STATUS_LABEL: Record<DealStatus,string>` (typed), :93 `dealStatusTone` switch
- lib/services/notifications/acquisition-comms.ts:106-248 `switch(status)` over all 16 literals (untyped — silent gap)
- lib/services/dealer/dealer-dashboard.service.ts:58 `IN_PROGRESS_STATUSES`
- lib/services/admin/admin-buyer-command-center.service.ts:34, :87 active-status lists
- app/api/admin/buyers/[buyerId]/workflow/move/route.ts:16 `PERMITTED_STAGES` (zod enum)
- components/admin/AdminDealTabs.tsx:31-34; app/admin/buyers/[buyerId]/AdminBuyerCommandCenter.tsx:160-162 (ordered stage arrays)
- lib/services/buyer/journey.ts:80-88; lib/auth/journey-redirect.ts:84-88; lib/services/admin/buyer-journey-admin.service.ts:130; app/buyer/fee/page.tsx:46; app/api/buyer/account/route.ts:29; lib/services/ai/action-intent/catalog.ts:174-182; lib/services/deal/deal-risk.service.ts:32; lib/services/dealer/dealer-billing.service.ts:71; app/dealer/dashboard/page.tsx:29; app/dealer/deals/page.tsx:12; app/admin/reports/risk/page.tsx:47; app/admin/buyers/AdminBuyersClient.tsx:102
- lib/services/contract-shield/contract-shield.service.ts:227 returns `DealStatus[]` transitions

**FinancingStatus enumerations:** none typed; literal writers financing-orchestrator.service.ts:107-125, app/api/buyer/financing/route.ts:73,81.
**InsuranceStatus enumerations:** deal.service.ts:41-45 `INSURANCE_SATISFIED: InsuranceStatus[]` (consumed by deal.service completion gate and app/api/dealer/pickup/scan/route.ts:76); string sets app/admin/buyers/[buyerId]/AdminBuyerCommandCenter.tsx:857, app/buyer/insurance/page.tsx:74.
**VehicleRequestStatus enumerations:** lib/domain/status-labels.ts:15,30,45 (typed Records); app/api/admin/requests/[requestId]/route.ts:18 TRANSITIONS; app/admin/requests/page.tsx:14 TAB_FILTERS; lib/services/analytics/funnel-observability.service.ts:193,200,206; app/api/buyer/requests/[requestId]/cancel/route.ts:19; lib/services/vehicle-request/vehicle-request.service.ts:22 (notIn list).

### §28.2 supporting record states (L1407-1421) vs existing enums

| # | spec_ref | supporting record → required states | status | current enum / column | evidence | change |
|---|---|---|---|---|---|---|
| 77 | §28.2 Payment | pending, processing, paid, failed, disputed, refunded, reconciliation pending | PARTIAL | `DepositStatus` PENDING/PAID/REFUNDED/FAILED; ServiceFeePayment has `paidAt` only; `RefundReason` enum exists (1914) with **zero code references** | schema.prisma:1566-1571, 2834-2845, 1914-1919 | add PROCESSING/DISPUTED/RECONCILIATION_PENDING or model as payment facts; wire or drop RefundReason |
| 78 | §28.2 Sourcing | band 100/150/250, authorization required, limited-auction review, no coverage | MISSING | only `coverageHoldAt/Reason` string tag | schema.prisma:1052-1053 | new sourcing state (column on VR or sourcing record) |
| 79 | §28.2 Auction | pending, active, closed, zero-offer review | PARTIAL | `AuctionStatus` PENDING/ACTIVE/CLOSED/EXPIRED/CANCELLED/REOPENED; `postCloseProcessedAt` marker | schema.prisma:1504-1511, 428 | add ZERO_OFFER_REVIEW or fact column |
| 80 | §28.2 Offer | draft, submitted, revised, expired, selected, declined, revalidation pending | PARTIAL | `OfferStatus` DRAFT/SUBMITTED/ACCEPTED/DECLINED/WITHDRAWN/EXPIRED (+ `version` for revised) | schema.prisma:1532-1539, 588-589 | add REVALIDATION_PENDING (SELECTED≈ACCEPTED) |
| 81 | §28.2 Dealer confirmation | pending, confirmed, rejected, timed out, material change pending | MISSING | no `dealer_reaffirmations` | multi-name search: none | new table + enum |
| 82 | §28.2 Financing | not started … not required — cash | MISSING | see row 65 | schema.prisma:1711 | enum additions |
| 83 | §28.2 Funding | pending, cleared, blocked | MISSING | none (`funding_cleared_at` absent) | grep schema → none | Deal columns/enum |
| 84 | §28.2 Fee | standard resolved, Premium pending, paid, failed, refunded | PARTIAL | Deal.feePaidAt/feeRefundedAt + DealStatus FEE_PENDING/FEE_PAID; ServiceFeePayment.paidAt | schema.prisma:621-625 | plan model (plan_snapshots) + fee state |
| 85 | §28.2 Insurance | uploaded, under review, verified, policy bound, rejected, expired | PARTIAL | `InsuranceStatus` NOT_STARTED/QUOTE_REQUESTED/QUOTE_RECEIVED/POLICY_SELECTED/POLICY_BOUND/EXTERNAL_UPLOADED/VERIFIED/FAILED; `InsurancePolicyStatus` ACTIVE/CANCELLED/EXPIRED | schema.prisma:1493-1502, 1705-1709 | add UNDER_REVIEW, REJECTED, EXPIRED |
| 86 | §28.2 Contract | uploaded, scanning, review, warning, revision required, approved, signing, executed | PARTIAL | `ContractVersionStatus` UPLOADED/SCANNING/APPROVED/REJECTED/SUPERSEDED; `ContractScan.status` free String; `Deal.contractShieldStatus` String | schema.prisma:1805-1811, 658, 627 | add WARNING/REVISION_REQUIRED/SIGNING/EXECUTED |
| 87 | §28.2 Pickup | not scheduled, proposed, dealer countered, scheduled, checked in, dealer released, buyer confirmed, missed, rescheduling, exception | PARTIAL | `PickupStatus` NOT_SCHEDULED/PROPOSED/DEALER_COUNTERED/SCHEDULED/CHECKED_IN/COMPLETED/RESCHEDULED/EXCEPTION | schema.prisma:1583-1594 | add DEALER_RELEASED, BUYER_CONFIRMED, MISSED |
| 88 | §28.2 Communications | queued, sent, delivered, suppressed, failed | PARTIAL | comms_outbox.status CHECK pending/sending/sent/failed/suppressed/skipped; `provider_id` only, no delivery webhook state | manual_supabase_sql/comms_outbox.sql:28-30 | add `delivered` (Resend/Twilio webhook) and `cancelled` |
| 89 | §28.2 Post-completion obligation | pending, overdue, resolved | MISSING | no table | multi-name search: none | new table |

### §28.3 universal transition controls (L1423-1436)

| # | spec_ref | requirement | status | current | evidence | safeguard | change |
|---|---|---|---|---|---|---|---|
| 90 | §28.3 L1435 | Legal-transition table, CAS, history, activity, idempotent comms, exactly-once completion seam [BUILT] | ALREADY CORRECT (with caveats) | `advanceDealStatus`: `TRANSITIONS` table, `canTransition`, `expectedFrom` CAS (opt-in), `DealStatusHistory.create` (:167), `emitDealStatusComms`, `emitDealCompletionEvent`, insurance gate before COMPLETED | lib/services/deal/deal.service.ts:15-120, 167, 225 | history + completion seam | `expectedFrom` is optional (comment L80-92) and `force` bypasses guards — every new checkpoint must pass `expectedFrom`; DealStatusHistory from/to are String (safe for new values) |

### §32 data model changes (L1492-1522) — 26 rows

| # | §32 object | change | priority | status | field-by-field today | evidence | required change |
|---|---|---|---|---|---|---|---|
| S1 | `vehicle_requests` | add entry_type, inventory_item_id, deposit_id, pre_qualification_id, co_buyer_id, trade_in_submission_id, location+geocode, authorized_max_radius_miles, down_payment_cents, delivery_preference, full criteria | P0 | MISSING (0/≈22 columns) | see rows 4-14 | schema.prisma:1032-1072 | one additive migration (all nullable), FKs SetNull, indexes on every FK |
| S2 | `VehicleRequestStatus` | + DRAFT, PAYMENT_REQUIRED, RADIUS_AUTHORIZATION_REQUIRED | P0 | MISSING | 11/14 values | schema.prisma:1654-1666 | ALTER TYPE ×3; update 8 enumerations listed above |
| S3 | `deposits` | + vehicle_request_id | P0 | MISSING | Deposit: id, buyerId, amountCents, status, stripePaymentIntentId@unique, stripeSessionId@unique, refundedAt, createdAt, updatedAt | schema.prisma:401-414 | add FK (SetNull) + index; backfill via auction.vehicleRequestId where present |
| S4 | `co_buyers` | NEW — identity, contact, address, role, consent, required-signer flag | P0 | MISSING | none anywhere | rg co_buyers/CoBuyer → only a boolean form flag | new model + migration + RLS |
| S5 | `deals` | lineage, vin+snapshot, co_buyer_id, trade_in_submission_id, otd_cents_confirmed, down_payment_cents, plan_snapshot, recap confirmations, vehicle_hold_until, condition_disclosure_acknowledged_at, financing/funding timestamps, dealer_executed_contract_id, pickup_ready_at, possession_confirmed_at, completed_at | P0 | MISSING (0/24) | Deal today: buyerId, offerId?, vehicleRequestOfferId?, status, financingPath, insuranceStatus, fee*, contractShield*, risk*, dealerAward* | schema.prisma:615-651 | additive migration; backfill lineage from offer→auction chain; orphans → queue_items |
| S6 | `DealStatus` | + 7 states | P0 | MISSING | 16/23 | schema.prisma:1513-1530 | ALTER TYPE ×7; update ~20 enumerations |
| S7 | `offers` | VIN, stock, vehicle detail, availability, itemized fees/add-ons/incentives, delivery terms, out-of-state, expiration, feature match, report URLs, photos | P0 | MISSING (0/≈25) | see rows 19-21 | schema.prisma:571-612 | additive migration + optional `auction_vehicle_id` |
| S8 | `auction_invitations` | rooftop, contact fields, token_hash, expires_at, status, delivery timestamps, is_registered_dealer; fold in outside_auction_invites | P0 | MISSING | AI: auctionId, dealerId, invitationScore, sentAt, viewedAt, respondedAt | schema.prisma:530-543 | additive columns; migrate OAI rows; keep (auctionId, rooftopId) uniqueness |
| S9 | `dealer_reaffirmations` | NEW | P0 | MISSING | none | rg reaffirm → none | new model |
| S10 | `deal_recaps` | NEW | P0 | MISSING | none | rg deal_recap/DealRecap → none | new model |
| S11 | `FinancingStatus` | + 7 values | P0 | MISSING | 4/11 | schema.prisma:1711-1716 | ALTER TYPE ×7 |
| S12 | `financing` | + 9 columns | P0 | MISSING | Financing: dealId@unique, path, selectedAt, lenderName, approvedAmountCents, aprRate, termMonths, monthlyPaymentCents, status | schema.prisma:2072-2085 | additive |
| S13 | `external_pre_approvals` | + deal_id | P0 | MISSING | buyerId only | schema.prisma:2033-2051 | add FK + index |
| S14 | `credit_applications` | FREEZE — no reads/writes from transaction routes; remove after retention sign-off | P0 | BROKEN (still live) | `CreditApplication` model (5744-5795) with `Deal.creditApplications[]` relation (642), partial-unique `credit_applications_one_active_per_deal` (20261007000000); written by lib/services/financing/financing-orchestrator.service.ts; PII AES-GCM encrypted | schema.prisma:5744-5795, 642; lib/services/financing/*.ts | freeze at service layer (kill switch), keep table; do not drop until retention sign-off |
| S15 | `InsuranceStatus` | + UNDER_REVIEW; EXTERNAL_UPLOADED must not advance/release | P0 | BROKEN | EXTERNAL_UPLOADED ∈ `INSURANCE_SATISFIED` (release gate) and upload-proof auto-drives INSURANCE_PENDING→CONTRACT_PENDING | lib/services/deal/deal.service.ts:41-45; app/api/dealer/pickup/scan/route.ts:76; app/api/buyer/insurance/upload-proof/route.ts:6,138,151-153; AdminBuyerCommandCenter.tsx:857; app/buyer/insurance/page.tsx:74 | ALTER TYPE + remove EXTERNAL_UPLOADED from satisfied set + review workflow (queue_items) |
| S16 | `queue_items` | NEW for existing enums | P0 | MISSING | enums only | schema.prisma:1890-1907 | new model (row 37) |
| S17 | `pickups` | + readiness_confirmed_at, token_hash, token_consumed_at, token_revoked_at, dealer_released_at, released_by, odometer_at_release, condition_at_release, buyer_confirmed_at, funds_collected_method, due_bill_items | P0 | MISSING (0/11) | Pickup: dealId@unique, status, scheduledAt, completedAt, location, qrCodeData (plaintext payload), qrCodeImage, qrExpiresAt, proposedTime/By/At, counterCount, proposedReminderSentAt, counterReminderSentAt | schema.prisma:853-876; qr writers lib/services/pickup/pickup.service.ts:34-79, pickup-coordination.service.ts:118 | additive; replace plaintext `qrCodeData` with `token_hash` pattern |
| S18 | `trade_in_submissions` | + vehicle_request_id, deal_id, lienholder_name, payoff_good_through_date, title_in_hand, title_state, has_second_key, photo_urls, bringing_to_pickup | P0 | MISSING (0/9) | buyerId, vin, year, make, model, trim, mileage, condition, loanStatus, loanBalanceCents, notes, status, valuationCents, valuedAt | schema.prisma:2056-2075 | additive |
| S19 | `contract_versions` | + document_hash, is_dealer_executed, executed_at | P0 | MISSING (0/3) | dealId, documentUrl, version, uploadedBy, status, scanRunAt, approvedAt, rejectedAt, rejectionReason, uploadedAt | schema.prisma:2624-2639 | additive; note `ESignEnvelope.documentHash` already hashes the presented bytes (707) — CV.document_hash should be computed at upload and match |
| S20 | `plan_snapshots` | NEW (P1) | P1 | MISSING | none | rg plan_snapshot → none | new model |
| S21 | `post_completion_obligations` | NEW (P1) | P1 | MISSING | none | rg post_completion → none | new model |
| S22 | `auction_vehicles` | up to five candidates per request with distance; offers bind to a candidate | P0 | PARTIAL | AuctionVehicle: auctionId, inventoryItemId?, year/make/model/trim/mileage/notes; no distance, no cap, no offer binding | schema.prisma:511-526 | add `distance_miles`, `vehicle_request_id`?; add `offers.auction_vehicle_id`; cap enforced in service |
| S23 | `shortlist_items` | enforce five-candidate cap and in-radius rule at write time | P0 | PARTIAL (app-level only) | `MAX_SHORTLIST_ITEMS=5` checked in service; radius check in shortlist-radius.ts; DB has only unique(shortlist_id, inventory_item_id); no FK on inventory_item_id | lib/constants.ts:47; lib/services/shortlist/shortlist.service.ts:36; shortlist-radius.ts:25 | see index section |
| S24 | `inventory_items` | use last_seen_at to gate at 7/30 days | P1 | PARTIAL | `lastSeenAt` exists (991); 7-day STALE flag in shortlist-radius.ts:28; 30-day EXPIRED constant not verified | schema.prisma:991; shortlist-radius.ts:27-43 | confirm EXPIRED window (inventory area) |
| S25 | `vehicle_offers` | keep as staff intake; require canonical `offers` row | P1 | BROKEN | no relation to Offer | schema.prisma:3728-3800 | row 22 |
| S26 | (spec row count) | — | — | — | 25 object rows in §32 table + this map's 4 extra findings (VehicleRequestOffer third surface, RefundReason unused, Deal.financingPath duplicate, duplicate migration timestamp) | — | — |

---

## comms_outbox — exact shape vs §27 requirements

Source: prisma/manual_supabase_sql/comms_outbox.sql (raw SQL only; **not** in schema.prisma; **no** `prisma/migrations` entry; referenced only via supabase-js in lib/services/comms/comms-outbox.service.ts).

Columns: `id uuid PK`, `channel text CHECK('email','sms')`, `dedup_key text NOT NULL` (+ `uq_comms_outbox_dedup_key` UNIQUE), `status text CHECK('pending','sending','sent','failed','suppressed','skipped') DEFAULT 'pending'`, `payload jsonb NOT NULL`, `attempts int DEFAULT 0`, `last_error text`, `last_result text`, `provider_id text`, `run_at timestamptz DEFAULT now()`, `claimed_at timestamptz`, `dispatched_at timestamptz`, `created_at`, `updated_at`. Index `idx_comms_outbox_drain ON (run_at) WHERE status IN ('pending','sending')`.

| §27 requirement | covered? | evidence | gap / change |
|---|---|---|---|
| trigger event | PARTIAL | no column; implied by `payload.idempotencyKey`/`templateId` (comms-outbox.service.ts:32-46) | add `trigger_event text`, `entity_type/entity_id` columns |
| recipient | PARTIAL | `payload.email` / `payload.phone` (jsonb) | acceptable; consider indexed `recipient` column |
| template + required content | PARTIAL | `payload.templateId + templateVariables` or `subject/html` (:191-206) | no "required content" validation |
| send-time state recheck | MISSING | deliverEmail rechecks suppression/consent/EmailSendLog only (:172-190); no transaction-state predicate | add `recheck` descriptor in payload + evaluator before send |
| idempotency / dedup | ALREADY CORRECT | `dedup_key` UNIQUE + `ON CONFLICT DO NOTHING` (:123-139); email path also EmailSendLog SENT precheck (:172) | preserve |
| run_at scheduling | ALREADY CORRECT | `run_at`, `opts.runAt` (:133) | — |
| claiming | ALREADY CORRECT | CAS pending→sending with `claimed_at`; stale reclaim after 10 min; `dispatched_at` → RECLAIM_UNCERTAIN marks failed rather than double-send (:78, :354-410) | preserve (stronger than spec) |
| attempts | ALREADY CORRECT | `attempts`, `MAX_COMMS_ATTEMPTS = 4` (:77) | — |
| delivery status | PARTIAL | terminal: sent/suppressed/skipped/failed; no `delivered` (no provider webhook feedback) | add delivered via Resend/Twilio status webhooks |
| retry policy | ALREADY CORRECT (code-level) | linear backoff `attempt*60s` (:455-465) | policy is not a column; fine |
| cancellation rule | MISSING | no `cancelled` status, no cancel API | add status + `cancel_reason`; cancel on transaction state change |
| terminal-failure Operations alert | MISSING | `logger.error(... dead-lettered ...)` only (:451); explicitly nothing to jobs_dead_letter | write PlatformAlert / queue_items row on terminal failure |
| RLS | UNVERIFIED | no `ENABLE ROW LEVEL SECURITY` for comms_outbox in prisma/ or migrations/ | add in the migration that formalises the table |
| Prisma parity | MISSING | table absent from schema.prisma → invisible to `check-migration-drift.ts` functional gate | either add a Prisma model + migration or document as raw-SQL table in MIGRATIONS.md list (it is not in that list today) |

Routing today: only `sendDealSelectedEmail`, `sendOffersReadyEmail`, `sendDealerOfferWonEmail`, `sendDealerOfferLostEmail`, `sendDealerAuctionClosedNoWinnerEmail` (lib/services/email/resend.service.ts) plus pickup notifications (lib/services/pickup/pickup-notifications.service.ts:117-262, round-specific keys) and CRM/campaign/nurture enqueue through the outbox; ~65 other transactional senders in resend.service.ts use the direct `sendIdempotent` rail (EmailSendLog precheck, resend.service.ts:139-141). Spec L1294 "zero production records" is a DB fact — UNVERIFIED here.

## Indexes today and what DB-level enforcement needs

Current (schema + migrations):
- `vehicle_requests`: `(buyer_id, status)` non-unique (init L816); `(buyer_opportunity_id)` (20261017 L119); `(coverage_hold_at)` (20260929 L20). **No unique.**
- `shortlist_items`: UNIQUE `(shortlist_id, inventory_item_id)` (init L759). `inventory_item_id` has no FK.
- `deposits`: UNIQUE `stripe_payment_intent_id`, UNIQUE `stripe_session_id` (init L762, L765). No buyer index, no request column.
- `auction_invitations`: UNIQUE `(auction_id, dealer_id)` (init L771). (`outside_auction_invites`: UNIQUE `(auction_id, rooftop_id)`, index `(auction_id)`.)
- `deals`: UNIQUE `offer_id` (init L777); UNIQUE `vehicle_request_offer_id` (20260515 L52). No buyer/status index.
- `offers`: UNIQUE `original_offer_id` (init L774). No `(auction_id, dealer_id)` index or per-rooftop cap.

Needed:
- (a) One open VR per buyer: `CREATE UNIQUE INDEX vehicle_requests_one_open_per_buyer ON vehicle_requests(buyer_id) WHERE status NOT IN ('DEAL_CREATED','CLOSED_NO_MATCH','CANCELLED','EXPIRED')` (extend the NOT IN when DRAFT semantics are decided — spec §5 rule 5/6 treats DRAFT as open). Prisma cannot express partial-unique; follow the documented precedent `credit_applications_one_active_per_deal` (schema.prisma:5789-5792 comment; migration 20261007000000). Pre-check duplicates before creating (unknown count — UNVERIFIED). App-side `hasActiveRequest` must be wired and must handle P2002.
- (b) Five-candidate cap: not expressible as a unique index on count. Options: add `position smallint NOT NULL CHECK (position BETWEEN 1 AND 5)` with UNIQUE `(shortlist_id, position)`; or a BEFORE INSERT trigger counting active rows. Also add FK `shortlist_items.inventory_item_id → inventory_items(id)` (SetNull/Restrict) — the service comment (shortlist-availability.ts:5) documents its absence. In-radius rule must stay in service (needs buyer geo).

## Master-rule-10 FKs (spec §3 "every record locates its parent by stored reference")

- `deposits.vehicle_request_id`: MISSING (Deposit L401-414). Today's only path is `auctions.deposit_id @unique` + `auctions.vehicle_request_id?` (nullable, SetNull; null for webhook-created auctions).
- `trade_in_submissions.vehicle_request_id`: MISSING (L2056-2075); also `deal_id` MISSING.

## contract_scan_version_link

- Prisma: `ContractScan.contractVersionId String? @map("contract_version_id")` + relation `onDelete: SetNull` + `@@index` (schema.prisma:654-669).
- Migration: `prisma/migrations/20261016000000_contract_scan_version_link/migration.sql` (ADD COLUMN IF NOT EXISTS, index, guarded FK, rollback block). Mirror: `prisma/manual_supabase_sql/contract_scan_version_link.sql` (byte-similar). Header on both: "LOCAL / STAGING ONLY — NOT APPLIED TO PRODUCTION IN THIS CHANGE."
- Code: writer `scanContract(..., contractVersionId?)` → `contractScan.create({... contractVersionId ?? null})` (lib/services/contract-shield/contract-shield.service.ts:127,188); gate `approveContractVersionByAdmin` hard-refuses null link (`NO_LINKED_VERSION`) (lib/services/dealer/dealer-contract.service.ts:57-91); tests lib/services/contract-shield/__tests__/admin-approve-signable.test.ts.
- Two migrations share the timestamp `20261016000000` (`ai_action_intent_lifecycle`, `contract_scan_version_link`); MIGRATIONS.md ("timestamps must be unique") — ordering between them is undefined for Prisma. Production applied-state: UNVERIFIED.

## Duplicates

1. Offer surfaces ×4: `offers` (canonical), `vehicle_offers`+`dealer_offer_submissions`+`buyer_offer_reviews`, `vehicle_request_offers` (Deal.vehicleRequestOfferId), `outside_auction_invites.offer_*` (has offerId link). Spec names only the first two.
2. Buyer criteria stores ×3: VR (make/model/year/budget), `vehicle_request_financing` (purchaseTimeframe, downPayment, tradeIn), `buyer_inventory_preferences` (body styles, maxMileage, features), plus `vehicle_offers.buyer_*` re-keyed copies.
3. Financing path ×2: `Deal.financingPath String?` vs `Financing.path FinancingPath` (and `CreditApplication.financingPath`).
4. Down payment ×3: `vehicle_request_financing.down_payment_cents`, `financing_scenarios.down_payment_cents`, `vehicle_offers.buyer_down_payment` (String).
5. Trade data ×2: `trade_in_submissions` vs `vehicle_offers.buyer_trade_*` + `buyer_opportunities.trade_in_details Json`.
6. Pickup scheduling writers ×2: lib/services/pickup/pickup.service.ts (`schedulePickup/regenerateQr/checkInPickup/completePickup`) and pickup-coordination.service.ts (`proposePickup/confirmPickup/counter*`) both write `qrCodeData/qrExpiresAt` with different TTLs (48h vs `QR_TTL_MS`).
7. Review/queue stores: `FinancingReviewTask`, `PlatformAlert`, `AffiliateOnboardingReview` — plus the missing `queue_items`; design the new table to absorb, not add a fourth.
8. Migration `20261016000000` timestamp used twice.

## Stronger safeguards to preserve

- `outside_auction_invites` UNIQUE `(auction_id, rooftop_id)` DB backstop for "one rooftop per auction" (schema.prisma:491-495); `Auction.depositId @unique` (one auction per deposit); `Auction.vehicleRequestId` FK `onDelete: SetNull` (auction survives request deletion, 20261003).
- Hashed tokens (`token_hash` SHA-256, raw never persisted, single-use, expiring) on `dealer_invitations`, `dealer_account_claim_tokens`, `buyer_request_claim_tokens` — copy for auction invitations and pickup tokens instead of plaintext `token`/`qrCodeData`.
- `financing_audit_events` hash chain (`prevHash/hash`, `sequence @unique`) and `verifyFinancingAuditChain`.
- `e_sign_envelopes.document_hash` binding + append-only `e_sign_envelope_history` + `executed_document_hash`; `esign-schema-gate` deploy-ahead-of-migration guard.
- `contract_scans.contract_version_id` approval binding with hard refuse on null.
- comms_outbox `dedup_key` UNIQUE + CAS claim + `dispatched_at` RECLAIM_UNCERTAIN (never double-send) + terminal FAILED never re-emitted from DLQ.
- `credit_applications_one_active_per_deal` partial unique (precedent for partial-unique constraints Prisma cannot declare).
- `Deposit.stripePaymentIntentId/stripeSessionId @unique`; `PaymentProviderEvent.eventId @unique`; `ServiceFeePayment.dealId @unique` + `stripePaymentIntentId @unique`.
- `DealerRooftop.websiteHost @unique`; `DealStatusHistory.from/to` as String; `advanceDealStatus` `expectedFrom` CAS + history + completion seam.
- Coverage hold is a flag, never a status (VR L1045-1051).

## Legacy paths affected by the required changes

- Stripe deposit webhook auction creation without request (app/api/webhooks/stripe/route.ts:208-214) — must set `vehicleRequestId`/`depositId` lineage once deposits carry `vehicle_request_id`.
- Unified intake `promoteOpportunity` (one VR per opportunity, not per buyer) — must attach to an open VR (§5 rule 5) once the partial-unique exists, else P2002 at runtime.
- Public request-vehicle route form fields currently written only to notification metadata (route.ts:640-655) → must persist to the new VR criteria columns.
- VehicleOffer/DealerOfferSubmission/BuyerOfferReview admin + public token routes; VehicleRequestOffer buyer respond route and buyer deal pages; outside-dealer token routes.
- `INSURANCE_SATISFIED` consumers (deal completion gate, dealer pickup scan, admin command center, buyer insurance page) and the upload-proof auto-advance driver.
- All DealStatus enumerations listed above (untyped `switch` in acquisition-comms.ts will silently skip new states).
- `hasActiveRequest` (no callers) and admin request TRANSITIONS map for new VR statuses.
- Pickup QR writers (two services) when `token_hash` replaces `qrCodeData`.
- `Deal.financingPath` String readers if consolidated onto `Financing.path`.

## Out-of-scope findings (other areas)

- §5 rule 2 attribution: VR lacks `utm_content` and `affiliate_id` (Buyer has `affiliateId` index L93).
- `RefundReason` enum (L1914) has zero code references — refund reason is not persisted anywhere on Deposit (payments area).
- e-sign migrations 20261014/20261015 authored but (per code) unapplied in production; `ESIGN_EXECUTED_ARTIFACT_ENABLED` flag gates the columns (esign area).
- `backfill_insurance_gate.sql` (owner-gated data backfill) exists beside `prisma/backfill-insurance-gate.ts` (deal-lifecycle area).
- No migration enables RLS on core Prisma transaction tables (deposits, deals, offers, contract_scans, financing, e_sign_envelopes…) — only 41 `ENABLE ROW LEVEL SECURITY` statements across migrations, targeting manual/affiliate tables; core-table RLS state is a Supabase-side fact (security area, UNVERIFIED).
- `CreditApplication` freeze (§32) is a service-layer/kill-switch task (deal-lifecycle/financing area); the schema side is "keep, do not drop".

## UNVERIFIED items

- Production applied-state of migrations 20261014, 20261015, 20261016_contract_scan_version_link, and of `comms_outbox` (raw SQL) — no DB access; code comments assert prod lag.
- `vehicle_offers` row count "6", `comms_outbox` "zero production records", duplicate open-VR count (needed before creating the partial unique).
- FK existence in SQL for `external_pre_approval_documents.pre_approval_id` and `deal_status_history.deal_id` (Prisma declares no relation for the former).
- RLS status on core tables and on `comms_outbox`.
- `insurance_providers`, `trade_in_valuations`, `document_versions`, `sla_violations`, `webhook_events` field shapes (existence confirmed via `@@map` only).
- BuyerOpportunity contact-detail column list (only key fields read).
- Whether `prisma migrate deploy` orders the two `20261016000000` migrations deterministically.

## Open questions for the owner

1. Should `queue_items` absorb `FinancingReviewTask` (typed child) or coexist? Coexisting adds a third exception store.
2. Which of the four offer surfaces are retired vs made to write `offers`: `vehicle_request_offers` is not mentioned in the spec but is what `Deal.vehicleRequestOfferId` links to today.
3. `down_payment_cents` on VR duplicates `vehicle_request_financing.down_payment_cents` — add the column (spec) or reference VRF (domain invariant)?
4. Open-request partial-unique predicate: is `DRAFT` "open"? Is `EXPIRED` closed (the current `hasActiveRequest` says no)?
5. Should `PreQualification.buyerId @unique` be relaxed to allow one prequal per request (VR.pre_qualification_id implies per-request approvals)?
6. Rename one of the two `20261016000000` migrations (breaks checksum/ledger if already applied) or leave and document?
7. Formalise `comms_outbox` as a Prisma model (visible to the drift gate, RLS in a migration) or keep raw SQL and add it to the MIGRATIONS.md raw-table list?
8. `PENDING/ACTIVE/FEE_PAID/PICKUP_COMPLETE/REFUNDED` — freeze new writes after cutover, or keep FEE_PAID as a live state for Standard-plan auto-resolve?

## Verification corrections (adversarial pass)

Method: re-opened every cited file at HEAD 0cd399f (working tree == HEAD for `frontend/prisma/schema.prisma`; `git diff HEAD --stat` empty). Every MISSING column/table/enum value was re-searched under ≥3 spellings across `prisma/schema.prisma`, all 103 `prisma/migrations/*/migration.sql`, and `prisma/manual_supabase_sql/*.sql` (plus `ALTER TYPE … ADD VALUE` and `ALTER TABLE … ADD COLUMN` enumeration per spec table). Result: **all MISSING rows (4-15, 19-21, 24-26, 31-35, 37, 61-63, 65, 67, 69, 75, 78, 81-83, 89, S1-S13, S15-S21) are CONFIRMED MISSING** — no alternative-name hit anywhere. All enum contents (L1493-1530, 1566-1594, 1654-1666, 1711-1724, 1805-1811, 1890-1907, 1914-1919) confirmed byte-for-byte. Corrections below are to status, evidence accuracy, or safeguard claims. Paths frontend/-relative.

Format: spec_ref | original status → corrected status | reason | evidence path:line

- ALL rows citing `schema.prisma` model ranges in the 400-3800 band | (status unchanged) → **evidence corrected** | The prior citations are systematically off by 20-40 lines (e.g. "Offer 571-612", "Deal 615-651", "Pickup 853-876", "Financing 2072-2085", "TradeInSubmission 2056-2075", "ExternalPreApproval 2033-2051" do not point at those models). Enum line numbers were correct. | Actual ranges: Deposit 401-415; Auction 417-458; OutsideAuctionInvite 460-498; AuctionVehicle 500-516; AuctionInvitation 518-531; Offer 533-572; Deal 574-616; ContractScan 631-655; ESignEnvelope 684-772; ESignEnvelopeHistory 783-823; Pickup 826-854; VehicleRequest 1022-1071; VehicleRequestFinancing 1075-1124; VehicleRequestDueDiligenceCheckpoint 1139-1153; VehicleRequestOffer 1155-1170; ExternalPreApproval 2015-2034; TradeInSubmission 2036-2057; Financing 2059-2073; InsurancePolicy 2111-2128; ContractVersion 2624-2640; DealStatusHistory 2810-2822; ServiceFeePayment 2824-2835; PlatformAlert 3081-3093; ExternalPreApprovalDocument 3322-3332; DealerInvitation 3651-3675; DealerAccountClaimToken 3680-3695; BuyerRequestClaimToken 3707-3720; VehicleOffer 3728-3788; BuyerOpportunity 3891-3998; FinancingAuditEvent 5697-5720; FinancingReviewTask 5797-5818 (prisma/schema.prisma).
- §4.1 L149 (row 2) | ALREADY CORRECT → PARTIAL | "criteria" on the VR is only make/model/yearMin/yearMax/maxBudgetCents, and `assignedAdminId` is a bare string with no `@relation`/FK (domain-model invariant: cross-domain links FK-backed). The spec's own [BUILT] sentence is true only in the thin sense. | prisma/schema.prisma:1026-1033 (makePreference…assignedAdminId, no relation); no `assigned_admin_id` FK in any migration (grep).
- §4.1 L149 attribution (row 3) | ALREADY CORRECT → PARTIAL | All eight columns exist, but `buyerOpportunityId` is declared as a Prisma `@relation` (schema expects an FK) while the migration chain adds only the column + index and **no FK constraint** — schema/chain FK drift; the model comment itself calls it a "soft link, application-enforced". | prisma/schema.prisma:1050-1051; prisma/migrations/20261017000000_migration_chain_functional_reconciliation/migration.sql:85,119-120; grep `REFERENCES "buyer_opportunities"` across migrations → none.
- §4.1 L163 (row 14) | MISSING / DUPLICATED (unchanged) → **duplicates extended** | Two further body-type stores not listed: `BuyerOpportunity.bodyStyle` and `SearchFilter.bodyStyle`. | prisma/schema.prisma:3923, 2992.
- §4.2 (row 17) | ALREADY CORRECT (unchanged) → **evidence corrected** | Contact/ZIP/timeline columns verified present (the row said they were "not individually enumerated"): `phone` L3899, `consentSms` L3905, `timeline` L3934, `zip` L3935, `hasTradeIn` L3938, `financingNeeded` L3942, `intakeProcessedAt` L3956, `leadScore/leadTemperature` L3979-3980. | prisma/schema.prisma:3891-3998.
- §4.3 L181 (row 22) & §4.4 L187 (row 27) | BROKEN / PARTIAL (unchanged) → **evidence corrected** | `outside-invite.service.ts` contains no `offerId` reference (cited "L487" does not exist there). `OutsideAuctionInvite.offerId` and the linked `Offer` row are written by **route handlers**: the public token route and the admin offers route (route-level offer creation — architecture note for the auction area). | app/api/public/outside-dealer-offer/[token]/route.ts:125,169; app/api/admin/offers/route.ts:190-218.
- §4.4 L185 (rows 23, 28) | ALREADY CORRECT (unchanged) → **safeguard claim corrected** | "DealerInvitation stores tokenHash (hashed)" is overstated: the model still carries a plaintext `token String? @unique` with its own index beside a **nullable** `tokenHash`; the comment says the plaintext column is dropped in a "separate, later migration once tokenHash is populated everywhere". Only `DealerAccountClaimToken` and `BuyerRequestClaimToken` are hash-only. | prisma/schema.prisma:3657-3659, 3672-3674 (DealerInvitation); 3682 (DealerAccountClaimToken); 3710 (BuyerRequestClaimToken).
- §4.5 L191 (row 30) | ALREADY CORRECT (as defect statement) → **evidence added** | Three creation paths each set exactly one link (`offerId` or `vehicleRequestOfferId`) and nothing at DB level requires at least one; confirmed. | lib/services/deal/select-offer.service.ts:53-55; app/api/admin/deals/route.ts:50-52; app/api/buyer/requests/[requestId]/offer/respond/route.ts:81-88.
- §4.7 `external_pre_approvals`/`_documents` (rows 45, 70) | ALREADY CORRECT / "FK UNVERIFIED" → PARTIAL | Resolved: `external_pre_approval_documents.pre_approval_id` has **no FK** in any migration (only the PK constraint) and no Prisma relation → dangling artifacts possible (domain-model invariant violated). | prisma/migrations/20260423192555_schema_complete/migration.sql:537 (pkey only); prisma/schema.prisma:3322-3332 (no `@relation`); grep `external_pre_approval_documents` + FOREIGN/REFERENCES across migrations → none.
- §4.7 `deal_status_history` (row 59) | ALREADY CORRECT → PARTIAL | Same class of gap: `deal_status_history.deal_id` has no FK (pkey only in the chain) and `DealStatusHistory` declares no relation to `Deal`; the audit spine can dangle. (The from/to-as-String observation stands.) | prisma/migrations/20260423192555_schema_complete/migration.sql:111; prisma/schema.prisma:2810-2822.
- §12c L764 (row 72) | PARTIAL → BROKEN | The buyer route not only writes `Financing.status=SELECTED`; it stamps `approvedAmountCents = otdAmountCents` and then **advances the Deal FINANCING_PENDING → FEE_PENDING as `actorRole: "BUYER"`** with no evidence and no audit event — i.e. today the financing checkpoint is passed on buyer input alone, the exact thing §12c forbids. `appendFinancingAuditEvent` has no caller in this route. | app/api/buyer/financing/route.ts:64-84; callers of `appendFinancingAuditEvent` = review-queue/financing-orchestrator/credit-application/compliance-rule/lender-service only.
- §12c L764 (row 73) | PARTIAL (unchanged) → **evidence added** | `FinancingAuditEventType` has no completion/evidence-recorded event (values: APPLICATION_SUBMITTED … REVIEW_RESOLVED); the audit trail is bound to the credit-application machine, not to `Financing`. | prisma/schema.prisma:5683-5695; lib/services/financing/financing-audit.service.ts:92.
- §28.3 L1435 (row 90) | ALREADY CORRECT (with caveats) → PARTIAL | Control 4 (atomicity) and 6 (audit) are not met by the seam itself: the CAS `deal.updateMany` and the `dealStatusHistory.create` are two separate statements with **no `$transaction`** — a crash between them changes state with no history row (contradicts the domain-model transition pattern). Control 1 (authorization) is not part of the seam either: `actorRole` is a free string that is recorded, not checked; `force` bypasses guards. | lib/services/deal/deal.service.ts:148-151 (updateMany), 167-175 (history create, outside any tx), 77 (`force`), 89 (`expectedFrom` optional).
- §32 `credit_applications` (S14) | BROKEN (unchanged) → **evidence added** | A transaction route still creates and submits credit applications. | app/api/buyer/financing/apply/route.ts:9,71-97; partial unique `credit_applications_one_active_per_deal` at prisma/migrations/20261007000000_phase5_credit_app_one_active_per_deal/migration.sql:16-18.
- §32 `auction_vehicles` (S22) | PARTIAL (unchanged) → **evidence corrected** | Today exactly ONE `AuctionVehicle` is created per auction from the VR's make/model/yearMin (no candidates, no distance); the only `distance_miles` column in the schema is on `DealerProspect`, not `auction_vehicles`. | lib/services/auction/dealer-invitation.service.ts:128-142; prisma/schema.prisma:4286.
- §32 `shortlist_items` (S23) | PARTIAL (unchanged) → **evidence corrected** | The service write path `addToShortlist` enforces only the count cap + dedupe (no radius/freshness); the radius/freshness gate is applied one layer up in the API route via `shortlistGate` before calling the service. Still app-level only; DB has only the unique pair. | lib/services/shortlist/shortlist.service.ts:34-42; app/api/buyer/shortlist/route.ts:6,62; prisma/schema.prisma:389-399.
- §32 `inventory_items` (S24) | PARTIAL → ALREADY CORRECT (app-level) | Both windows exist and gate eligibility on `lastSeenAt`: 7-day STALE flag and 30-day `SHORTLIST_FRESHNESS_WINDOW_MS` → `EXPIRED` → `REQUEST_SIMILAR` (not shortlist-eligible). The "30-day constant not verified" note is resolved. | lib/services/shortlist/shortlist-radius.ts:28,31,108-118; prisma/schema.prisma:991.
- Duplicates #6 (pickup QR writers) | DUPLICATED (unchanged) → **claim corrected** | Both writers use the SAME 48-hour TTL (`48 * 3600000` and `QR_TTL_MS = 48 * 60 * 60 * 1000`); the difference is only the base time (scheduledAt vs `Date.now()` on regenerate). | lib/services/pickup/pickup.service.ts:36,44,79; lib/services/pickup/pickup-coordination.service.ts:54,118.
- Out-of-scope RLS note | (unchanged) → **claim corrected** | "41 statements … targeting manual/affiliate tables" is inaccurate: 45 `ENABLE ROW LEVEL SECURITY` statements across migrations + manual SQL, and they DO cover several core Prisma transaction tables — `credit_applications`, `e_sign_envelope_history`, `financing_audit_events`, `financing_review_tasks`, `dealer_rooftops`, `dealer_account_claim_tokens`, `ai_action_intents`. The core claim (no RLS migration for deposits/deals/offers/contract_scans/financing/e_sign_envelopes/comms_outbox) stands. | grep across prisma/migrations + prisma/manual_supabase_sql; comms_outbox RLS → none.
- comms_outbox section | PARTIAL (unchanged) → **evidence confirmed/added** | Table absent from `prisma/MIGRATIONS.md` raw-table list (22 tables, L43-47) and from the drift gate's scope (script compares chain vs schema.prisma only). Retry `attempt*60s` L461, `MAX_COMMS_ATTEMPTS=4` L77, `RECLAIM_UNCERTAIN` L407, terminal `logger.error` L450 all confirmed. | prisma/manual_supabase_sql/comms_outbox.sql:22-55; prisma/MIGRATIONS.md:35-47; scripts/check-migration-drift.ts:1-30; lib/services/comms/comms-outbox.service.ts:77,407,450,461.
- UNVERIFIED list items "FK existence in SQL for EPAD.pre_approval_id and deal_status_history.deal_id" | UNVERIFIED → RESOLVED (both MISSING) | see the two rows above.

### Requirements in the governed sections not covered by the file

1. **§28.3 controls 1-8 individually** — only a single summary row (90). Per-control mapping is absent; this pass finds control 1 (authz inside the seam), 4 (state + history atomicity) and 6 (audit on crash) unmet at `advanceDealStatus` (deal.service.ts:148-175), and control 7 (durable comms) unverified for `emitDealStatusComms`.
2. **HTML `S[].tables` records not in the map** (all exist; existence only): `accepted_terms` (schema 2012), `compliance_events` (375), `shortlists` (386), `dealer_rooftops` (4039), `dealer_contact_profiles` (4257), `apollo_reveals` (4088), `dealer_verifications` (3489), `dealer_availability` (2894), `inventory_items` (1003), `financing_audit_events` (5720). The HTML also lists the six missing tables (`co_buyers`, `plan_snapshots`, `dealer_reaffirmations`, `deal_recaps`, `queue_items`, `post_completion_obligations`) as step tables — consistent with the MISSING rows.
3. **§4.6 "Every exception in Part D §26 writes here"** — the map does not enumerate which §26 exceptions today land in `PlatformAlert` vs `FinancingReviewTask` vs nothing (writers found: lib/services/identity/ofac.service.ts, lib/services/trust/anti-circumvention.service.ts, lib/services/monitoring/health-alert.service.ts → PlatformAlert; lib/services/financing/review-queue.service.ts:34-38 → FinancingReviewTask).
4. **§4.4 "auction-and-rooftop-bound link"** for registered dealers — `AuctionInvitation` has no token at all (518-531); the file covers `token_hash` (row 25) but not that registered-dealer invitations today have no link/token concept whatsoever (they are score-only rows).
5. **§4.1 L149 "no new fulfillment table is introduced"** — the file's row 1 covers convergence, but does not flag that `VehicleRequestOffer` (1155-1170) + `Deal.vehicleRequestOfferId` already constitute a parallel fulfillment lineage that bypasses `auctions`/`offers` entirely (Deal → VehicleRequestOffer → VehicleRequest with no auction/deposit); noted under duplicates only.
