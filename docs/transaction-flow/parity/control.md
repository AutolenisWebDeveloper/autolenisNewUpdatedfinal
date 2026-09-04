# Control planes parity map — §24 cancellation · §26 exception register · §27 communications · §28.3 transition controls · §29 safeguards

Repo: /home/user/autolenisNewUpdatedfinal (HEAD 0cd399f). All paths below are relative to `frontend/` unless prefixed. READ-ONLY static inspection; nothing executed. Every claim is `path:line` from running code.

## Summary (10 lines)

1. `comms_outbox` is real, tested, and drained every minute (`vercel.json:244-246`, `app/api/cron/comms-outbox-drain/route.ts:22`) — but it is **not the transactional rail**. Only 5 lifecycle senders (`deal-selected`, `offers-ready`, `dealer-offer-won/lost`, `no-winner`) plus the 5 pickup-negotiation notices route through it; **~90 transactional send sites** still use request-bound rails (`resend.service.sendIdempotent`, raw `new Resend()` in routes/services, QStash `/api/jobs/*` `notifyContact`, `sendCrmSms`). The spec's "zero production rows" is consistent with the code: only CRM campaign/nurture producers and those 10 senders enqueue.
2. The outbox lacks four §27 requirements: **no send-time state recheck**, **no cancellation** (no API sets a row to a cancelled state; `status` CHECK has no `cancelled` value — `prisma/manual_supabase_sql/comms_outbox.sql:28-29`), **no terminal-failure Operations alert** (only `logger.error`, `comms-outbox.service.ts:450`), and **no schema/Prisma model** (Supabase-managed table, owner-gated SQL).
3. `queue_items` does not exist. `QueueItemType`/`QueueItemStatus` enums are declared (`prisma/schema.prisma:1890-1907`) but **no model uses them**; the admin "queues" (`lib/services/admin/admin-queue.service.ts:7-39`) are **derived views** over PreQualification / ContractScan / Deal age / `Notification(type=SYSTEM_ALERT)`. There is no durable, owned, deadline-bearing exception record. Of 49 §26 rows: 0 ALREADY CORRECT, 21 PARTIAL, 1 BROKEN, 19 MISSING, 8 UNVERIFIED.
4. Operations alerting is **four parallel planes**: `Notification(type=SYSTEM_ALERT)` (dedup-by-title, 10+ writers), `PlatformAlert` via `createAlertOnce` (prequal/OFAC/circumvention/funnel), `FinancingReviewTask` (financing only), and Sentry via `pageOnCall/notifyOncall`. None carries owner / buyer-visible status / deadline / return point.
5. §28.3 seam is **real and strong** for Deal: legal-transition table + CAS + history + activity + idempotent comms + exactly-once completion event (`lib/services/deal/deal.service.ts:15-34, 148-151, 167-204`). Gaps: history/activity/comms are **outside the CAS transaction** and swallowed (`:176,:186`), the completion event is best-effort with no retry (`deal-completion-event.service.ts:52-54`), authorization is route-level only, and the comms it emits are **request-bound** (in-app + direct `sendCrmSms`).
6. Cancellation (§24) has **five uncoordinated paths**: `cancelDeal` (seam), admin `DEAL_CANCELLED` action (calls `advanceDealStatus(force)` directly, bypassing `cancelDeal`), admin `AUCTION_REFUND_TRIGGERED` (raw `auction.update`), admin `pauseBuyerWorkflow` (writes `AuctionStatus.CANCELLED` as a "pause"), and buyer `POST /requests/[id]/cancel` (raw update in the route). **None** voids envelopes, cancels pickups, revokes QR tokens, cancels `lifecycle_touch_schedule` / `comms_outbox` rows, or cancels `AuctionInvitation`s. `FROZEN_PENDING_RELEASE` is absent from `DealStatus`.
7. `emitDealStatusComms` claims its idempotency key **before** the SMS send and marks it `completed` regardless of SMS outcome (`acquisition-comms.ts:410-417, 468-478`) — a failed SMS is never retried. Preserve the dedup, fix the claim-then-lose.
8. Direct-rail defects to preserve-then-migrate: `sendIdempotent` never consults `email_suppression` (no `SuppressionService` import in `resend.service.ts`), has one attempt and no retry, and proceeds on a failed idempotency lookup (`resend.service.ts:145-149`); `vehicle-offers.email.ts` and `buyer-notifications.service.ts` have no idempotency at all; `app/api/dealer/pickup/scan/route.ts:126` and `app/api/cron/prequal-ibv-reminders/route.ts:95` call the Resend SDK inside routes.
9. §29: 14 of 19 safeguards VERIFIED in code, 4 PARTIAL (offer arithmetic is a warning not a rejection `offer-validation.service.ts:21`; anti-circumvention's `recordCircumventionAttempt` has zero callers; scorecard has no consequence inputs; "reprocess closed auctions" verified but "pickup emails durable" only for negotiation notices), 1 UNVERIFIED (Premium-fee duplicate-charge check is a Stripe search on `concierge-fee` — Premium as a product does not exist).
10. Required change, in priority order: (a) a `queue_items`-backed exception service extending the existing admin-queue reads; (b) route every §27.1 notice through `enqueueTransactionalEmail`/`enqueueSms` with a state-recheck hook, cancel semantics, and a terminal-failure alert; (c) one `cancelTransaction` orchestrator that calls `cancelDeal`, `voidEnvelopeInternal`, `cancelInvitation`, `cancelDepositReminderTouches`, outbox-cancel, and pickup/QR revocation; (d) add `FROZEN_PENDING_RELEASE` to `DealStatus` + `TRANSITIONS`.

---

## Deliverable 3 — `comms_outbox` as it exists today

**Table (Supabase-managed, not in Prisma)** — `prisma/manual_supabase_sql/comms_outbox.sql:22-55`:
`id uuid PK` · `channel text CHECK IN ('email','sms')` · `dedup_key text NOT NULL` (UNIQUE `uq_comms_outbox_dedup_key`, :50) · `status text DEFAULT 'pending' CHECK IN ('pending','sending','sent','failed','suppressed','skipped')` (:28-29) · `payload jsonb` · `attempts int DEFAULT 0` · `last_error text` · `last_result text` · `provider_id text` · `run_at timestamptz` (delay) · `claimed_at timestamptz` · `dispatched_at timestamptz` (stamped immediately before provider call, :39-44) · `created_at` · `updated_at`. Partial index `idx_comms_outbox_drain ON (run_at) WHERE status IN ('pending','sending')` (:53-55). Header says "PRODUCTION CUTOVER REQUIRES applying this SQL — OWNER-GATED" (:3-6) → whether the table exists in production is **UNVERIFIED** (no DB access).

**Service API** — `lib/services/comms/comms-outbox.service.ts`:
- `enqueueEmail(payload: EmailOutboxPayload, opts?: {runAt, supabase})` (:96-103) → dedup key = `payload.idempotencyKey || "${contactId ?? email}:email_send:${YYYY-MM-DD}"` (:100-101). `enqueueSms` (:105-114) same with `:sms_send:`. Insert is `upsert(..., {onConflict:'dedup_key', ignoreDuplicates:true})` → ON CONFLICT DO NOTHING (:125-137); returns `{enqueued, dedupKey}`. Payload types: `EmailOutboxPayload` (:32-44: contactId?, email, subject?, html?, text?, templateId?, templateVariables?, campaignId?, campaignRecipientId?, type 'transactional'|'marketing', idempotencyKey?), `SmsOutboxPayload` (:46-53).
- `enqueueTransactionalEmail({to, subject, html, text?, templateId, idempotencyKey})` — `lib/services/email/transactional-dispatch.ts:28-38` — wraps `enqueueEmail` with `type:'transactional'` and no contactId.
- Claim: `processOutboxRow` (:354-468) — CAS `update status='sending', claimed_at WHERE id AND status='pending'` (:369-374); crash-recovery reclaim `WHERE status='sending' AND claimed_at < now-10min` (:379-390, `STALE_MS` :78). Reclaimed row with `dispatched_at` set → terminal `failed`/`RECLAIM_UNCERTAIN`, never re-sent (:402-414).
- Delivery: `deliverEmail` (:160-289) — transactional precheck `transactionalEmailAlreadySent` (EmailSendLog SENT only, `email-send-log.ts:23-29`) → `DUPLICATE`; contact DNC → `GATED`; transactional honours **hard** suppression only, marketing honours soft (:181-185); marketing consent gate (:187-189); template render via `TemplateService` or direct subject/html (:193-207); `onDispatch` stamps `dispatched_at` (:211); Resend send with provider idempotency key (`comms-providers.ts:38-52`); provider error → EmailSendLog FAILED then **throw** (retry) (:225-242); post-send bookkeeping best-effort never throws (:244-286). `deliverSms` (:291-331) — TCPA hard gate (`consent_sms && !do_not_contact`, :302-304), `sms_suppression` check (:306), Twilio send appends "Reply STOP to opt out." (`comms-providers.ts:58`).
- Attempts/backoff: `MAX_COMMS_ATTEMPTS = 4` (:77); retry re-queues `status='pending', run_at = now + attempt*60s` (linear, :455-464); at max → `status='failed', last_result='FAILED'` columns-only, **no `jobs_dead_letter`, no alert beyond `logger.error`** (:444-451).
- Terminal outcome map (:67-75): SUCCESS→`sent`; SUPPRESSED→`suppressed`; GATED/CONSENT_GATED/TCPA_GATED/INVALID_PHONE/DUPLICATE→`skipped`.
- Drain: `drainCommsOutbox(batch=100)` (:470-514) selects due `pending|sending` rows oldest-first and processes serially; per-row errors counted as `skipped`, batch never aborts.
- **Cancellation: none.** No function sets a row to a cancelled/void state, and the status CHECK does not admit one. **Send-time state recheck: none** — payload is sent as enqueued. **Quiet hours: not applied** (only `sendCrmSms` applies quiet hours; the outbox SMS path does not).
- Cron: `app/api/cron/comms-outbox-drain/route.ts` — `authorizeCronRequest` (:19), `withCronRun("comms-outbox-drain")` (:22), `maxDuration=300` (:16), schedule `* * * * *` (`vercel.json:244-246`).
- Tests: `lib/services/comms/__tests__/comms-outbox-queue.test.ts` (11 cases: dedup, claim CAS, RECLAIM_UNCERTAIN, safe re-delivery, lost claim, gated terminal, retry backoff, terminal failed columns-only, NO_PENDING), `comms-delivery.test.ts` (15 gate/happy-path cases), `app/api/cron/__tests__/comms-outbox-drain-route.test.ts` (auth/500), `lib/services/email/__tests__/sender-migration.test.ts` (5 parity-key cases). Not executed this session.

**Everything that enqueues today** (non-test callers of `enqueueEmail`/`enqueueSms`/`enqueueTransactionalEmail`):
| Producer | Path | Transactional? |
|---|---|---|
| `sendDealSelectedEmail` | `lib/services/email/resend.service.ts:735` | yes — key `deal-selected-${dealId}` |
| `sendOffersReadyEmail` | `resend.service.ts:432` | yes — `offers-ready-${auctionId}` |
| `sendDealerOfferWonEmail` | `resend.service.ts:1653` | yes — `dealer-offer-won-${dealId}` |
| `sendDealerOfferLostEmail` | `resend.service.ts:1665` | yes |
| `sendDealerAuctionClosedNoWinnerEmail` | `resend.service.ts:1677` | yes |
| Pickup negotiation: `notifyDealerProposed`, `notifyBuyerCountered`, `notifyDealerConfirmed`, `notifyDealerProposalReminder`, `notifyBuyerCounterReminder` | `lib/services/pickup/pickup-notifications.service.ts:105,142,177,215,253` | yes — round-specific keys `pickup-proposed-${dealId}-${roundKey}` etc. (:117,151,189,228,262) |
| Admin CRM single sends | `app/api/admin/crm/contacts/[id]/send-email/route.ts:67`, `send-sms/route.ts:63` | marketing/CRM |
| CRM bulk campaign | `app/api/admin/crm/campaigns/bulk-send/route.ts:100,123`; `lib/services/campaign/campaign-dispatch.service.ts:151,168` | marketing |
| LP lead nurture | `lib/services/crm/lead-nurture.service.ts:202`; `lib/services/email/lead-magnet-sequence.ts:67`; `nurture-sequence.ts:59` | marketing |
| Kill-switched in-app workflow engine | `lib/services/workflow.engine.ts:313,331,427` | marketing (off by default) |
| DLQ re-drive of legacy `autolenis/email.send` / `sms.send` | `lib/services/operations.service.ts:43-52` | replay only |

No buyer-journey, prequal, deposit, auction-invitation, contract, e-sign (other than pickup), financing, or cancellation notice enqueues into the outbox.

---

## Deliverable 1 — Inventory of direct transactional sends NOT via `comms_outbox` (reachable from transaction code)

Rails: **R1** = `resend.service.sendIdempotent` (EmailSendLog dedup, one attempt, no suppression check, `resend.service.ts:129-226`); **R2** = raw `new Resend().emails.send` in the file; **R3** = QStash `lib/qstash/notify.ts notifyContact` (suppression + TCPA gated, no EmailSendLog idempotency, `notify.ts:103-175`); **R4** = `lifecycle_touch_schedule` drain → `notifyContact` (`lifecycle-touch-drain.service.ts:40`); **R5** = `sendCrmSms` (TCPA/suppression/quiet-hours); **IA** = in-app `Notification` only. "Request-bound" = the send happens inside the HTTP request (or its `after()`), so a request death loses it.

| # | Path:line | Channel/rail | Template / subject key | Trigger | Request-bound |
|---|---|---|---|---|---|
| 1 | `app/api/webhooks/stripe/route.ts:287` | email R1 | `deposit-confirmed-${depositId}` | payment_intent.succeeded (deposit) | webhook-bound (Stripe retries only if 5xx; send failure swallowed) |
| 2 | `app/api/webhooks/stripe/route.ts:293` | email R1 | `auction-activated-${auctionId}` | deposit → auction launch | webhook-bound |
| 3 | `app/api/webhooks/stripe/route.ts:439` | email R1 | `deposit-confirmed-*` (second path) | deposit succeeded (alt branch) | webhook-bound |
| 4 | `app/api/webhooks/stripe/route.ts:537` | email R1 | `concierge-fee-confirmed-${pi}` | fee PI succeeded | webhook-bound |
| 5 | `app/api/webhooks/stripe/route.ts:685,754` | email R1 | `refund-confirmed-${refundId}` | charge.refunded | webhook-bound |
| 6 | `app/api/buyer/auctions/[auctionId]/select-offer/route.ts:114` | email → **outbox** | `deal-selected-${dealId}` | buyer selects offer | durable (enqueue only) |
| 7 | `app/api/buyer/requests/[requestId]/offer/respond/route.ts:138` | email → outbox | `deal-selected-*` | concierge offer accepted | durable |
| 8 | `lib/services/offer/offer.service.ts:156-180` | email R2 via `buyer-notifications.service.ts:60` | first-offer-received | first SUBMITTED offer | `after()` — request-bound, **no idempotency key** |
| 9 | `lib/services/acquisition/intake-pipeline.service.ts:513` | email R2 (`buyer-notifications.service.ts`) | dealers-contacted | intake outreach done | request/cron-bound, no key |
| 10 | `lib/services/acquisition/intake-pipeline.service.ts:303,314` | email R1 | `buyer-opp-confirmation-*`, `founder-hot-lead-*` | intake | bound |
| 11 | `lib/services/auction/dealer-invitation.service.ts:390` | email R1 | `dealer-auction-invitation-${auctionId}-${to}` | invite dealers | bound (plus IA :379) |
| 12 | `app/api/admin/buyers/[buyerId]/launch-auction/route.ts:281,298,315` | email R1 | dealer invitation ×2 paths, `auction-activated-*` | admin launch | request-bound |
| 13 | `app/api/admin/auctions/[auctionId]/action/route.ts:140` | email R1 | dealer invitation | admin DEALER_INVITED | request-bound |
| 14 | `app/api/admin/buyers/[buyerId]/invite-outside-dealers/route.ts:70` | email R1 | dealer invitation | outside dealer invite | request-bound |
| 15 | `app/api/cron/dealer-invitation-reminder/route.ts:100` | email R1 | `dealer-auction-reminder-${auctionId}-${to}` | cron | cron-bound |
| 16 | `app/api/cron/auction-close/route.ts:76,93` | email R1 | reminder + `dealer-offer-revision-closing-${offerId}` | cron | cron-bound |
| 17 | `lib/services/auction/auction.service.ts:161` | email → outbox | `offers-ready-${auctionId}` | processAuctionClose | durable |
| 18 | `lib/services/auction/auction.service.ts:192` | email → outbox | no-winner | processAuctionClose | durable |
| 19 | `lib/services/notifications/dealer-award.ts:272,289,312` | email → outbox + IA | won/lost | `dealer-award-dispatch` cron (`deal-award-dispatch.service.ts`) | durable (marker `dealerAwardDispatchedAt`) |
| 20 | `app/api/dealer/offers/route.ts:59`, `[offerId]/revise/route.ts:64` | email R1 | `dealer-offer-submitted-${offerId}` | dealer submits/revises | request-bound |
| 21 | `lib/services/prequal/prequal.service.ts:599,651,703,749` | email R1 | `prequal-approved-*`, adverse-action, `prequal-under-review-*`, `admin-prequal-*` | prequal decision | request-bound (adverse-action outcome persisted as compliance event) |
| 22 | `lib/services/prequal/admin-prequal.service.ts:596,647,707,738` | email R1 | same four | admin prequal decision | request-bound (**second implementation of the prequal notice set**) |
| 23 | `app/api/admin/buyers/[buyerId]/prequal/manual-override/route.ts:152,201`; `prequal/resend-email/route.ts:70,82`; `app/api/admin/compliance/ofac/[prequalId]/route.ts:107` | email R1 | approved / adverse | admin | request-bound |
| 24 | `app/api/cron/prequal-ibv-reminders/route.ts:95` | email **R2 in a cron route** | prequal expiry warning (no key; dedup via Notification lookup) | cron | cron-bound; violates adapter rule |
| 25 | `lib/services/contract-shield/contract-shield.service.ts:368,370` | email R1 | `contract-approved-${dealId}`, `contract-shield-alert-${dealId}` | scan result | bound |
| 26 | `app/api/admin/contract-shield/[reviewId]/route.ts:131,178,182,221` | email R1 | contract approved / shield alert / `dealer-contract-issues-${dealId}-${Date.now()}` (**non-idempotent key**) | admin review | request-bound |
| 27 | `app/api/admin/deals/[dealId]/action/route.ts:91,116,153` | email R1 | `dealer-contract-pending-${dealId}`, `deal-complete-${dealId}`, contract issues | admin stage advance / complete / override | request-bound |
| 28 | `app/api/admin/deals/[dealId]/esign/route.ts:70` | email R1 | `dealer-esign-initiated-${dealId}` | admin esign | request-bound |
| 29 | `lib/services/esign/buyer-signing.service.ts:881` | email R1 | `contract-signed-${envelopeId}` | `finalizeSignedContract` (runs in `after()`, `app/api/buyer/esign/[dealId]/sign/route.ts:78`) | after()-bound; recovered by `esign-artifact-reconcile` cron (UNVERIFIED that reconcile re-sends) |
| 30 | `app/api/admin/deals/[dealId]/pickup/schedule/route.ts:100,108` | email R1 | `pickup-ready-${to}-${date}`, `dealer-pickup-scheduled-${dealId}` | admin schedule | request-bound |
| 31 | `app/api/admin/deals/[dealId]/pickup/complete/route.ts:99,125,134` | email R1 | `deal-complete-*`, `dealer-pickup-completed-*`, `dealer-payout-initiated-*` | admin complete | request-bound |
| 32 | `app/api/dealer/pickup/scan/route.ts:126` | email **R2 in route**, no key | "Congratulations — your AutoLenis deal is complete" | dealer QR scan completes deal | request-bound, fire-and-forget `.catch(()=>{})` |
| 33 | `app/api/admin/payments/deposit/send-link/route.ts:99`, `concierge-fee/send-link/route.ts:100` | email R1 | `deposit-payment-link-${depositId}`, `concierge-fee-payment-link-${dealId}` | admin manual | request-bound |
| 34 | `app/api/admin/buyers/[buyerId]/deposit/override/route.ts:108` | email R1 | deposit confirmed | admin override | request-bound |
| 35 | `app/api/admin/buyers/[buyerId]/invite/route.ts:40,52` | email R1 + **R2** | admin-created buyer | admin | request-bound |
| 36 | `app/api/public/request-vehicle/route.ts:623,656,663` & `complete/route.ts:220-221` | email R2 (`vehicle-offers.email.ts`, no idempotency) + R1 (`request-received-${requestId}`) | admin notification, buyer confirmation ×2 | public vehicle request | `after()`-bound; **buyer receives two confirmations from two rails** |
| 37 | `app/api/admin/vehicle-requests/[id]/send-to-dealers/route.ts:79`; `vehicle-offers/[id]/{submit-offer:120,send-to-buyer:113+125,reject-submission:44}`; `app/api/public/dealer-offer/[token]/route.ts:248,260`; `outside-dealer-offer/[token]/route.ts:167`; `admin/offers/route.ts:238`; `buyer-offer-review/[reviewToken]/question/route.ts:57` | email R2 (`vehicle-offers.email.ts:21-32`) | concierge-track invitations/offers | concierge track | request-bound, no idempotency, no suppression |
| 38 | `lib/services/agreement/dealer-agreement.service.ts:159` → `dealer-agreement-confirmation.service.ts:103` | email R2 | dealer agreement confirmation | dealer signs | `after()`-bound |
| 39 | `lib/services/acquisition/dealer-opportunity-notification.service.ts:67` | email R1 | `dealer-new-buyer-opportunity-*` | intake outreach | bound |
| 40 | `lib/services/acquisition/post-intake-outreach.service.ts:274` | email via `dealer-recruitment/dealer-email-send.service.ts:241` R2 | dealer outreach | intake | bound |
| 41 | `app/api/jobs/{auction-active,auction-closing,auction-midpoint,offer-received,offer-follow-up,deal-complete,dealer-invited,dealer-bid-reminder,deposit-reminder,form-submitted,check-form-completion,review-request,referral-nudge,refinance-outreach,affiliate-*}/route.ts` | email+SMS R3 | per-workload bodies | QStash delayed jobs scheduled by `lib/services/crm/lifecycle-scheduler.ts` (flag OFF default) | durable via QStash, **no EmailSendLog idempotency**, separate plane from outbox |
| 42 | `lib/services/crm/lifecycle-touch-drain.service.ts` (cron `lifecycle-touch-drain`) | email+SMS R4 | deposit_reminder_1..6, form_submitted, check_form_completion_1..3, auction/dealer/offer/deal_complete sequences | flag ON per workload | durable (UNIQUE(base_key,sequence)), **second durable outbox** |
| 43 | `lib/services/notifications/acquisition-comms.ts:560` | SMS R5 + IA | per-DealStatus plan (`dealStatusCommsPlan`) | every `advanceDealStatus` | request-bound; SMS off unless `ACQUISITION_COMMS_SMS_ENABLED` (:342) |
| 44 | `app/api/admin/auctions/[auctionId]/action/route.ts:176-207` | IA only | "Auction cancelled" buyer + dealers | admin cancel | request-bound |
| 45 | `app/api/admin/deals/[dealId]/action/route.ts:193-215,245-254` | IA only | cancelled / refunded | admin | request-bound |
| 46 | `app/api/cron/morning-briefing/route.ts:39`, `app/api/twilio/voice/status/route.ts:68,181`, `app/api/public/{feedback,contact}/route.ts`, `app/api/admin/auth/setup-mfa/send-email/route.ts:167`, `app/api/admin/dealer-outreach/compose/route.ts:187` | email R2 | ops/voice/public/MFA | — | out of transaction scope but same anti-pattern |
| 47 | `lib/services/acquisition/twilio.service.ts:45`, `lib/services/sms/twilio.service.ts:33` (callers: `lib/voice/transactional-sms.ts:33`, `lib/social/sms-distribution.service.ts:56,84`), `lib/voice/dispatch-request.ts:376`, `lib/services/dealer-recruitment/dealer-sms-wiring.ts:115`, `app/api/admin/crm/conversations/[id]/reply/route.ts:103` | SMS raw Twilio | voice/social/outreach | — | request-bound; `twilio.service.sendSms` applies **no** consent/suppression gate (`sms/twilio.service.ts:25-39`) |

---

## Rows — §24 Cancellation (spec lines 1211-1218)

| spec_ref | requirement | status | current | evidence | stronger safeguard | required change | legacy path | notes |
|---|---|---|---|---|---|---|---|---|
| §24 L1213 "authorized actor" | Cancellation requires an authorized actor | PARTIAL | Authorization is route-level: admin routes via `requireAdmin`, buyer request cancel via `getRequestBuyer`. `cancelDeal` itself takes an unchecked `actor` | `lib/services/deal/deal.service.ts:377-381`; `app/api/buyer/requests/[requestId]/cancel/route.ts:11-12`; `lib/services/admin/admin-buyer-command-center.service.ts:927-975` | — | Orchestrator takes `actor:{id,role}` and asserts role∈{ADMIN,SYSTEM,BUYER-owner} inside the service | admin `workflow/cancel`, `deals/[id]/action`, `auctions/[id]/action`, buyer `requests/[id]/cancel` | Dealer cancellation path: none found |
| §24 L1213 "required reason" | Reason is mandatory | PARTIAL | `cancelDeal(dealId, reason)` requires a string; admin action passes `reason`; buyer request cancel records **no reason** (`vehicleRequestEvent` without reason) | `deal.service.ts:378-379`; `requests/[requestId]/cancel/route.ts:27-32` | `CancellationReason` enum exists (`schema.prisma:1921-1927`) but is unused by these paths | Make `reason: CancellationReason + note` mandatory on every path | buyer request cancel | — |
| §24 L1213 "current stage recorded" | Stage at cancellation is persisted | ALREADY CORRECT (deal) / PARTIAL (others) | `DealStatusHistory.fromStatus` written by seam; auction/request cancels record no prior stage (auction: none; request: event only) | `deal.service.ts:167-176`; `auctions/[auctionId]/action/route.ts:176`; `requests/[requestId]/cancel/route.ts:28-31` | history write is `.catch(()=>{})` — a failed history write is silent | Write prior stage for auction/request cancels; make history part of the CAS transaction | — | — |
| §24 L1213 "unsent sourcing and outreach stopped" | Cancellation stops pending sourcing/outreach | MISSING | No cancel path calls `cancelDepositReminderTouches`/`cancelPreCheckoutTouches` (only deposit webhook and create-intent do) and nothing cancels `comms_outbox` rows or QStash jobs; intake pipeline not halted on cancel | `lifecycle-touch-drain.service.ts:599-660` callers: `app/api/webhooks/stripe/route.ts:252`, `app/api/buyer/deposit/create-intent/route.ts:277` only; outbox has no cancel API (`comms-outbox.service.ts`) | Drain-time guards `depositConversionResolved`/`preCheckoutResolved` exist (`lifecycle-touch-drain.service.ts:41`) — send-time state recheck on that plane | Orchestrator cancels lifecycle touches by base_key, marks outbox rows `cancelled` (new status), and flags VehicleRequest so intake `applyRequestCoverageGate`/outreach stages skip | — | — |
| §24 L1213 "auction activity closed" | Auction closed on cancel | PARTIAL | Admin auction cancel writes `auction.status='CANCELLED'` unconditionally (no CAS, no invitations cancelled); `cancelDeal` does nothing to the auction | `auctions/[auctionId]/action/route.ts:176`; `deal.service.ts:377-402` | — | Orchestrator closes auction via CAS and marks `AuctionInvitation`s cancelled | admin auction action | `pauseBuyerWorkflow` misuses `CANCELLED` as pause (`admin-buyer-command-center.service.ts:877`) |
| §24 L1213 "affected dealerships notified" | Dealers notified | PARTIAL | Only admin auction cancel notifies dealers, in-app only (`type:'AUCTION_STARTED'` mislabel) | `auctions/[auctionId]/action/route.ts:193-207` | — | Durable email + in-app to winning/invited dealers from orchestrator via outbox | — | Deal cancel never tells the winning dealer |
| §24 L1213 "unsigned envelopes voided" | Envelopes voided | MISSING (as part of cancel) | `voidEnvelope` (admin route only) and `voidEnvelopeInternal` exist but no cancel path calls them | `lib/services/esign/esign.service.ts:56-64`; `buyer-signing.service.ts:546`; caller only `app/api/admin/deals/[dealId]/esign/void/route.ts:41` | CAS void (`esign.service.ts:60-63`); terminal records immutable | Orchestrator calls `voidEnvelopeInternal(dealId,'cancelled:'+reason)` | — | DUPLICATED: two void functions |
| §24 L1213 "pickup cancelled and release tokens revoked" | Pickup cancelled, QR revoked | MISSING | `PickupStatus` has no CANCELLED; no cancel path touches `Pickup`; `regenerateQr` exists but is not a revoke-on-cancel | `schema.prisma:1583-1593`; `lib/services/pickup/pickup.service.ts:67` | — | Add `PickupStatus.CANCELLED`, revoke QR (null `qrCode`) in orchestrator | — | — |
| §24 L1213 "payment treatment determined" | Refund decision made explicitly | PARTIAL | Admin deal/auction cancel refunds via `refundDepositCharge` **before** the status transition; `cancelDeal` decides nothing; buyer request cancel decides nothing | `deals/[dealId]/action/route.ts:177-190`; `auctions/[auctionId]/action/route.ts:165-176`; `refund.service.ts:23-44` | `NO_CHARGE` never reported as refunded (:27-28); idempotency key `refund-deposit-${id}` (:31) | Orchestrator records `paymentTreatment` (retain/refund/review) and performs refund after the CAS | — | Money moves before state flips — a failed flip leaves refunded-but-live deal |
| §24 L1213 "buyer notified" | Buyer notified | PARTIAL | Deal cancel: in-app owned by admin route (`INAPP_OWNED_BY_CALLERS`), SMS via `emitDealStatusComms` (flag-gated); `cancelDeal` from `cancelBuyerWorkflow` yields **no in-app** (orchestrator skips CANCELLED in-app, and that caller writes none); buyer request cancel sends nothing | `acquisition-comms.ts:238-246,295-308`; `admin-buyer-command-center.service.ts:927-975` | — | Durable cancellation email + in-app from orchestrator | — | Email for cancellation: none anywhere |
| §24 L1213 "full history preserved" | History preserved | ALREADY CORRECT (deal) | `DealStatusHistory` + `BuyerActivityEvent DEAL_CANCELLED` + `adminAuditLog` | `deal.service.ts:167-186,398-400`; `admin-buyer-command-center.service.ts:962-974` | Declined cancel reported honestly (`cancelled:false`) | — | — | — |
| §24 L1215 "[NEW] one cancellation orchestration" | Single orchestrator | MISSING | Five independent paths (see Deliverable 5) | as above | `cancelDeal` is the correct seam to build on | New `lib/services/deal/cancel-transaction.service.ts` composing existing functions; route all five paths through it | all five | Also route admin `DEAL_CANCELLED` through `cancelDeal` instead of `advanceDealStatus(force)` (`deals/[dealId]/action/route.ts:190`) |
| §24 L1217 `FROZEN_PENDING_RELEASE` | Post-execution coordination state | MISSING | Enum value absent; `cancelDeal` uses `force:true` so it can cancel from any non-terminal state including SIGNED | `schema.prisma:1513-1530`; `deal.service.ts:385-391` | — | Add enum value + `TRANSITIONS` entries (SIGNED/DEALER_EXECUTED→FROZEN_PENDING_RELEASE→COMPLETED/CANCELLED); block `cancelDeal` after execution | — | Requires migration; `canTransition` test must fail first |

## Rows — §26 Exception register (spec lines 1233-1287; HTML EXC 865-914)

Header rule L1235 "Every exception names an owner, buyer-visible status, required action, deadline, return point; all written to `queue_items`" → **MISSING**: no `queue_items` table/model; enums `QueueItemType`/`QueueItemStatus` (`schema.prisma:1890-1907`; created in `prisma/migrations/20260423180146_complete_schema/migration.sql:86,89`) are unused by any model; admin queues are derived reads (`lib/services/admin/admin-queue.service.ts:7-39`) with resolve-by-audit-log (:41-107). Required change: `model QueueItem { type QueueItemType; status QueueItemStatus; owner; buyerVisibleStatus; requiredAction; deadline; returnPoint; entity refs }` + `lib/services/operations/exception.service.ts` `raiseException()` idempotent on `(type, entityId, open)`; migrate the 8 derived queues onto it.

| # | Exception (spec L) | status | current / owner today | evidence | stronger safeguard | required change |
|---|---|---|---|---|---|---|
| 1 | Buyer does not verify (L1239) | MISSING | No 1h/24h/72h reminder job; `app/api/cron/` has no verification-reminder; resend is user-initiated | `ls app/api/cron` (no match); `app/api/auth/resend-verification/route.ts:154` | — | Add `verification_reminder_1..3` lifecycle sequence + abandon at 72h; queue row owner=System |
| 2 | Onboarding location unusable (L1240) | MISSING | No production write path for buyer city/state/zip; matcher fails closed at 0 invitations; no correction task | `docs/plans/BUYER-LOCATION-GAP.md:14-31` (code refs `dealer-invitation.service.ts:199-210`) | Matcher fail-closed is correct — keep | Capture location at onboarding/prequal write-back; raise `LOCATION_UNUSABLE` queue item, block sourcing stages |
| 3 | Prequal manual/OFAC review (L1241) | PARTIAL | Derived queues `PREQUAL_MANUAL`/`OFAC_ALERT` over `PreQualification.decision`; OFAC also `PlatformAlert P0` + `SYSTEM_ALERT`; `prequal-sla-escalation` cron raises SYSTEM_ALERT after ageing | `admin-queue.service.ts:9,11`; `lib/services/identity/ofac.service.ts:4-11`; `app/api/cron/prequal-sla-escalation/route.ts:25-58` | Resolve requires explicit CLEAR/CONFIRM / APPROVE/DECLINE (`admin-queue.service.ts:44-83`) — keep | Back with queue_items row owner=Compliance, deadline from SLA |
| 4 | Provider delay (L1242) | PARTIAL | Held at MANUAL_REVIEW (fail-closed) + `createAlertOnce` P0/P1 PlatformAlert; buyer under-review email; automatic retry UNVERIFIED | `prequal.service.ts:103-121, 703` | fail-closed hold | Retry job + honest processing notice via outbox; queue row owner=System |
| 5 | Prequal decline (L1243) | PARTIAL | Adverse-action email with SENT/DUPLICATE/FAILED/DEV_SKIPPED/THREW outcome persisted; no queue row | `prequal.service.ts:640-670` | outcome discrimination (§29) — keep | Queue row owner=Compliance only on FAILED/THREW outcome |
| 6 | Approval expires mid-transaction (L1244) | PARTIAL | `isPrequalValid` gates new pulls; `prequal-stale-cleanup` only counts; no deal pause on expiry; `prequal-ibv-reminders` warns by raw Resend | `prequal.service.ts:130-165`; `app/api/cron/prequal-stale-cleanup/route.ts:24`; `prequal-ibv-reminders/route.ts:85-105` | — | Expiry check inside `advanceDealStatus` validation step; queue row owner=Buyer/Ops |
| 7 | Payment failure (L1245) | UNVERIFIED | `payment_intent.payment_failed` branch exists (`stripe/route.ts:613`) — body not read this session | `app/api/webhooks/stripe/route.ts:613` | — | Verify request preserved + retry path; emit "Payment failed" via outbox |
| 8 | Payment succeeded, webhook missed (L1246) | PARTIAL | `deposit-activation-reconcile` cron + `deposit-settlement.service` raise deduped `SYSTEM_ALERT` Notifications | `app/api/cron/deposit-activation-reconcile/route.ts` (imports); `lib/services/payment/deposit-settlement.service.ts:104-125`; `lib/services/auction/deposit-activation.service.ts:70-86` | reconciler sweeps by STATE not window (:36-38) — keep | Queue row owner=Finance with Stripe reference |
| 9 | Payment unroutable (L1247) | PARTIAL | Webhook accepts, changes no state, raises deduped `SYSTEM_ALERT` Notification | `stripe/route.ts:33-54, 606` | never absorbed — keep | Queue row owner=Finance |
| 10 | Disputed/refunded (L1248) | PARTIAL | `charge.dispute.created` → `adminAuditLog` only; `charge.refunded` → deposit/fee flips + commission SYSTEM_ALERT; **no fulfillment hold, no outreach stop** | `stripe/route.ts:643-760, 769-800` | — | On dispute: mark Deposit DISPUTED (state matrix), cancel lifecycle touches/outbox, queue row owner=Finance |
| 11 | No coverage at 250 mi (L1249) | PARTIAL | Coverage gate parks request with reason tag; `coverage-hold-reconcile` cron re-checks; no buyer radius-authorization request, no 24h/72h reminders, no 14-day close | `lib/services/acquisition/request-coverage-gate.service.ts:102-190, 211`; `app/api/cron/coverage-hold-reconcile/route.ts` | — | Buyer authorization comms (outbox), reminder sequence, 14-day close job, queue row owner=Buyer/Ops |
| 12 | Zero dealer coverage (L1250) | PARTIAL | deposit-activation closes a no-dealer auction (deposit retained); intake reports `zeroSupply` | `deposit-activation.service.ts:33-41`; `intake-pipeline.service.ts:86-87` | never auto-refunds — keep | Queue row owner=Ops before auto-close |
| 13 | Invitation bounced (L1251) | PARTIAL | Resend webhook suppresses email + pauses dealer-prospect sequence; auction `AuctionInvitation` not marked bounced; no replacement task | `app/api/webhooks/resend/route.ts:102-107, 188-189` | suppression on bounce — keep | Map bounce → invitation row + queue row owner=Ops |
| 14 | Zero offers (L1252) | PARTIAL | `processAuctionClose` (atomic claim) emits buyer/dealer no-offer notices; admin `AUCTION_REOPENED` allows relaunch without a second $99; no owned case | `auction.service.ts:31-50, 161-192`; `auctions/[auctionId]/action/route.ts` (`AUCTION_REOPENED`) | deposit retained, one relaunch path exists | Queue row owner=Ops on zero-offer close |
| 15 | Shortlisted candidate stale/sold mid-auction (L1253) | UNVERIFIED | No candidate-drop path located in `lib/services/auction/*`; inventory staleness is catalogue-level (`inventory-stale-sweep`) | — | — | Verify with inventory owner; likely MISSING |
| 16 | No in-radius inventory (L1254) | UNVERIFIED | Out of control-plane scope (inventory/buyer UI) | — | — | Defer to inventory area |
| 17 | Provider budget ceiling (L1255) | PARTIAL | `inventory-budget-alert.service` raises deduped SYSTEM_ALERT at WARNING and EXHAUSTED | `lib/services/inventory/inventory-budget-alert.service.ts:95-120` | alerts before ceiling — keep | Queue row owner=Ops |
| 18 | Sweep returns fewer listings (L1256) | UNVERIFIED | Out of scope | — | — | Defer to inventory area |
| 19 | No stored location on inventory page (L1257) | UNVERIFIED | Out of scope | — | — | Defer |
| 20 | All offers exceed budget (L1258) | PARTIAL | Over-budget offers are **rejected at submission** (`otd > maxOtdAmountCents`), so the state cannot arise; no recovery routing | `lib/services/offer/offer.service.ts:47-52, 77` | server-side budget rejection — keep | Queue row when 0 in-budget offers at close |
| 21 | Buyer does not select (L1259) | PARTIAL | `runNudgeEngine` in-app nudges (workflow-automation cron); offers expiry/revalidate/close UNVERIFIED | `lib/services/nudge/nudge.service.ts:49-160`; `app/api/cron/workflow-automation/route.ts:7` | — | Expiry job + reminder via outbox + queue row |
| 22 | Winning dealer rejects/times out (L1260) | MISSING | No reaffirmation/confirmation state (`DealStatus` has no DEALER_CONFIRMATION) | `schema.prisma:1513-1530` | — | New state + timeout job + return-to-offers + scorecard entry |
| 23 | Dealer changes material terms (L1261) | PARTIAL | Pre-close revisions via `offer-revision.service`; post-selection material-change flow absent | `lib/services/offer/offer-revision.service.ts` | above-budget refused at submission | Material-change proposal model + side-by-side accept/reject |
| 24 | Vehicle hold expires (L1262) | MISSING | `holds` cron is a no-op; no hold model | `app/api/cron/holds/route.ts:1-20` | — | Hold entity + expiry job |
| 25 | Vehicle sold before contract/pickup (L1263) | MISSING | No path found | — | — | Return-to-offers path |
| 26 | Outside winner fails verification (L1264) | UNVERIFIED | `outside-invite.service.ts`, `dealer-verification.service.ts` exist; block-advancement wiring not traced | `lib/services/auction/outside-invite.service.ts`; `lib/services/dealer/dealer-verification.service.ts` | — | Trace and gate `advanceDealStatus` on dealer verified |
| 27 | Recap disputed (L1265) | MISSING | No recap entity/state | — | — | Recap version model |
| 28 | Financing fails/expires (L1266) | PARTIAL | `routeToReview` writes durable `FinancingReviewTask` (LENDER_FAILURE/STIP/ADVERSE/MANUAL); no buyer return-path comms; no auto-cancel (correct) | `lib/services/financing/financing-orchestrator.service.ts:69,156,167,176`; `review-queue.service.ts:34-45`; `schema.prisma:5797-5817` | idempotent routing (`openWhere`) — keep | Fold FinancingReviewTask into queue_items or link; buyer alternative-path comms |
| 29 | Funding not cleared (L1267) | MISSING | No FUNDING state | `schema.prisma:1513-1530` | — | Add state + block release |
| 30 | Trade payoff stale (L1268) | UNVERIFIED | trade-in not traced | — | — | — |
| 31 | Insurance rejected/expired (L1269) | MISSING | `InsuranceStatus` has no REJECTED/EXPIRED; `FAILED` exists, no writer found; `INSURANCE_EXCEPTION` queue = deals 72h in INSURANCE_PENDING | `schema.prisma:1493-1502`; `admin-queue.service.ts:13-18` | release gate `INSURANCE_SATISFIED` (`deal.service.ts:41-45,134-138`) — keep | Add REJECTED/EXPIRED + defect reason + comms |
| 32 | Contract overdue from dealer (L1270) | MISSING | No overdue scan for CONTRACT_PENDING; `dealer-contract.service.ts` has no deadline logic | grep `overdue|deadline` in `lib/services/dealer/dealer-contract.service.ts` → none | — | 24h deadline job + reminder + escalation queue row |
| 33 | Contract mismatch (L1271) | PARTIAL | `contract-comparison.service.ts` exists; dealer issues email + buyer alert on WARNING/FAIL; `CONTRACT_FAIL` derived queue | `contract-shield.service.ts:369-372`; `admin-queue.service.ts:10` | approval binds to reviewed version (`dealer-contract.service.ts:78-112`) | Queue row owner=Ops with named discrepancies |
| 34 | Contract extraction failure (L1272) | PARTIAL | Empty extraction → scan failure, fail-closed; retry UNVERIFIED | `lib/services/contract-shield/extract-text.ts:39-48` | fail-closed — keep | Retry + queue row |
| 35 | Buyer/co-buyer does not sign (L1273) | PARTIAL | 14-day TTL, lazy + cron expiry (CAS), re-prepare permitted; **no reminders**; `ESIGN_EXCEPTION` derived queue at 48h; co-buyer concept absent | `buyer-signing.service.ts:41, 385-394, 670-680`; `app/api/cron/esign-envelope-expiry/route.ts:17`; `admin-queue.service.ts:19-24` | CAS expiry, hash-bound signing | Reminder sequence via outbox; queue row |
| 36 | Dealer does not execute (L1274) | MISSING | No DEALER_EXECUTED state | — | — | State + escalation |
| 37 | Pickup missed (L1275) | PARTIAL | No MISSED status; `regenerateQr` exists; `PICKUP_EXCEPTION` derived queue at 7d | `schema.prisma:1583-1593`; `pickup.service.ts:67`; `admin-queue.service.ts:25-30` | QR bound to deal (`qr.service`) | MISSED status + reschedule + revoke/reissue |
| 38 | ID mismatch at handover (L1276) | UNVERIFIED | Check-in validates QR only (`checkInPickup`); ID verification not traced | `lib/services/pickup/pickup.service.ts` | — | — |
| 39 | Trade appraisal changed (L1277) | UNVERIFIED | not traced | — | — | — |
| 40 | Delivery discrepancy (L1278) | MISSING | No case/hold path | — | — | Hold completion + queue row |
| 41 | Dealer released, buyer not confirmed (L1279) | BROKEN | Dealer QR scan completes the deal **unilaterally** (`PICKUP_SCHEDULED→COMPLETED` legal; scan route sets pickup COMPLETED and emails "deal is complete") — spec says never complete automatically | `deal.service.ts:29`; `app/api/dealer/pickup/scan/route.ts:110-135` | — | Split into DEALER_RELEASED → buyer confirmation → COMPLETED; reminder job |
| 42 | Circumvention detected (L1280) | PARTIAL | Messaging flags thread + redacts + SYSTEM_ALERT; `recordCircumventionAttempt` (CircumventionAttempt + PlatformAlert) has **zero callers**; no scorecard/suspension link | `lib/services/messaging/messaging.service.ts:13-45`; `lib/services/trust/anti-circumvention.service.ts:5-11` (no callers) | pattern capture + redaction — keep | Wire `recordCircumventionAttempt` from messaging; queue row owner=Ops |
| 43 | Premium unpaid at funding (L1281) | MISSING | Premium is a `Buyer.plan` flag with no balance/funding link | `app/api/buyer/plan/upgrade/route.ts:21-89` | — | Requires §fee/Premium model (other area) |
| 44 | Premium payment fails (L1282) | UNVERIFIED | fee PI failure branch not read | `stripe/route.ts:613` | — | — |
| 45 | Upgrade prompt during open exception (L1283) | MISSING | No suppression logic | — | — | Gate prompt on open queue_items |
| 46 | Downgrade after Premium settled (L1284) | MISSING | none | — | — | — |
| 47 | $99 charged back after Premium (L1285) | MISSING | Dispute handler audit-only | `stripe/route.ts:769-800` | — | Finance queue row; entitlement hold |
| 48 | Post-completion obligation overdue (L1286) | MISSING | No obligation model | — | — | — |
| 49 | Communication terminal failure (HTML EXC:914) | PARTIAL | Outbox terminal failure = `status='failed'` + `logger.error` (Sentry via logger); no Operations record | `comms-outbox.service.ts:444-451, 402-414` | columns-only terminal (no DLQ re-emit) — keep | Raise queue row / `notifyOncall` on terminal failure and RECLAIM_UNCERTAIN |

## Rows — §27 Communications (spec lines 1288-1377)

| spec_ref | requirement | status | current | evidence | stronger safeguard | required change |
|---|---|---|---|---|---|---|
| §27 L1290 durable outbox with trigger event, recipient, template, **send-time state recheck**, idempotency key, delivery status, retry, **cancellation rule**, **terminal-failure alert** | All transactional comms via outbox | PARTIAL | Outbox has recipient/template/key/status/retry; lacks trigger-event column, state recheck, cancellation, alert. ~90 direct sites (Deliverable 1) | `comms_outbox.sql:22-47`; `comms-outbox.service.ts` | dedup_key UNIQUE, CAS claim, RECLAIM_UNCERTAIN no-resend | Add `trigger_event`, `entity_type/id`, `recheck` (payload hook name evaluated in drain), `cancelled` status + `cancelOutboxByEntity()`, terminal alert; migrate senders |
| §27 L1292 "No page request determines whether a communication survives" | No request-bound sends | BROKEN | Majority of sends are request/`after()`/webhook-bound (rows 1-5, 8-16, 20-38, 43 in Deliverable 1) | see Deliverable 1 | — | Migrate to outbox |
| §27 L1294 "zero production records" | Reconcile | ALREADY CORRECT (consistent) | Only CRM/nurture + 10 lifecycle senders enqueue; if those have not fired in prod, zero rows is expected. Table existence in prod UNVERIFIED | Deliverable 3 producer table | — | — |

### §27.1 Required communications (L1298-1377)

Legend: rail codes as in Deliverable 1; "OB" = comms_outbox.

| Event (L) | status | current | evidence | required change |
|---|---|---|---|---|
| Registration submitted (1300) | PARTIAL | `sendWelcomeEmail` R1 on resend-verification; signup path not traced | `resend-verification/route.ts:154`; `resend.service.ts:252-262` | OB + expiry in body |
| Verification completed (1301) | UNVERIFIED | `sendEmailVerifiedEmail` exists R1; caller not located | `resend.service.ts:911-920` | OB |
| Onboarding incomplete (1302) | PARTIAL | `check_form_completion_1..3` (R3/R4) | `app/api/jobs/check-form-completion/route.ts:37-73`; `lifecycle-scheduler.ts` | Name exact unfinished requirement; OB |
| Guest capture (1303) | UNVERIFIED | not traced | — | — |
| Draft abandoned four-touch (1304) | PARTIAL | LP `form_abandonment` nurture via OB (steps not counted) | `lead-nurture.service.ts:202` | Verify 4 touches; apply to buyer drafts |
| Application submitted → AutoLenis (1305) | PARTIAL | `sendAdminPrequalAlertEmail` R1 (two implementations) | `prequal.service.ts:749`; `admin-prequal.service.ts:738` | OB; dedupe implementations |
| Prequal approved (1306) | PARTIAL | R1 | `prequal.service.ts:599` | OB |
| Prequal under review (1307) | PARTIAL | R1 | `prequal.service.ts:703` | OB |
| Provider delay (1308) | PARTIAL | under-review email reused; no delay-specific notice | `prequal.service.ts:103-121` | OB delay template |
| Prequal declined (1309) | PARTIAL | R1 adverse action with outcome tracking | `prequal.service.ts:651, 640-670` | OB while preserving outcome discrimination |
| Approval expiring/expired (1310) | PARTIAL | raw Resend in cron + Notification dedup | `prequal-ibv-reminders/route.ts:85-105` | OB |
| Vehicle Request submitted (1311) | DUPLICATED | R1 `request-received-*` + R2 `sendVehicleRequestConfirmation` both fire | `public/request-vehicle/route.ts:656,663` | Single OB send with $99 explanation + checkout link |
| $99 unpaid six-touch (1312) | PARTIAL | `deposit_reminder_1..6` on R3/R4 (flag) | `lifecycle-touch-drain.service.ts:584-588`; `jobs/deposit-reminder/route.ts` | Move to OB (or accept R4 as the durable plane and retire R3) |
| Payment processing (1313) | MISSING | none | — | OB |
| Payment succeeded (1314) | PARTIAL | R1 buyer; AutoLenis copy UNVERIFIED | `stripe/route.ts:287,439` | OB both recipients |
| Payment failed (1315) | UNVERIFIED | branch body unread | `stripe/route.ts:613` | — |
| Payment reconciliation gap → Finance (1316) | PARTIAL | SYSTEM_ALERT Notification | `deposit-settlement.service.ts:104-125` | queue_items + OB email |
| Refund or dispute (1317) | PARTIAL | refund email R1; dispute: audit only | `stripe/route.ts:685,754,769` | OB dispute notice |
| Radius authorization needed (1318) | MISSING | hold without buyer notice | `request-coverage-gate.service.ts:114-190` | OB |
| Sourcing completed (1319) | PARTIAL | R2 `sendDealersContactedEmail` | `intake-pipeline.service.ts:513` | OB |
| Auction launched (1320) | DUPLICATED | R1 `sendAuctionActivatedEmail` (webhook + admin) + R3 `auction-active` job | `stripe/route.ts:293`; `launch-auction/route.ts:315`; `jobs/auction-active` | one OB send |
| Dealer invited (1321) | PARTIAL | R1 + IA + R3/R4 `dealer_invited` | `dealer-invitation.service.ts:379-395` | OB |
| Dealer invitation reminder (1322) | DUPLICATED | two crons send the same key | `dealer-invitation-reminder/route.ts:100`; `auction-close/route.ts:76` | one OB producer |
| Dealer invitation bounced → Ops (1323) | PARTIAL | suppression only | `webhooks/resend/route.ts:188-189` | queue_items |
| Offer received (1324) | PARTIAL | R2 first-offer (no key) + R3 `offer-received` | `offer.service.ts:156-180`; `jobs/offer-received` | OB, count-only content verified |
| Auction nearing zero offers → Ops (1325) | UNVERIFIED | `health.service.ts` has 4 Notification writes not read | `lib/services/monitoring/health.service.ts` | — |
| Offers ready (1326) | PARTIAL | OB; Premium mention absent | `resend.service.ts:428-438` | add Premium copy |
| Zero offers (1327) | PARTIAL | dealer OB + buyer IA | `auction.service.ts:161-192` | buyer OB email with recovery path |
| Buyer selects offer (1328) | PARTIAL | buyer OB; dealer OB via award drain; no reaffirmation request | `select-offer/route.ts:114`; `dealer-award.ts:272` | add reaffirmation content |
| Premium invitation shown (1329) | MISSING | plan upgrade is a bare POST | `app/api/buyer/plan/upgrade/route.ts` | product work |
| Premium follow-up first/final (1330-1331) | MISSING | none | — | — |
| Losing offers (1332) | ALREADY CORRECT | OB via award drain, durable marker | `dealer-award.ts:289`; `dealer-award-dispatch.service.ts` | — |
| Reaffirmation reminder 12h (1333) | MISSING | no reaffirmation | — | — |
| Dealer confirms (1334) | MISSING | — | — | — |
| Dealer rejects/times out (1335) | MISSING | — | — | — |
| Material change proposed (1336) | MISSING | — | — | — |
| Vehicle hold expiring (1337) | MISSING | holds no-op | `cron/holds/route.ts` | — |
| Outside dealer verification needed (1338) | UNVERIFIED | outside-invite exists | `lib/services/auction/outside-invite.service.ts` | — |
| Recap ready (1339) | MISSING | — | — | — |
| Financing path selected (1340) | PARTIAL | IA (+SMS flag) via `emitDealStatusComms` FINANCING_PENDING | `acquisition-comms.ts:113-121` | OB email |
| Financing in progress (1341) | MISSING | — | — | — |
| Financing terms locked (1342) | MISSING | — | — | — |
| Financing completed (1343) | PARTIAL | advance to FEE_PENDING → IA/SMS | `financing-orchestrator.service.ts:142` | OB |
| Financing failed/expired (1344) | PARTIAL | review task only | `financing-orchestrator.service.ts:69,167` | OB buyer notice |
| Funding cleared/blocked (1345) | MISSING | — | — | — |
| Standard plan confirmed (1346) | MISSING | — | — | — |
| Premium balance required (1347) | PARTIAL | admin manual send-link R1 | `admin/payments/concierge-fee/send-link/route.ts:100` | OB automatic |
| Premium balance succeeded (1348) | PARTIAL | R1 buyer only | `stripe/route.ts:537` | OB + concierge + Finance |
| Premium balance failed (1349) | UNVERIFIED | — | `stripe/route.ts:613` | — |
| Premium reverted (1350) | MISSING | — | — | — |
| Downgrade requested / refund decision (1351-1352) | MISSING | — | — | — |
| Insurance required (1353) | PARTIAL | IA/SMS INSURANCE_PENDING | `acquisition-comms.ts:143-151` | OB email w/ link |
| Insurance uploaded (1354) | UNVERIFIED | upload-proof writes status; Ops task not traced | `app/api/buyer/insurance/upload-proof/route.ts:138` | — |
| Insurance verified (1355) | MISSING | `BuyerTriggers.insuranceBound` dead code (0 callers) | `notification.service.ts:41-43` | OB |
| Insurance rejected/expired (1356) | MISSING | no status | `schema.prisma:1493-1502` | — |
| Contract requested (1357) | PARTIAL | R1 dealer contract pending; 24h deadline absent | `deals/[dealId]/action/route.ts:91` | OB + deadline |
| Contract overdue (1358) | MISSING | — | — | — |
| Contract revision required (1359) | PARTIAL | R1 dealer issues (non-idempotent `Date.now()` key) + buyer alert | `contract-shield/[reviewId]/route.ts:182,221` | OB, stable key |
| Contract approved (1360) | DUPLICATED | service and route both send `contract-approved-${dealId}` (dedup by key saves it) | `contract-shield.service.ts:368`; `contract-shield/[reviewId]/route.ts:131` | one producer |
| Signature required (1361) | PARTIAL | IA/SMS SIGNING_PENDING + `sendEnvelope` IA; no buyer email; co-buyer absent | `acquisition-comms.ts:188-196`; `esign.service.ts:39-51` | OB |
| Signature reminder/expiration (1362) | PARTIAL | silent CAS expiry | `buyer-signing.service.ts:670-680` | OB reminders |
| Buyer signatures completed → dealer (1363) | PARTIAL | buyer `contract-signed` R1 in after(); dealer execution request absent | `buyer-signing.service.ts:881` | OB dealer notice |
| Fully executed stored (1364) | UNVERIFIED | `executed-contract.service.ts` not traced | — | — |
| Pickup readiness blocked (1365) | MISSING | — | — | — |
| Pickup proposal/counter (1366) | ALREADY CORRECT | OB round-keyed | `pickup-notifications.service.ts:105-151` | — |
| Pickup confirmed (1367) | DUPLICATED | OB `notifyDealerConfirmed` + admin schedule R1 ×2 + buyer IA | `pickup-notifications.service.ts:177`; `pickup/schedule/route.ts:100,108`; `pickup.service.ts` | one OB producer per recipient |
| Pickup approaching 24h/2h (1368) | MISSING | — | — | — |
| Pickup rescheduled (1369) | UNVERIFIED | `scheduling.service.reschedulePickup` comms not traced | `lib/services/pickup/scheduling.service.ts` | — |
| Handover blocked (1370) | MISSING | — | — | — |
| Dealer releases vehicle (1371) | MISSING | — | — | — |
| Buyer confirms possession (1372) | MISSING | — | — | — |
| Deal completed (1373) | DUPLICATED | R1 `deal-complete-*` ×2 routes + raw R2 in scan route + SMS via seam + R3 `deal-complete` job | `deals/[dealId]/action/route.ts:116`; `pickup/complete/route.ts:99`; `dealer/pickup/scan/route.ts:126`; `acquisition-comms.ts:228-236` | one OB producer keyed on the seam |
| Title/payoff/due-bill follow-up (1374) | MISSING | — | — | — |
| Cancellation (1375) | PARTIAL | IA (route-owned) + SMS flag; no email; dealer only on auction cancel IA | `acquisition-comms.ts:238-246`; `auctions/[auctionId]/action/route.ts:193-207` | OB buyer + dealer |
| Refund decision (1376) | PARTIAL | R1 refund confirmation | `stripe/route.ts:685,754` | OB |

## Rows — §28.3 Universal transition controls (spec lines 1423-1437)

| control | status | current | evidence | stronger safeguard | required change |
|---|---|---|---|---|---|
| 1 Authorization | PARTIAL | Route-level (`requireAdmin`, `getRequestBuyer`, dealer auth); seam accepts any `actorRole` string | `deal.service.ts:104-108` | — | Seam asserts allowed roles per transition |
| 2 Validation (facts current, not cached) | PARTIAL | Seam re-reads deal (:109); insurance gate re-checked (:134-138); prequal validity, financing, contract-version facts not re-validated at transition | `deal.service.ts:109-138` | insurance hard-gate | Per-transition validators (prequal valid, contract approved version, envelope COMPLETED, pickup confirmed) |
| 3 Conditional write | ALREADY CORRECT | CAS `updateMany WHERE status=observed` + `expectedFrom` | `deal.service.ts:127, 148-165` | lost race re-resolves once, never rewinds | — |
| 4 Atomicity | PARTIAL | `opts.data` written with status in one `updateMany`; **history, activity, comms, completion event run after and are swallowed** | `deal.service.ts:148-204` | — | Wrap CAS + history in `prisma.$transaction`; move comms/completion to outbox rows written in the same transaction |
| 5 Idempotency | PARTIAL | Replay safe for deal status (CAS), comms (`acq-comms:deal:*` guard), completion (CAS); but SMS guard is claim-then-lose; direct-rail emails keyed but some with `Date.now()` keys | `acquisition-comms.ts:410-417,468-478`; `resend.service.ts:1702` | — | Claim after success or release on failure; stable keys |
| 6 Audit | ALREADY CORRECT (deal) | `DealStatusHistory{from,to,actor,role,reason,createdAt}` + `BuyerActivityEvent` + `adminAuditLog` on admin routes | `deal.service.ts:167-186`; `schema.prisma:2810-2822` | — | Make write non-swallowed |
| 7 Communication scheduled durably | BROKEN | Seam emits in-app + direct SMS in-request; email from routes | `acquisition-comms.ts:353-486` | consent-aware plan table | Seam enqueues OB rows |
| 8 Recovery | PARTIAL | Arrival hooks (fee ladder, insurance) self-heal; `esign-artifact-reconcile`, `deposit-activation-reconcile`, `auction-close` reprocess; no owner/return-path model | `deal.service.ts:225-338`; crons | — | queue_items |
| L1435 "[BUILT] legal-transition table, CAS, history, activity, idempotent comms, exactly-once completion seam" | ALREADY CORRECT (with caveats) | `TRANSITIONS` (:15-34), `canTransition` (:63-70), CAS (:148), history (:167), activity (:179), `emitDealStatusComms` (:194), `emitDealCompletionEvent` (:202-204) | `deal.service.ts`; `deal-completion-event.service.ts:23-55` | single-writer guard test (commit 4e52391) | Completion event is best-effort (`emit.ts` `after(forwardToMake)`); add durable retry |

**Transitions that bypass the seam today**: (a) `Auction.status` writes: `admin-buyer-command-center.service.ts:877` (pause→CANCELLED), `:905` (resume→ACTIVE), `auctions/[auctionId]/action/route.ts:176`, `auction.service.ts:closeAuction/closeExpiredAuctions` (no CAS on close; CAS only on post-close claim); (b) `VehicleRequest.status` in `buyer/requests/[requestId]/cancel/route.ts:28`; (c) `Deal.insuranceStatus` written directly by `insurance/upload-proof:138`, `admin/insurance-requests/respond:59`, `journey/{complete,complete-all,reopen}` (only the status field is seam-guarded); (d) `ESignEnvelope` has its own CAS (fine); (e) `Pickup` has its own CAS (fine); (f) `DealStatus` itself: single writer verified by commit 4e52391's guard test (not re-run here).

## Rows — §29 Safeguards (spec lines 1438-1462; HTML SAFE 934-940)

| bullet | status | evidence |
|---|---|---|
| FCRA consent persisted before pull; duplicate paid pulls claimed safely | VERIFIED | `prequal.service.ts:215-273` (atomic claim + `consentText: FCRA_CONSENT_TEXT`), `:313` throws without consent, `:342` stale claim reclaim |
| No SSN; OFAC fails closed | VERIFIED | `prequal.service.ts:4,381-383` (OFAC_REVIEW hold); `ofac.service.ts:4-11` (P0 alert, never auto-approve); SSN grep in prequal.service → none |
| Adverse-action sent/duplicate/failed distinguished | VERIFIED | `prequal.service.ts:640-670`; `resend.service.ts:120-127` (`EmailSendOutcome`) |
| Stripe authority; provider-side duplicate-charge checks (deposit + Premium fee) | PARTIAL | deposit: `create-intent/route.ts:94,147-160` (blocks duplicate intent); fee: `service-fee.service.ts:89-141` (`paymentIntents.search` + `concierge-fee-${dealId}` idempotency). "Premium fee" as a product does not exist — the check is on the concierge fee |
| Deposit state matrix; unroutable payments raise Ops exception | VERIFIED | `lib/payments/deposit-state.ts:29-40`; `stripe/route.ts:33-54,606` |
| Auction close atomic claim + reprocess | VERIFIED | `auction.service.ts:18-50` (`postCloseClaimWon`); `cron/auction-close/route.ts:26-41` |
| Anti-snipe hard cap + audit | VERIFIED | `anti-snipe.service.ts:16,53-67` (`MAX_AUTO_EXTENSIONS=6`, CAS, `auctionExtensionLog`) |
| Single-winner under DB lock | VERIFIED | `select-offer.service.ts:41-43` (`SELECT … FOR UPDATE` in `$transaction`) |
| Offer arithmetic + budget server-side | PARTIAL | budget: `offer.service.ts:47-52` rejects; arithmetic: `offer-validation.service.ts:21` is a **warning** only |
| Best Price persisted with weights | VERIFIED | `best-price.service.ts:112-120` |
| Deal transitions table/CAS/history/exactly-once completion | VERIFIED (see §28.3 caveats) | `deal.service.ts:15-34,148,167,202` |
| Contract uploads private, dealer-owned, versioned, fail-closed | VERIFIED | `contract-upload.service.ts:9-12` (version = max+1, create); `dealer-contract.service.ts:21` (`assertDealerOwnsDeal`); `extract-text.ts:39-48` |
| Shield approval binds to reviewed version, rejects race | VERIFIED | `dealer-contract.service.ts:59-112` (`SUPERSEDED_BY_NEWER_UPLOAD`); `contract-shield/[reviewId]/route.ts:79-88` |
| E-sign hash-bound; refuses without evidence storage | VERIFIED | `buyer-signing.service.ts:91-94,212,409,58-69` (schema gate throws `ESignSchemaUnavailableError`) |
| Pickup strict turns, proposal-time CAS, two-counter cap, compensating recovery | VERIFIED | `pickup-coordination.service.ts:4-17,50,88` |
| Pickup emails durable with round-specific keys | VERIFIED (negotiation only) | `pickup-notifications.service.ts:117,151,228,262` |
| Refund idempotency-keyed; NO_CHARGE never labelled refunded | VERIFIED | `refund.service.ts:23-44` |
| Identity firewall buyer ↔ non-winning dealers | PARTIAL | `offer/dealer-display.ts:26` (`buyerFacingDealerName`) is buyer→dealer-name masking; dealer→buyer-PII isolation not traced in this area |
| Anti-circumvention capture + Ops routing | PARTIAL | capture: `messaging.service.ts:13-45` (flag/redact/SYSTEM_ALERT); `recordCircumventionAttempt`/`PlatformAlert` path has zero callers |
| Junk-fee/fee caps/APR/packing/disclosure | UNVERIFIED (other area) | `contract-shield.service.ts` rule engine not read here |
| (HTML) Scorecard consequences for reaffirmation/no-show/contract delay/overdue | MISSING | `dealer-scorecard.service.ts:18-28` computes response/win/completion rates only |

---

## Deliverable 5 — Cancellation paths that exist

| Path | Entry | What it stops | What it does NOT stop |
|---|---|---|---|
| `cancelDeal(dealId, reason, actor)` | `lib/services/deal/deal.service.ts:377-402`; caller `cancelBuyerWorkflow` (`admin-buyer-command-center.service.ts:927-975`) ← `POST /api/admin/buyers/[buyerId]/workflow/cancel` | Deal status (CAS, force, expectedFrom), history, activity, in-app/SMS via seam (in-app skipped — owned by a caller that does not exist on this path) | envelopes, pickups/QR, auction/invitations, lifecycle touches, outbox rows, dealer notice, email, refund decision |
| Admin `DEAL_CANCELLED` | `app/api/admin/deals/[dealId]/action/route.ts:167-219` | refund (before transition), `advanceDealStatus(CANCELLED, force)` **directly** (bypasses `cancelDeal`, no `expectedFrom`), buyer + dealer in-app | envelopes, pickups/QR, auction, touches, outbox, email |
| Admin `AUCTION_REFUND_TRIGGERED` | `app/api/admin/auctions/[auctionId]/action/route.ts:158-208` | refund, raw `auction.update CANCELLED`, buyer + dealer in-app | invitations rows, invitation reminders (cron scans auction status — UNVERIFIED), lifecycle touches, deal |
| `pauseBuyerWorkflow` | `admin-buyer-command-center.service.ts:862-892` | writes `AuctionStatus.CANCELLED` as a "pause"; `resumeBuyerWorkflow` (:895-925) expects PENDING → resume from CANCELLED impossible | everything else |
| Buyer request cancel | `app/api/buyer/requests/[requestId]/cancel/route.ts:9-35` | `VehicleRequest.status=CANCELLED` + event (transaction), from SUBMITTED/INTAKE/ACTIVE_SOURCING only | intake pipeline stages already queued, dealer outreach, `vehicleOfferDealerInvite`s, comms; no reason; no CAS on status |
| `cancelInvitation` | `invitation-token.service.ts:245-253` ← `admin/dealers/invitations/[invId]/cancel` | dealer-recruitment invitation (CAS) | not an auction invitation |
| `voidEnvelope` / `voidEnvelopeInternal` | `esign.service.ts:56-64`; `buyer-signing.service.ts:546` | envelope (CAS) | not called by any cancel path |
| `cancelDepositReminderTouches` / `cancelPreCheckoutTouches` | `lifecycle-touch-drain.service.ts:599-660` | R4 touches | called only on payment/checkout, never on cancel |
| `FROZEN_PENDING_RELEASE` | absent | — | — |

## Deliverable 6 — Transition seam location

Legal-transition table `TRANSITIONS` `deal.service.ts:15-34`; guard `canTransition` :63-70; CAS :148-151; lost-race re-resolve :152-165; history :167-176; activity :179-186; idempotent comms :194 → `acquisition-comms.ts:353-486` (guard `acq-comms:deal:${dealId}:${status}:${buyerId}` :273-279 via `lib/jobs/idempotency.ts:28-40`); exactly-once completion :202-204 → `deal-completion-event.service.ts:23-55` → `lib/events/emit.ts` (`purchase_completed`, key `${event}:${domainEntityId}`, forwarded to Make in `after()` :198-212). Arrival hooks :225-338. Terminal cancel :377-402. Single-writer guard test: commit 4e52391 (`cancel-deal-seam.test.ts`, `workflow-stage-seam.test.ts`).

---

## Duplicates

1. **Cancellation**: `cancelDeal` vs admin `DEAL_CANCELLED` (`advanceDealStatus(force)` direct) — two deal-cancel writers with different semantics (`deals/[dealId]/action/route.ts:190` vs `deal.service.ts:385`).
2. **Envelope void**: `esign.service.voidEnvelope` vs `buyer-signing.voidEnvelopeInternal`.
3. **Durable comms planes**: `comms_outbox` vs `lifecycle_touch_schedule` (R4) vs QStash `/api/jobs/*` (R3) — three schedulers for delayed transactional comms, plus `lifecycle-scheduler.ts` flag router.
4. **Operations exception records**: `Notification(SYSTEM_ALERT)` (dedup-by-title in ≥6 writers: `stripe/route.ts:33-54`, `deposit-settlement:104-125`, `deposit-activation:70-86`, `inventory-budget-alert`, `prequal-sla-escalation`, `dead-cron`, `trust-check`, `messaging.service`) vs `PlatformAlert` (`health-alert.service.createAlertOnce`, `ofac.service`, `anti-circumvention.service`, `funnel-observability`) vs `FinancingReviewTask`.
5. **Prequal notice set**: `prequal.service.ts:599-749` and `admin-prequal.service.ts:596-738` each call the four prequal senders.
6. **Contract approved email**: `contract-shield.service.ts:368` and `contract-shield/[reviewId]/route.ts:131`.
7. **Deal complete email**: `deals/[dealId]/action:116`, `pickup/complete:99`, `dealer/pickup/scan:126` (raw), QStash `deal-complete`.
8. **Vehicle request confirmation**: R1 `request-received-*` + R2 `sendVehicleRequestConfirmation` (`public/request-vehicle/route.ts:656,663`).
9. **Dealer invitation reminder**: `dealer-invitation-reminder` and `auction-close` crons.
10. **Auction activated**: R1 (webhook + admin) + R3 `auction-active`.
11. **Alert helpers named `createAlert`**: `health-alert.service.createAlert` (PlatformAlert) vs `inventory-budget-alert.service` local `createAlert` (Notification).
12. **In-app trigger catalogs**: `notification.service.BuyerTriggers/DealerTriggers` (zero callers — dead) vs `acquisition-comms.dealStatusCommsPlan`.
13. **History writers**: `advanceDealStatus` vs `deal-timeline.recordStatusTransition` (zero callers — dead second plane).

## Stronger safeguards to preserve

- Outbox: UNIQUE `dedup_key`, CAS claim, `dispatched_at` + RECLAIM_UNCERTAIN no-resend, columns-only terminal (no DLQ re-emit), transactional bypasses soft but honours hard suppression, provider-side Resend idempotency key, TCPA hard gate on SMS, post-send bookkeeping never re-throws.
- `cancelDeal`: `expectedFrom` pin so a lost race never cancels a completed deal; honest `false` return.
- `advanceDealStatus`: CAS, `expectedFrom`, insurance hard-gate, arrival hooks not propagating `force`, exhaustiveness guard on `dealStatusCommsPlan`.
- `refundDepositCharge`: NO_CHARGE for `pi_admin_`/null PI; `charge_already_refunded` sync-only; status-guarded flip.
- Deposit never auto-refunded (`holds` cron no-op; `deposit-activation.service.ts:33-41`).
- Prequal: atomic pull claim + FCRA consent text persisted; OFAC/provider failure fail-closed; adverse-action outcome discrimination; queue resolve requires explicit decision words.
- E-sign: hash re-check at signature (`buyer-signing.service.ts:409`), schema gate refuses signing without evidence tables, TTL enforced lazily + by cron via CAS, terminal records immutable.
- Contract Shield approval binds to `contractVersionId` and refuses on newer upload.
- Pickup: proposal-time CAS + counter cap → EXCEPTION.
- Anti-snipe cap with CAS; auction post-close atomic claim + reprocess of unfinished closes.
- Offer over-budget rejected at submission.
- Dealer-invitation matcher fails closed on null location (per BUYER-LOCATION-GAP).
- Dealer-award dispatch: durable `dealerAwardDispatchedAt` marker, bounded attempts, historical window.

## Legacy paths

- `resend.service.sendIdempotent` direct rail (~75 senders) — to be migrated to `enqueueTransactionalEmail` with key parity (pattern proven by `sender-migration.test.ts`).
- QStash `/api/jobs/*` + `lifecycle-scheduler.ts` flags (default OFF → QStash) — R3 is the live producer for deposit/auction/offer/deal-complete sequences unless flags flipped.
- `notification.service.BuyerTriggers/DealerTriggers` — dead code.
- `deal-timeline.recordStatusTransition` — dead second history plane.
- `Notification(type=SYSTEM_ALERT)` dedup-by-title as the de-facto ops queue.
- `pauseBuyerWorkflow` using `AuctionStatus.CANCELLED` as pause.
- `vehicle-offers.email.ts` and `buyer-notifications.service.ts` raw Resend clients.
- `lib/services/sms/twilio.service.sendSms` ungated sender (voice/social).
- Concierge (vehicle-request) track has its own offer/invite/email set entirely on R2.

## Out-of-scope findings

- `app/api/dealer/pickup/scan/route.ts:126` raw Resend SDK in a route; `prequal-ibv-reminders/route.ts:95` same in a cron (integrations rule).
- `admin-queue.service.resolveQueueItem` swallows DB errors and still audits "resolved" (`:89-94`, TODO at :92).
- `sendIdempotent` proceeds when the EmailSendLog lookup throws (`resend.service.ts:145-149`) — fail-open on idempotency.
- Non-idempotent keys with `Date.now()`: `dealer-contract-issues`, `affiliate-*`, `dealer-account-suspended/reinstated`, `dealer-stale-listing`.
- Dealer cancel notice on auction cancel uses `type:'AUCTION_STARTED'` (`auctions/[auctionId]/action/route.ts:197`).
- `INAPP_OWNED_BY_CALLERS` includes CANCELLED, but `cancelBuyerWorkflow` path creates no in-app → buyer silent on that path.
- `Deal.insuranceStatus` has several direct writers outside the seam (listed in §28.3).
- Skill `autolenis-deal-lifecycle` still describes DocuSign; code is in-house signing (`esign.service.ts:1-9`) — skill stale.

## UNVERIFIED items

- Whether `comms_outbox`, `lifecycle_touch_schedule`, `idempotency_keys` exist in production (owner-gated SQL; no DB access).
- `payment_intent.payment_failed` handling (`stripe/route.ts:613-642`) — not read.
- `health.service.ts` Notification writers (zero-offer risk?).
- Guest capture / verification-completed / fully-executed-stored / pickup-rescheduled / insurance-uploaded comms.
- Outside-dealer verification block; trade-in stale payoff; ID check at handover; trade appraisal change.
- Whether `esign-artifact-reconcile` re-sends `contract-signed` when `after()` died.
- Whether `dealer-invitation-reminder` skips CANCELLED auctions.
- Test suites listed above were not executed in this session.
- Junk-fee/fee-cap rule engine (Contract Shield area).

## Open questions for the owner

1. Is `comms_outbox` applied in production Supabase? If not, the "zero rows" statement is vacuous and cutover needs the SQL applied first.
2. Which of R3 (QStash jobs) and R4 (`lifecycle_touch_schedule`) is the intended durable plane for delayed sequences — or should both fold into `comms_outbox` with `run_at`?
3. Should `queue_items` be a new Prisma model (`QueueItem` using the orphan enums) or should `FinancingReviewTask` be generalised?
4. Confirm `FROZEN_PENDING_RELEASE` semantics: which states are "after the dealership contract is fully executed" given there is no DEALER_EXECUTED today (SIGNED?).
5. Is dealer-scan auto-completion (`PICKUP_SCHEDULED → COMPLETED` by dealer) an accepted deviation from "Dealer released, buyer has not confirmed → never complete automatically"?
6. Should `emitDealStatusComms` SMS remain flag-gated (`ACQUISITION_COMMS_SMS_ENABLED`) after outbox routing?
7. Owner assignment table (System/Buyer/Ops/Compliance/Finance) — who resolves each queue type in the admin UI?

---

## Verification corrections (adversarial pass)

Independent re-check of every ALREADY CORRECT / MISSING / BROKEN / DUPLICATED row plus a sample of PARTIAL and UNVERIFIED rows, by opening the cited code (not the row's evidence). Paths relative to `frontend/`. Format: `spec_ref | original → corrected | reason | evidence`.

### §24 Cancellation (L1211-1218)

- §24 L1213 "authorized actor" | PARTIAL → **BROKEN** | A SIXTH cancel path exists that the file misses: admin `DEAL_STAGE_ADVANCED` with `newStatus:"CANCELLED"` is legal without `force` (canTransition allows CANCELLED from any non-terminal state) and bypasses the `DEAL_CANCELLED` branch's terminal-state guard, refund decision and dealer notice. Authorization is also uneven: `workflow/pause` (which writes `AuctionStatus.CANCELLED`) requires only *any* admin session, while `workflow/cancel` requires the `deals.cancel` permission and `deals/[id]/action` requires SUPER_ADMIN/OPERATIONS_ADMIN. | `app/api/admin/deals/[dealId]/action/route.ts:59-72` (`advanceDealStatus(dealId, newStatus…force: force === true)` for any DealStatus incl. CANCELLED/REFUNDED); `deal.service.ts:66` (`if (to === CANCELLED) return !TERMINAL.includes(from)`); `app/api/admin/buyers/[buyerId]/workflow/pause/route.ts:20-21` (only `getAdminFromRequest`, no role check); `workflow/cancel/route.ts:23` (`requirePermissionStrict(request, "deals.cancel")`); `deals/[dealId]/action/route.ts:38-40`.
- §24 L1213 "current stage recorded" / "full history preserved" | ALREADY CORRECT (deal) → **PARTIAL** | `cancelDeal` does NOT refuse terminal deals: `force:true` bypasses `canTransition`, and `expectedFrom: deal.status` matches whatever state was read — so a direct call on a COMPLETED or REFUNDED deal writes it to CANCELLED. The terminal guard lives only in callers (`cancelBuyerWorkflow` filters `notIn` terminal; admin route checks `["CANCELLED","REFUNDED","COMPLETED"]`). The seam test covers the *race* (`:105-114`) and *already-CANCELLED* (`:167`) cases only, not "already COMPLETED". The history write is `.catch(()=>{})`. | `lib/services/deal/deal.service.ts:129` (`if (!opts.force && !canTransition…)`), `:385-391` (`force: true, expectedFrom: deal.status`), `:176` (swallowed history); `admin-buyer-command-center.service.ts:935-938`; `deals/[dealId]/action/route.ts:168`; `lib/services/deal/__tests__/cancel-deal-seam.test.ts:105,167`.
- §24 L1213 "unsent sourcing and outreach stopped" | MISSING → **PARTIAL** | Not zero: the intake processor and coverage reconciler only act on requests in `SUBMITTED/INTAKE/ACTIVE_SOURCING`, so a CANCELLED request drops out of both; R3/R4 delayed touches carry send-time guards (`hasSelectedOffer`/`hasLiveAuction`/`depositConversionResolved`). What is missing: no cancel path calls `cancelDepositReminderTouches`/`cancelPreCheckoutTouches` (only the Stripe webhook and create-intent do), `comms_outbox` has no cancel state, and an in-flight intake stage is not halted. | `lib/services/acquisition/intake-processor.service.ts:282` (`ACTIVE_VR_STATUSES = ["SUBMITTED","INTAKE","ACTIVE_SOURCING"]`); `request-coverage-gate.service.ts:39` (`HELD_RECONCILE_STATUSES`); `lifecycle-touch-drain.service.ts:136,157,174` (guards); `app/api/jobs/offer-follow-up/route.ts:25` (`hasSelectedOffer`); callers of cancel*Touches: `app/api/webhooks/stripe/route.ts:252`, `app/api/buyer/deposit/create-intent/route.ts:277` only; `comms_outbox.sql:28-29` (no cancelled status).
- §24 L1213 "auction activity closed" | PARTIAL → **BROKEN** | `AUCTION_REFUND_TRIGGERED` has no auction-status guard and counts only `SUBMITTED` offers, so an auction whose offer is already `ACCEPTED` (deal created) passes the guard: the auction is written CANCELLED and the deposit refunded while the Deal stays live. Invitations cannot be "cancelled" at all — `AuctionInvitation` has no status column. `pauseBuyerWorkflow` writes CANCELLED unconditionally and `resumeBuyerWorkflow` expects PENDING, so a paused auction is unrecoverable through the pair. | `app/api/admin/auctions/[auctionId]/action/route.ts:158-176` (`offer.count({where:{auctionId,status:"SUBMITTED"}})`, then `auction.update({data:{status:"CANCELLED"}})`, no state check); `prisma/schema.prisma:518-531` (model AuctionInvitation: id, auctionId, dealerId, invitationScore, sentAt, viewedAt, respondedAt — no status); `admin-buyer-command-center.service.ts:867-876, 899-908`; `schema.prisma:1532-1539` (`OfferStatus` incl. ACCEPTED).
- §24 L1213 "pickup cancelled and release tokens revoked" | MISSING (stands) — note corrected | The revoke *mechanism* exists and is effective: the dealer scan resolves the pickup by the stored `qrCodeData` and enforces `qrExpiresAt`, so `regenerateQr` (overwrites `qrCodeData`) invalidates the old token. Preserve this as a stronger safeguard; what is missing is only that no cancel path invokes it and `PickupStatus` has no CANCELLED. | `app/api/dealer/pickup/scan/route.ts:36-37` (`findFirst({ where: { qrCodeData: qrToken }`), `:65-67` (`qrExpiresAt <= new Date()` → 422); `lib/services/pickup/pickup.service.ts:67-80` (`regenerateQr` rewrites `qrCodeData`); `schema.prisma:1583-1593`.
- §24 L1213 "buyer notified" | PARTIAL (stands) — evidence added | The seam's SMS channel requires a CRM `contacts` row resolved by email and is flag-gated; the in-app for CANCELLED is delegated to callers, so the `workflow/cancel` path is silent on both in-app and email. | `acquisition-comms.ts:295-308` (`INAPP_OWNED_BY_CALLERS` incl. CANCELLED), `:341-343` (`ACQUISITION_COMMS_SMS_ENABLED`), `:545-556` (`if (!contactRow) return "no_contact"`).
- §24 L1215 one orchestration | MISSING (confirmed) | Six independent writers, not five (add `DEAL_STAGE_ADVANCED→CANCELLED`). | as above.
- §24 L1217 `FROZEN_PENDING_RELEASE` | MISSING (confirmed) | `rg FROZEN_PENDING_RELEASE|DEALER_EXECUTED|DEALER_RELEASED|FUNDING_` across `frontend` → no hits; `DealStatus` enum ends at REFUNDED. | `prisma/schema.prisma:1513-1530`.

### §26 Exception register (L1233-1287)

- §26 header L1235 `queue_items` | MISSING (confirmed) | `rg -i "queue_items|QueueItem\b|queue_item"` hits only the AMIPS `ContentQueue` alias, the admin derived-queue service, and the two orphan enums; `prisma/manual_supabase_sql/` has no queue table (45 files listed, none named queue/exception). | `prisma/schema.prisma:1890-1907`; `prisma/migrations/20260423180146_complete_schema/migration.sql:86,89`; `lib/services/admin/admin-queue.service.ts:7-39` (derived reads), `:41-107` (resolve with swallowed DB errors and audit written regardless).
- §26 #7 Payment failure (L1245) | UNVERIFIED → **PARTIAL** | Deposit failure: `payment_intent.payment_failed` flips Deposit → FAILED through the state matrix (`allowedPredecessors("FAILED")`), the VehicleRequest is untouched (preserved), retry = a new create-intent. **No buyer communication at all for a failed deposit.** Concierge/service-fee failure: in-app only, request(webhook)-bound. | `app/api/webhooks/stripe/route.ts:613-623` (deposit updateMany, no notification), `:625-637` (fee → `notification.create` "Payment failed"); `lib/payments/deposit-state.ts:29-40`.
- §26 #15 Shortlisted candidate stale/sold (L1253) | UNVERIFIED → **MISSING** | `AuctionVehicle` has no status/dropped/sold/stale field; no service in `lib/services/auction/*` removes a candidate mid-auction. | `prisma/schema.prisma` model `AuctionVehicle` (grep for status/dropped/stale/sold → none).
- §26 #21 Buyer does not select (L1259) | PARTIAL (stands) — evidence corrected | The nudge engine has **no selection stage** (`NudgeStage` = PREQUAL_IDLE, DEPOSIT_IDLE, FINANCING_IDLE, INSURANCE_IDLE, EMAIL_IDLE; `runNudgeEngine` covers pre-deposit and post-selection stages only). The only "remind before expiry" is the QStash `offer-follow-up` job (guarded by `hasSelectedOffer`) / R4 `auction_closing`. **Offers never expire**: there is no writer of `OfferStatus.EXPIRED` anywhere, so "revalidate or close" is absent. | `prisma/schema.prisma:1781-1787`; `lib/services/nudge/nudge.service.ts:49-66, 67-100`; `app/api/jobs/offer-follow-up/route.ts:6,25`; `lifecycle-touch-drain.service.ts:136`; `rg "OfferStatus.EXPIRED|status: \"EXPIRED\""` → no offer writer.
- §26 #30 Trade payoff stale (L1268) | UNVERIFIED → **MISSING** | `TradeInSubmission` has no payoff/lien fields; `rg -i payoff lib/services/trade-in` → none. | `prisma/schema.prisma` model TradeInSubmission.
- §26 #38 ID mismatch at handover (L1276) | UNVERIFIED → **MISSING** | No identity check in `lib/services/pickup/*`; check-in writes `CHECKED_IN` only; the scan validates token, dealer ownership, expiry and terminal state only. | `lib/services/pickup/pickup.service.ts:87-94`; `app/api/dealer/pickup/scan/route.ts:36-70`; `lib/services/pickup/qr.service.ts:10-13` (`validateQrPayload` checks `type` + `dealId` only).
- §26 #41 Dealer released, buyer not confirmed (L1279) | BROKEN (confirmed) | Dealer QR scan calls `advanceDealStatus(…,"COMPLETED",{actorRole:"DEALER"})` directly; `PICKUP_SCHEDULED → COMPLETED` is a legal edge. | `app/api/dealer/pickup/scan/route.ts:90`; `deal.service.ts:29`.
- §26 #43 Premium unpaid at funding (L1281) | MISSING → **BROKEN** | The file says "Premium is a `Buyer.plan` flag with no balance/funding link" — wrong. The Premium fee is real and is the concierge/service fee: `$499` total, `$400` after the `$99` credit, charged by `service-fee.service` and recorded on `FEE_PAID`. It is **mandatory** in the deal ladder (`FINANCING_PENDING → FEE_PENDING → FEE_PAID → INSURANCE_PENDING`) with no `plan` branch anywhere in `service-fee.service.ts` or `deal.service.ts`. The spec's "revert to Standard, which is already paid, and continue" is contradicted: an unpaid balance stalls the deal at `FEE_PENDING` instead of continuing on Standard. | `lib/constants.ts:7-8` (`PREMIUM_FEE_CENTS = 49900`, `PREMIUM_FEE_REMAINING_CENTS = 40000`); `lib/services/deal/service-fee.service.ts:26-28,104,141,182`; `lib/services/deal/deal.service.ts:17-20`; `rg "plan|PREMIUM|STANDARD" lib/services/deal/*.ts` → only fee constants.
- §26 #44 Premium payment fails (L1282) | UNVERIFIED → **PARTIAL** | Fee PI failure → buyer in-app "Payment failed" only; no retry job, no reversion date, no Finance record, deal remains parked. | `app/api/webhooks/stripe/route.ts:625-637`.
- §26 #28 Financing fails/expires (L1266) | PARTIAL (stands) — add | `FinancingStatus` has no EXPIRED value (PENDING/SELECTED/APPROVED/DECLINED), so "expires" is not representable. | `prisma/schema.prisma:1711-1716`.
- §26 #14 Zero offers (L1252) | PARTIAL (confirmed) | `AUCTION_REOPENED` reopens CLOSED/EXPIRED with no new deposit; concierge-converted auctions blocked. | `app/api/admin/auctions/[auctionId]/action/route.ts:208-225`.
- §26 #42 Circumvention (L1280) | PARTIAL (confirmed) | `recordCircumventionAttempt` has zero non-definition callers; messaging writes an undeduped `SYSTEM_ALERT` per flagged message. | `rg recordCircumventionAttempt` → definition only (`lib/services/trust/anti-circumvention.service.ts:5`); `lib/services/messaging/messaging.service.ts:38-44`.
- §26 #10 Disputed/refunded (L1248) | PARTIAL (confirmed) | `charge.dispute.created` → `adminAuditLog` only; no Deposit DISPUTED, no hold, no outreach stop. | `app/api/webhooks/stripe/route.ts:769-797`.
- §26 #34 Contract extraction failure (L1272) | PARTIAL (confirmed) | Empty extraction → thrown scan failure (fail-closed). | `lib/services/contract-shield/extract-text.ts:41-48`.
- §26 #24 Vehicle hold expires (L1262) | MISSING (confirmed) — note corrected | The `holds` cron is a *deposit*-hold reconciler (no-op), not a vehicle hold; no vehicle-hold model exists (`rg -i "VehicleHold|vehicle_hold|holdExpir"` → none). | `app/api/cron/holds/route.ts:1-21`.

### §27 Communications (L1288-1377)

- §27 L1290 durable outbox | PARTIAL (stands) — gaps added | (a) **In-app notices cannot go through the outbox at all**: `channel CHECK (channel IN ('email','sms'))` — the spec requires "email, SMS, and in-app". (b) The outbox SMS path applies **no quiet hours** (`isRecipientInQuietHours` is used only by `crm-sms.ts`, `sms-gate.ts`, `dealer-sms-wiring.ts`) — weaker than the direct `sendCrmSms` rail. (c) A `type:"transactional"` payload that carries a `contactId` is not treated as transactional (`isTransactional` requires no contactId), so it skips the EmailSendLog SENT-precheck. (d) Terminal failure and RECLAIM_UNCERTAIN are `logger.error` only. | `prisma/manual_supabase_sql/comms_outbox.sql:24,28-29`; `lib/services/comms/comms-outbox.service.ts:169-170, 291-331, 402-414, 444-451`; `rg isRecipientInQuietHours` → `lib/crm/recipient-timezone.ts, lib/crm/sms-gate.ts, lib/services/sms/crm-sms.ts, lib/services/dealer-recruitment/dealer-sms-wiring.ts`.
- §27 L1290 "in-app notices dispatch through the durable outbox" (requirement NOT covered by the file) | **MISSING** (new row) | No in-app channel in the outbox; every in-app `Notification` is created inline in routes/services (`prisma.notification.create`, 10+ sites in this area). | `comms_outbox.sql:24`; e.g. `deals/[dealId]/action/route.ts:107,121,193,207`; `acquisition-comms.ts:434-452`.
- §27.1 Registration submitted (1300) | PARTIAL (confirmed, path traced) | Signup path calls `sendWelcomeEmail` (R1) from a server action; resend path from the route. | `lib/auth/actions.ts:398`; `app/api/auth/resend-verification/route.ts:154`.
- §27.1 Verification completed (1301) | UNVERIFIED → **PARTIAL** | `sendEmailVerifiedEmail` (R1, request-bound) is called from the auth callback. | `app/auth/callback/route.ts:8,184`.
- §27.1 Guest capture (1303) | UNVERIFIED → **PARTIAL** | Pre-checkout touches mint a single-use hashed resume token and send a claim/resume link — but only on R4 (`lifecycle_touch_schedule`, flag-gated) / R3 `form-submitted` job. | `lib/services/crm/lifecycle-touch-drain.service.ts:46-52` (`issueResumeToken` → `/api/public/request/resume/${rawToken}`); `lib/services/buyer/request-resume-token.service.ts`.
- §27.1 Draft abandoned four-touch (1304) | PARTIAL (stands) — evidence corrected | The buyer four-touch sequence exists: `form_submitted, check_form_completion_1..3` (R4 `PRE_CHECKOUT_SEQUENCES`, or R3 QStash by default), cancelled at checkout by `cancelPreCheckoutTouches`. Not on `comms_outbox`. | `lifecycle-touch-drain.service.ts:632-634, 640-660`; `lib/services/crm/lifecycle-scheduler.ts:9` (flag OFF → QStash).
- §27.1 $99 unpaid six-touch (1312) | PARTIAL (confirmed) | `deposit_reminder_1..6` R4; cancelled on deposit paid. | `lifecycle-touch-drain.service.ts:612-615, 599-628`; `stripe/route.ts:249-252`.
- §27.1 Payment failed (1315) | UNVERIFIED → **BROKEN** | A failed **deposit** produces no buyer communication on any channel; a failed **fee** produces in-app only. Spec: "truthful failure and retry path". | `app/api/webhooks/stripe/route.ts:613-637`.
- §27.1 Auction nearing zero offers (1325) | UNVERIFIED → **PARTIAL** | `checkSLAs` (cron `sla-check`, every 30 min) writes a `SYSTEM_ALERT` for every ACTIVE auction closing <2h with 0 offers — **without dedup**, so the same auction re-alerts every tick; no owner/deadline. | `lib/services/monitoring/health.service.ts:509-524`; `vercel.json:116-117`.
- §27.1 Standard plan confirmed (1346) | MISSING → **BROKEN** | There is no "Standard" path in the deal ladder — the fee stage is mandatory (see §26 #43), so "nothing further is due" is false for every deal. | `deal.service.ts:17-20`; `service-fee.service.ts:104`.
- §27.1 Premium balance required (1347) | PARTIAL (stands) — evidence corrected | Not only the admin manual send-link: the seam emits in-app (+ flag-gated SMS) "Concierge service fee due" on `FEE_PENDING`; no automatic email with the secure link. | `acquisition-comms.ts:123-131`; `app/api/admin/payments/concierge-fee/send-link/route.ts:100`.
- §27.1 Premium balance failed (1349) | UNVERIFIED → **PARTIAL** | In-app only; no Finance, no retry instruction/reversion date. | `stripe/route.ts:625-637`.
- §27.1 Buyer signatures completed → dealership (1363) | PARTIAL (stands) — "dealer execution request absent" corrected | A deduped dealer **in-app** notice IS created after buyer signature (key `esign-executed:${dealId}:${envelopeId}`), but it announces "contract EXECUTED" rather than requesting dealer execution, and there is no dealer email. | `lib/services/esign/buyer-signing.service.ts:888-910`.
- §27.1 Fully executed stored (1364) | UNVERIFIED → **PARTIAL (gated OFF)** | `esign-artifact-reconcile` re-drives `finalizeSignedContract` (executed artifact, certificate, buyer/dealer confirmations) every 5 min, but the whole sweep is behind `ESIGN_EXECUTED_ARTIFACT_ENABLED` (default OFF; schema deliberately unapplied). This also resolves the file's open question: the reconcile *would* re-send `contract-signed` (R1, idempotent) — but not in production today. | `app/api/cron/esign-artifact-reconcile/route.ts:1-12`; `lib/services/esign/esign-schema-gate.ts:37`; `buyer-signing.service.ts:876-884`.
- §27.1 Pickup rescheduled (1369) | UNVERIFIED → **MISSING** | `scheduling.service.ts` sends nothing and does not touch the QR (`rg "qrCode|generatePickupQr|notification"` → none). | `lib/services/pickup/scheduling.service.ts`.
- §27.1 Losing offers (1332) | ALREADY CORRECT → **PARTIAL** | Durable and round-keyed, yes — but the dispatcher only scans deals created in the last 7 days and, after 4 failed attempts, stamps the marker and abandons with a log line (no Operations record). A deal outside the window with a null marker is never dispatched. | `lib/services/deal/dealer-award-dispatch.service.ts:31,38,50,106-118`.
- §27.1 Vehicle Request submitted (1311) | DUPLICATED (confirmed) | `sendVehicleRequestConfirmation` (R2, no key) and `sendVehicleRequestReceived` (R1 `request-received-${requestId}`) both fire in the same request. | `app/api/public/request-vehicle/route.ts:656,663`; `resend.service.ts:978`.
- §27.1 Dealer invitation reminder (1322) | DUPLICATED (confirmed) | Both crons call `sendDealerAuctionReminderEmail`; same key `dealer-auction-reminder-${auctionId}-${to}` — EmailSendLog dedup is what prevents a double send (preserve). | `app/api/cron/auction-close/route.ts:76`; `dealer-invitation-reminder/route.ts:100`; `resend.service.ts:1618`.
- §27.1 Contract approved (1360), Pickup confirmed (1367), Deal completed (1373), Auction launched (1320) | DUPLICATED (confirmed) | Sites re-opened as cited; `deal-complete` also raw-Resend in the scan route with no key. | `contract-shield.service.ts:368` + `contract-shield/[reviewId]/route.ts:131`; `pickup-notifications.service.ts:177` + `pickup/schedule/route.ts:100,108`; `deals/[dealId]/action/route.ts:116`, `pickup/complete/route.ts:99`, `dealer/pickup/scan/route.ts:125-134`; `stripe/route.ts:293` + `app/api/jobs/auction-active`.
- §27.1 Offers ready Premium mention (1326) | PARTIAL (confirmed) | No `premium` string in the offers-ready template (only dealer-invitation, admin-payment-link, dealer-weekly-scorecard, dealer-application-approved templates mention it). | `rg -i premium lib/services/email/templates -l`.

### §28.3 Universal transition controls (L1423-1437)

- §28.3 #3 Conditional write | ALREADY CORRECT → **PARTIAL** | CAS holds for `Deal.status` only. Material transitions outside the seam are unconditional `update`s: auction CANCELLED (admin action, pause), auction ACTIVE (resume), `VehicleRequest.status` CANCELLED (buyer route), `Pickup.status` COMPLETED in the scan route after the deal advance. | `auctions/[auctionId]/action/route.ts:176`; `admin-buyer-command-center.service.ts:873-876, 905-908`; `buyer/requests/[requestId]/cancel/route.ts:28`; `dealer/pickup/scan/route.ts:108-112`.
- §28.3 #5 Idempotency | PARTIAL (stands) — add | The comms idempotency guard is **fail-open twice**: no guard at all when service-role env is absent (`getGuardSupabase` → null), and "proceed" when the insert throws; the ledger is stamped `completed` regardless of SMS outcome even though `updateIdempotencyState` supports `"failed"`. | `acquisition-comms.ts:407-419, 468-478, 497-500`; `lib/jobs/idempotency.ts:102-106`.
- §28.3 #6 Audit | ALREADY CORRECT (deal) → **PARTIAL** | The `DealStatusHistory` write is swallowed (`.catch(()=>{})`), so a failed audit row is invisible; buyer request cancel records no reason; dealer-scan completion has no admin/dealer audit beyond the history row. Admin routes do write `adminAuditLog` (confirmed at `deals/[dealId]/action/route.ts:233`, `auctions/[auctionId]/action/route.ts:233`). | `deal.service.ts:167-176`; `buyer/requests/[requestId]/cancel/route.ts:29-31`.
- §28.3 #2 Validation | PARTIAL (confirmed) | `isPrequalValid` is consumed by buyer pages, deposit create-intent and journey-status only — never by `deal.service.ts` or `offer.service.ts`. | `rg isPrequalValid -l` → `lib/constants.ts, app/buyer/*, app/api/buyer/deposit/create-intent/route.ts, app/api/buyer/journey-status/route.ts`.
- §28.3 L1435 [BUILT] seam | ALREADY CORRECT (with caveats) — caveat added | The seam is bypassable from the admin UI: `DEAL_STAGE_ADVANCED` accepts any `DealStatus` (including CANCELLED/REFUNDED) with an optional `force` that skips both the legality table and the insurance gate; a `force` transition is only distinguishable by the `"force override"` reason string. | `deals/[dealId]/action/route.ts:59-72`; `deal.service.ts:129-138,174`.

### §29 Safeguards (L1438-1462)

- §29 "Offer arithmetic and the approved budget checked server-side" | PARTIAL → **VERIFIED** | The file's claim "arithmetic is a warning only" is wrong: `submitOffer` calls `assertOtdComponentsMatch` (throws on mismatch beyond `OTD_SUM_TOLERANCE_CENTS = 1`) and `assertWithinBuyerBudget` (throws above `maxOtdAmountCents`) before the transaction; `offer-validation.service` also sets `valid=false` on a mismatch. Caveat to record (weaker than spec): `assertWithinBuyerBudget` silently passes when the buyer has **no** prequal row (`if (!prequal) return;`). | `lib/services/offer/offer.service.ts:17-19,39-55,68-74`; `lib/services/offer/otd.ts:9,18`; `offer-validation.service.ts:21-24`.
- §29 "provider-side duplicate-charge checks on both the deposit and the Premium fee" | PARTIAL → **VERIFIED** | "Premium as a product does not exist" is wrong — the concierge fee is the Premium fee (`$499`/`$400` constants). The fee path searches Stripe for an existing PI and uses idempotency key `concierge-fee-${dealId}`; the deposit path blocks on an existing PENDING/PAID deposit. | `lib/constants.ts:7-8`; `lib/services/deal/service-fee.service.ts:89,114,141`; `app/api/buyer/deposit/create-intent/route.ts:88-93`.
- §29 "Auction close atomic claim + reprocess" | VERIFIED (stands) — **evidence corrected** | The cited `auction.service.ts:18-50` is `createAuction`/`launchAuction`, not the claim. The claim is `processAuctionClose` (`updateMany WHERE postCloseProcessedAt IS NULL`) and the cron reprocesses every CLOSED auction with a null marker. | `lib/services/auction/auction.service.ts:109-135, 208`; `app/api/cron/auction-close/route.ts:26-41`.
- §29 "Pickup emails dispatch durably with round-specific keys" | VERIFIED (confirmed) | Five producers via `enqueueTransactionalEmail`, keys carry `roundKey`; the SLA nudge cron reuses two of them. | `pickup-notifications.service.ts:105,142,177,215,253`; `pickup-sla.service.ts:12,37`.
- §29 "Anti-circumvention … Operations routing" | PARTIAL (confirmed) | see §26 #42.
- §29 (HTML) scorecard consequences | MISSING (confirmed) | Scorecard computes invitations/offers/accepted/completed/junk-fee ratio only. | `lib/services/dealer/dealer-scorecard.service.ts:18-37`.

### Requirements in the assigned sections the file did not cover

- §27 L1290 **in-app** through the outbox — MISSING (see above; outbox is email/sms only).
- §27 L1290 **cancellation rule** as a per-row policy — the file notes no cancel *state*; also nothing consumes a "cancel on entity terminal" rule at drain time (no `entity_type/id` columns to key on). MISSING.
- §26 header "**buyer-visible status**" — no exception surface exists for buyers; admin queues are admin-only derived reads. MISSING.
- §24 L1211 scope "**Before contract execution**" — `cancelDeal` and admin cancel are permitted from `SIGNED`/`PICKUP_SCHEDULED` (post-signature) because `canTransition(…, CANCELLED)` allows any non-terminal state; there is no "executed" boundary in code. BROKEN relative to the spec's boundary (`deal.service.ts:66`).
- §28.3 #1 authorization **per transition** — the seam accepts a free-form `actorRole` string; `DEALER` actor can complete a deal via scan; no per-transition role matrix. PARTIAL (`deal.service.ts:73-74`; `scan/route.ts:90`).

### Stronger safeguards found in this pass (preserve)

- Dealer scan resolves pickup by stored `qrCodeData` and enforces `qrExpiresAt` → regenerate = revoke (`scan/route.ts:36-37,65-67`).
- `DEAL_STAGE_ADVANCED`/`DEAL_CANCELLED` require a non-empty reason (`deals/[dealId]/action/route.ts:48-50`); `workflow/cancel` requires `deals.cancel` permission.
- Intake processor / coverage reconciler operate only on `SUBMITTED/INTAKE/ACTIVE_SOURCING` requests.
- `assertOtdComponentsMatch` / `assertWithinBuyerBudget` throw at submission; `postCloseClaimWon` CAS; `MAX_AUTO_EXTENSIONS=6` CAS.
- `sendDealerAuctionReminderEmail` shared key means the duplicated cron producers cannot double-send while `EmailSendLog` holds.
