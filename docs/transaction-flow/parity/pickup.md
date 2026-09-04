# Parity map — PICKUP (Stages 16–21)

Spec: `docs/transaction-flow/AUTOLENIS-COMPLETE-TRANSACTION-FLOW.md` lines 877–1021 · HTML `S[15..20]` lines 678–752.
Repo HEAD 0cd399f · read-only static inspection (no tsc, no tests, no DB). All paths relative to `frontend/` unless prefixed.

## Summary (10 lines)

1. **Scheduling turn-taking is the one genuinely BUILT piece**: `lib/services/pickup/pickup-coordination.service.ts` implements strict turns with a compare-and-swap on `(status, proposedAt)`, a 2-counter cap → `EXCEPTION`, compensating revert of a confirmed pickup when the deal advance fails, and round-specific email idempotency keys — all covered by `__tests__/pickup-coordination.test.ts`.
2. **The release token is BROKEN vs spec**: two generators (`qr.service.ts:5`, `pickup.service.ts:16`) both use `Math.random()`; the plaintext payload is stored in `pickups.qr_code_data` and looked up by equality (`scan/route.ts:36`); "single-use" is only a status check; a buyer reschedule (`scheduling.service.ts:67-74`) does **not** revoke the token; the plaintext token is also returned to the dealer via `getDealerDeals` (`dealer-deals.service.ts:127`), so the dealer never needs the buyer to present anything.
3. **Readiness checklist (Stage 16) is MISSING entirely** — scheduling opens on `eSignEnvelope.status === COMPLETED` + `deal.status === SIGNED` only (`app/api/buyer/pickup/[dealId]/route.ts:54-72`); none of the 13 items is evaluated, no owner/deadline surface exists.
4. **24h/2h appointment reminders are MISSING**; `pickup-sla.service.ts` + `cron/pickup-confirmation-nudge` chase unanswered proposals (24h SLA), exactly as the spec's [NEW] note says.
5. **Handover (Stage 18) evidence, delivery variant, identity/VIN/odometer/trade capture, and changed-appraisal → contract revision are all MISSING**; the dealer "scan" is a pasted text token (`components/dealer/PickupActionsClient.tsx:74-80`) that completes the whole deal in one step.
6. **Buyer possession confirmation (Stage 19) is MISSING and the rule "never completes on the dealer's word alone" is BROKEN**: `scan/route.ts:90` advances the Deal to `COMPLETED` on the dealer action alone.
7. **Completion (Stage 20) is not atomic**: deal CAS advance → separate `$transaction(pickup, activity)` → fire-and-forget direct Resend email with no idempotency key (`scan/route.ts:108-134`). The canonical completion event *is* emitted exactly once at the seam (`deal.service.ts:150-153, 202-204`) but is best-effort (Make webhook via `after()`), not an outbox row. `Deal` has no `completedAt` column. A concurrent second scan that loses the CAS still writes a second `DEAL_COMPLETED` activity event and sends a second email (`advanceDealStatus` returns `false` on the lost race and the route ignores the return).
8. **"Completed is terminal" holds in `canTransition` but is bypassable by admin `force`** (`journey/reopen/route.ts:117-124` forces `COMPLETED → PICKUP_SCHEDULED`; `deals/[dealId]/action/route.ts:65-70` forces any status); no append-only correction model exists.
9. **Post-completion obligations (Stage 21) and every scorecard consequence hook (no-shows, contract delays, overdue obligations) are MISSING**; `computeDealerScorecard` knows only win/completion/response/junk-fee rates.
10. **Duplication is heavy**: 2 QR generators, 5 completion writers (dealer scan, admin pickup/complete, admin action, journey complete, journey complete-all) plus a dead `completePickup`, 3 completion-email senders, 2 check-in routes, `DealStatusHistory` vs an unused `DealTimeline`.

Status legend: ALREADY CORRECT · PARTIAL · BROKEN · MISSING · DUPLICATED · UNVERIFIED.

---

## Rows

### Stage 16 — Pickup readiness (L877–903)

**R16.1** · spec_ref: §16 Entry L879 · requirement: entry = contract executed, financing completed, funding cleared, insurance verified
- status: PARTIAL
- current: buyer proposal route gates on e-sign + SIGNED only. `app/api/buyer/pickup/[dealId]/route.ts`, `lib/services/pickup/pickup-coordination.service.ts::proposePickup`
- evidence: `app/api/buyer/pickup/[dealId]/route.ts:54` `if (deal.eSignEnvelope?.status !== "COMPLETED")`; `:66` `if (deal.status !== "SIGNED")`; `pickup-coordination.service.ts:185-193` (ownership, pickup state, availability only). Insurance checked only at completion: `deal.service.ts:134-138`, `scan/route.ts:76`.
- stronger safeguard: none beyond e-sign gate.
- required change: add a readiness evaluator (service under `lib/services/pickup/`) that checks executed contract (ESignEnvelope COMPLETED), `Financing.status`/cash path, funding cleared fact, `INSURANCE_SATISFIED`, and refuse `proposePickup` until all pass.
- legacy path: admin `schedulePickup` (`pickup.service.ts:21-65`) has no readiness gate and `force: true` advances from any status.
- notes: spec [NEW] marker accurate.

**R16.2** · §16 checklist L881–895 item 1 "Correct vehicle and VIN confirmed" · MISSING · current: none (Pickup has no vehicle/VIN fields; `prisma/schema.prisma:826-855`) · evidence: `schema.prisma:826-855` (Pickup model fields) · required change: readiness item + VIN binding on Deal/Pickup.

**R16.3** · item 2 "Vehicle remains available" · MISSING · current: none; no inventory/availability re-check in pickup services · evidence: `pickup-coordination.service.ts:178-222` (no inventory lookup) · required change: readiness check against InventoryItem/offer vehicle status (owned by inventory skill).

**R16.4** · item 3 "Final contract fully executed and stored" · PARTIAL · current: e-sign COMPLETED gate at proposal only · evidence: `app/api/buyer/pickup/[dealId]/route.ts:54-60` · required change: include as readiness item with executed-artifact presence (ESignEnvelope executed evidence) and re-check at completion.

**R16.5** · item 4 "Financing completed or cash confirmed" · MISSING · current: `Financing.status` exists (`schema.prisma:2059-2071`) but never consulted by pickup · evidence: no `financing` reference in `lib/services/pickup/*` (grep) · required change: readiness item.

**R16.6** · item 5 "Funding cleared" · MISSING · current: no funding-cleared fact on Deal/Financing (`schema.prisma:574-616`, `2059-2071`) · required change: field + readiness item (owned by deal-lifecycle/payments).

**R16.7** · item 6 "Down-payment arrangement confirmed" · MISSING · current: none · evidence: schema grep (no down-payment field) · required change: readiness item.

**R16.8** · item 7 "Insurance verified or policy bound" · PARTIAL · current: enforced at completion, not at readiness · evidence: `deal.service.ts:41-45` INSURANCE_SATISFIED; `:134-138` gate; `scan/route.ts:76-82` · stronger safeguard: gate re-checked at write time inside the seam (`deal.service.ts:134`) — preserve · required change: also evaluate at readiness so the buyer sees it before scheduling.

**R16.9** · item 8 "Trade packet ready, title and payoff status current" · MISSING · current: `TradeInSubmission` has no `dealId`, no title/payoff-doc status (`schema.prisma:2036-2057`) · required change: link trade to Deal, add packet-ready fields, readiness item.

**R16.10** · item 9 "No payment dispute, cancellation, or other hold" · PARTIAL · current: cancellation guarded via `CONFIRMABLE_DEAL_STATUSES` and `canTransition`; no hold/dispute model · evidence: `pickup-coordination.service.ts:78,233,301`; `deal.service.ts:26-33`; `app/api/cron/holds/route.ts:9-13` is a no-op reconciler (`released: 0, autoRefundsDisabled: true`) · required change: hold/dispute fact + readiness item.

**R16.11** · item 10 "Dealership confirms vehicle preparation is complete" · MISSING · current: only an email nudge line "Ensure vehicle is clean and ready" (`lib/services/email/templates/dealer-pickup-scheduled.tsx:81`) · required change: dealer-side prep confirmation action + field.

**R16.12** · item 11 "Promised equipment, keys, accessories present" · MISSING · current: none · required change: dealer checklist fields.

**R16.13** · item 12 "Promised repairs and due-bill items documented" · MISSING · current: none (no due-bill model; grep `due.?bill` → 0 hits) · required change: due-bill records (feeds Stage 21).

**R16.14** · item 13 "Dealership delivery documents ready" · MISSING · current: none · required change: dealer checklist field.

**R16.15** · §16 L897 "*Current pickup coordination evaluates none of these*" [NEW] · ALREADY CORRECT (as a statement) · evidence: `pickup-coordination.service.ts:185-193` · notes: confirmed accurate.

**R16.16** · §16 L881 "website shows the exact unresolved item and the party responsible" · MISSING · current: buyer page shows only unsigned/propose/waiting states (`app/buyer/pickup/page.tsx:70-99`) · required change: readiness panel listing each item, owner, status.

**R16.17** · §16 Exit L899 "All items true; Deal moves to scheduling" · MISSING · current: scheduling opens on SIGNED (see R16.1) · required change: gate `proposePickup` on readiness result.

**R16.18** · §16 If it fails L901 "each unmet item has a named owner, buyer-visible status, required action, deadline; nothing scheduled while unmet" · MISSING · current: none · required change: readiness item records with owner/action/deadline; block scheduling.

### Stage 17 — Scheduling (L907–925)

**R17.1** · §17 Entry L909 "Pickup readiness complete" · MISSING · current: entry is SIGNED + e-sign COMPLETED (`app/api/buyer/pickup/[dealId]/route.ts:54-72`) · required change: depends on R16.17.

**R17.2** · §17 L912 "buyer proposes a time and location within the dealership's availability" · ALREADY CORRECT · current: `proposePickup` → `checkPickupTime` → `isWithinAvailability` (lead time, advance limit, blackout, weekday windows, dealer TZ) · evidence: `pickup-coordination.service.ts:192-193`; `availability.service.ts:163-219, 294-301`; location min 5 chars `route.ts:23` · stronger safeguard: buyer path has **no** override (`scheduling.service.ts:34-37`; test `reschedule-route.test.ts:110`); DST-correct TZ via Intl (`availability.service.ts:125-134`) — preserve.

**R17.3** · §17 L912 "dealership confirms or counters" · ALREADY CORRECT · current: `confirmPickup` (PROPOSED→SCHEDULED), `counterAsDealer` (PROPOSED→DEALER_COUNTERED) · evidence: `pickup-coordination.service.ts:225-250, 253-290`; routes `app/api/dealer/pickup/[dealId]/confirm/route.ts:32`, `propose/route.ts:69` · stronger safeguard: dealer isolation returns NOT_FOUND for foreign deal (`:232,262`; test `pickup-coordination.test.ts:266`).

**R17.4** · §17 L912 "buyer accepts or counters" · ALREADY CORRECT · current: `acceptCounter`, `counterAsBuyer` · evidence: `pickup-coordination.service.ts:293-319, 322-357`; routes `app/api/buyer/pickup/[dealId]/accept/route.ts:109`, `counter/route.ts:146`.

**R17.5** · §17 L912 "After two unsuccessful counter rounds, Operations schedules directly" · PARTIAL · current: `MAX_PICKUP_COUNTERS = 2`; the counter attempted at `counterCount >= 2` escalates to `EXCEPTION` + SYSTEM_ALERT notification; admin then uses `POST /api/admin/deals/[dealId]/pickup/schedule` (upsert + forced advance) · evidence: `pickup-coordination.service.ts:32, 266-268, 333-335, 360-376`; `pickup-notifications.service.ts:268-280`; `app/api/admin/deals/[dealId]/pickup/schedule/route.ts:56-67`; `pickup.service.ts:27-49` · gaps: (a) `counterCount` counts every counter action by either side, so "two rounds" = 2 counters total, not 2 full buyer↔dealer rounds — owner to confirm intent; (b) admin queue `PICKUP_EXCEPTION` lists stale `PICKUP_SCHEDULED` deals (>7d), not `EXCEPTION` pickups (`lib/services/admin/admin-queue.service.ts:25-29`); admin pickups list has no EXCEPTION filter (`app/admin/pickups/page.tsx:17,51`) · required change: surface `PickupStatus.EXCEPTION` in the Ops queue; confirm round semantics · legacy path: admin schedule writes SCHEDULED from any pickup status incl. EXCEPTION via upsert (`pickup.service.ts:38-45`).

**R17.6** · §17 L912 "Turn-taking is strict, each action conditional on the current turn" [BUILT] · ALREADY CORRECT · evidence: every mutation is `updateMany({ where: { dealId, status: <expected>, proposedAt: expectedProposedAt } })` — `pickup-coordination.service.ts:240-244, 274-285, 308-312, 341-352, 365-369`; comment `:9-14`.

**R17.7** · §17 L912 "a stale or duplicate action is refused without side effects" [BUILT] · ALREADY CORRECT · evidence: `res.count !== 1 → CONFLICT` before any notification (`:244, 285, 312, 352, 369`); routes map to 409 (`:44-52`); tests `pickup-coordination.test.ts:163-215, 277-291` ("stale proposedAt loses even when the status still matches") · stronger safeguard: CAS on `proposedAt` (client must echo the observed token — `confirm/route.ts:12-16`) — preserve.

**R17.8** · §17 L912 (implicit) confirm side effects are compensated · ALREADY CORRECT (stronger than spec) · evidence: `settleConfirmation` reverts SCHEDULED→prior status, restores `proposedAt`, clears QR when `advanceDealStatus` throws (`pickup-coordination.service.ts:149-171`); pre-check `CONFIRMABLE_DEAL_STATUSES` (`:74-78`); tests `:298-316` · notes: preserve.

**R17.9** · §17 L914 "generate a cryptographically secure, expiring, single-use release token" · BROKEN + DUPLICATED
- current: two generators. (1) `lib/services/pickup/qr.service.ts:5` `nonce: Math.random().toString(36).slice(2)` (used by coordination confirm `pickup-coordination.service.ts:115`); (2) `lib/services/pickup/pickup.service.ts:11-19` `nonce: \`${Date.now()}_${Math.random().toString(36).slice(2)}\`` (used by admin `schedulePickup:22` and `regenerateQr:71`). Payload = JSON `{type,dealId,pickupId,issuedAt,nonce}` stored **plaintext** in `pickups.qr_code_data` and rendered as a data-URL image.
- expiry: `qrExpiresAt = scheduledAt + 48h` (`pickup-coordination.service.ts:54,118`; `pickup.service.ts:36,44`); `regenerateQr` → `now + 48h` (`pickup.service.ts:79`); enforced at `scan/route.ts:65-67`.
- single-use: only via `pickup.status === "COMPLETED" || deal.status === "COMPLETED"` (`scan/route.ts:69-71`); no `consumedAt`, no hash, no revocation table. `validateQrPayload` (`qr.service.ts:10-15`) has **no callers** (dead).
- lookup: `prisma.pickup.findFirst({ where: { qrCodeData: qrToken } })` (`scan/route.ts:36-37`) — plaintext equality on a column with no index.
- the route's own comment admits weakness: `scan/route.ts:51-53` "the QR nonce is not cryptographically strong (Math.random + a timestamp)".
- token exposure: plaintext `qrCodeData` is selected into the dealer's deal list (`lib/services/dealer/dealer-deals.service.ts:57,127`) → dealer can complete without buyer presenting.
- stronger safeguard: expiry bound to appointment; ownership check before validity oracle (`scan/route.ts:44-62`).
- required change: single generator using `crypto.randomBytes(32)`; store SHA-256 hash only (pattern exists: `DealerAccountClaimToken.tokenHash`, `schema.prisma:3686-3694`), `consumedAt`, indexed hash lookup, delete dead `validateQrPayload`, remove `qrCodeData` from dealer-facing selects.
- legacy path: admin regenerate-qr routes (`app/api/admin/deals/[dealId]/pickup/regenerate-qr/route.ts`, `app/api/admin/pickups/[pickupId]/regenerate-qr/route.ts`) both call `regenerateQr`.

**R17.10** · §17 L914 "Any schedule change revokes the prior token and issues a new one" · BROKEN · current: buyer reschedule updates `scheduledAt/status/location` only — token and `qrExpiresAt` untouched (`scheduling.service.ts:67-74`); admin `schedulePickup` regenerates on upsert (`pickup.service.ts:38-45`); compensation clears QR (`pickup-coordination.service.ts:166`) · evidence: as cited · required change: reschedule seam must null/rotate token and reset expiry to new `scheduledAt + TTL`; add revocation history (HTML S17 rec "revocation history") · legacy path: `PATCH /api/buyer/pickup/[dealId]` (`route.ts:101-148`).

**R17.11** · §17 L916 "Reminders at 24 hours and 2 hours" [NEW] · MISSING · current: `runPickupConfirmationNudges` nudges dealer on aged PROPOSED and buyer on aged DEALER_COUNTERED (24h SLA, one nudge per round) — not appointment reminders · evidence: `lib/services/pickup/pickup-sla.service.ts:37-89`; `PICKUP_CONFIRM_SLA_HOURS = 24`, `PICKUP_ACCEPT_SLA_HOURS = 24` (`pickup-coordination.service.ts:33-34`); cron hourly `vercel.json:28-29`, `cron-schedule.ts:61` · required change: new scan over `SCHEDULED/RESCHEDULED` with `scheduledAt` in [now+24h] / [now+2h] windows, marker columns per window, enqueue via `enqueueTransactionalEmail` (outbox) with keys `pickup-reminder-24h-${dealId}-${scheduledAt.toISOString()}` etc. · notes: spec statement accurate; the outbox rail (`lib/services/comms/comms-outbox.service.ts:94-139`, drain `vercel.json:244-245` every minute) already exists for durable delivery.

**R17.12** · §17 L916 reminder contents: time+location; government ID for buyer and co-buyer; insurance reminder; down-payment/funding instructions + accepted methods; trade instructions (title, keys, payoff docs); release-token instructions; rescheduling contact · MISSING · current: buyer gets PICKUP_SCHEDULED in-app+SMS with a QR link (`acquisition-comms.ts:208-216`; `pickup-coordination.service.ts:129-141`) and admin path `sendPickupReadyEmail` (`admin .../pickup/schedule/route.ts:100`); dealer gets `dealer-pickup-scheduled` template (`pickup-notifications.service.ts:157-192`) · required change: new buyer/dealer reminder templates with the seven content blocks.

**R17.13** · §17 Exit L918 "Confirmed appointment with a live token" · PARTIAL · current: SCHEDULED + QR issued on confirm/accept (`pickup-coordination.service.ts:115-119`) but token weak (R17.9).

**R17.14** · §17 If it fails L920 "missed pickup returns to scheduling with a new proposal round and revoked token" · MISSING · current: no no-show detection, no `NO_SHOW` status (`PickupStatus` enum `schema.prisma:1583-1592`), reschedule keeps token (R17.10), reschedule of a SCHEDULED pickup bypasses the proposal round (`scheduling.service.ts:6-15` deliberately excludes coordination states) · required change: no-show marking (dealer/buyer/admin) → revoke token → reset to PROPOSED round with `counterCount` reset.

**R17.15** · §17 L920 "Repeated no-shows escalate to Operations and register on the dealership scorecard where the dealership is at fault" · MISSING · current: scorecard = win rate, completion rate, response rate, avg response hours, junk-fee ratio (`lib/services/dealer/dealer-scorecard.service.ts:21-45`); snapshot columns `schema.prisma:1255-1269`; no fault attribution anywhere · required change: no-show fault record + scorecard dimension + snapshot column.

**R17.16** · HTML S17 dealer "Publish availability" / tables `dealer_availability` · PARTIAL · current: `DealerAvailability`/`Window`/`BlackoutDate` models + migration `20260930000000_add_dealer_availability` exist and the resolver reads them (`availability.service.ts:245-286`), but **no route or UI writes them** (repo grep for `dealerAvailability.(upsert|update|create)` → 0 hits outside tests); all dealers fall back to ZIP-derived TZ + Mon–Sat 9–18 defaults (`:277-285`) · required change: dealer availability editor + `app/api/dealer/availability` route.

**R17.17** · HTML S17 rec "reminder dispatch" recorded · MISSING (see R17.11) · notes: proposal-nudge markers exist (`proposedReminderSentAt`, `counterReminderSentAt`, `schema.prisma:844-846`) — reuse the pattern.

**R17.18** · §17 (implicit, area deliverable) round-specific idempotency keys for pickup emails · ALREADY CORRECT · evidence: `pickup-notifications.service.ts:82` `roundKey = proposedAt ISO`; keys `pickup-proposed-${dealId}-${roundKey}` (`:117`), `pickup-countered-…` (`:151`), `pickup-proposed-reminder-…` (`:228`), `pickup-countered-reminder-…` (`:262`); `dealer-pickup-scheduled-${dealId}` (`:189`) is per-deal (one confirmation) · stronger safeguard: reminder keys distinct from initial send (`:227`) — preserve.

### Stage 18 — Handover (L929–975)

**R18.1** · §18 Entry L931 "Scheduled appointment, live token" · PARTIAL · current: scan accepts any pickup whose `qrCodeData` matches; pickup status is not required to be SCHEDULED/CHECKED_IN (only "not COMPLETED", `scan/route.ts:69`); deal must be PICKUP_SCHEDULED/PICKUP_COMPLETE via `canTransition` (`deal.service.ts:29-30`) · required change: require pickup ∈ {SCHEDULED, RESCHEDULED, CHECKED_IN}.

**R18.2** · §19a L937 "Authenticates into AutoLenis" · ALREADY CORRECT · evidence: `scan/route.ts:29-30` `getRequestDealer`; test `scan-route.test.ts:133`.

**R18.3** · §19a L938 "Scans the release token and confirms Deal ownership and token validity" · PARTIAL · current: ownership `pickup.deal.offer?.dealerId !== dealer.id → 422` (`scan/route.ts:54-62`), uniform response for foreign/concierge (anti-oracle, `:44-53`), expiry (`:65-67`), already-scanned (`:69-71`); UI is a text input "Paste QR token..." (`components/dealer/PickupActionsClient.tsx:74-80`), no camera; token also served to the dealer (R17.9) · stronger safeguard: IDOR test `scan-route.test.ts:146`; concierge deals can never be dealer-scanned (`:155`) — preserve · required change: real scan UX; hashed token; stop exposing `qrCodeData` to dealers.

**R18.4** · §19a L939 "Verifies the buyer's and any co-buyer's identity against its contract" · MISSING · current: no identity/co-buyer capture on Pickup or Deal; `IdentityVerificationStatus` enum exists (`schema.prisma:1950-1954`) but not used at handover (grep in pickup/deal/esign → 0) · required change: handover identity attestation fields.

**R18.5** · §19a L940 "Confirms VIN, mileage, and vehicle condition" · MISSING · current: none · required change: `vinConfirmed`, `odometerAtRelease`, `conditionAtRelease` on the release record.

**R18.6** · §19a L941 "Completes its own inspection and delivery process" · MISSING.

**R18.7** · §19a L942 "Collects amounts payable directly to the dealership and records the method" · MISSING · notes: platform rule "never buyer↔dealer direct" applies to AutoLenis fees only; dealer-collected amounts are a record, not a ledger entry.

**R18.8** · §19a L943 "Receives and inspects the trade-in" · MISSING · current: `TradeInSubmission` is buyer-scoped, no `dealId` (`schema.prisma:2036-2057`).

**R18.9** · §19a L944 "Receives trade keys, title, and payoff documents" · MISSING.

**R18.10** · §19a L945 "Confirms the final trade allowance and payoff handling" · MISSING · current: `valuationCents` only (`schema.prisma:2051`).

**R18.11** · §19a L946 "Provides vehicle keys, accessories, and all dealership documents" · MISSING.

**R18.12** · §19a L947 "Records any unresolved due-bill commitments" · MISSING.

**R18.13** · §19a L948 "Records dealer release evidence" · MISSING · current: release and completion collapsed into one scan (`scan/route.ts:90, 108-121`); only `pickup.completedAt` + `DealStatusHistory` row (`deal.service.ts:167-176`) + `BuyerActivityEvent DEAL_COMPLETED` · required change: separate "dealer release recorded" step/status (e.g. `RELEASED`) with evidence fields; completion moves to Stage 20.

**R18.14** · §19a L950 "The buyer inspects the vehicle before signing the final delivery acknowledgment" · MISSING · current: no buyer acknowledgment artifact.

**R18.15** · §19b L954 Delivery variant (deliver to address, ID at delivery point, token scanned at delivery, odometer at delivery, trade surrendered) · MISSING · current: `Pickup.location` free text (`schema.prisma:832`); no pickup/delivery mode; grep `delivery` in pickup code → 0 relevant hits · required change: `fulfillmentMode` (PICKUP|DELIVERY) + delivery address + same release checklist.

**R18.16** · §19b L954 "Delivery does not lower any release condition" · MISSING (depends on R18.15).

**R18.17** · §19c L958 "changed trade appraisal must be disclosed to and accepted by the buyer; if it changes the contract, return to contract revision and execution" · MISSING · current: `TradeInStatus` SUBMITTED→REVIEWING→VALUED→ACCEPTED/DECLINED (`schema.prisma:1766-1772`), no appraisal-change event, no link to `ContractVersion`; grep `appraisal|allowance` in deal/trade-in/contract services → 0 · required change: appraisal-change record → buyer acceptance → `advanceDealStatus` back to CONTRACT_PENDING (legal via `CONTRACT_REVIEW → CONTRACT_PENDING` only; a `PICKUP_SCHEDULED → CONTRACT_PENDING` edge must be added to `canTransition` with a failing-first test).

**R18.18** · §18 Recorded L960 (token consumption, identity, VIN/odometer, condition, funds+method, trade received, due-bill, release evidence) · PARTIAL · current: only `pickup.status/completedAt` (`scan/route.ts:109-112`) and activity event (`:113-120`) · required change: release evidence record (see R18.13).

**R18.19** · §18 If it fails L962 "identity mismatch, unavailable vehicle, unfunded, failed insurance, changed contract, unmet condition **blocks handover** and creates an urgent exception with an owner and immediate buyer and dealership notification" · PARTIAL · current: insurance block (`scan/route.ts:76-82` and seam `deal.service.ts:134-138`, test `scan-route.test.ts:179,188`), illegal transition block (`:92-94`); no exception record, no owner, no buyer/dealer notification on block · required change: exception record + notifications on every blocked scan.

**R18.20** · HTML S18 system "Validate the token exactly once" · BROKEN (concurrency) · current: pre-check `:69-71` is not atomic; `advanceDealStatus` CAS makes the **deal** transition exactly-once (`deal.service.ts:150-165`), but on a lost race it returns `false` **without throwing** (`:160-164`), and the scan route ignores the return value → the losing scan still runs `$transaction` (`:108-121`, writes pickup COMPLETED again + a second `DEAL_COMPLETED` activity event) and sends a second completion email (`:126-134`) · evidence: `deal.service.ts:155-164` ("report 'did not move' rather than throwing"); `scan/route.ts:90-121` · required change: consume the token atomically (`updateMany where consumedAt IS NULL`) and branch on `advanceDealStatus`'s boolean · notes: static reasoning; UNVERIFIED at runtime.

**R18.21** · HTML S18 rec/tables `documents` "Full release evidence on the pickup and Deal records" · MISSING (see R18.13/R18.18).

### Stage 19 — Buyer possession confirmation (L979–996)

**R19.1** · §19 Entry L981 "Dealer release recorded" · MISSING (no release step; R18.13).

**R19.2** · §19 L984 buyer records: vehicle received; VIN match; odometer; condition; keys/accessories; trade surrendered; outstanding due-bill; affirmative possession confirmation · MISSING · current: no route under `app/api/buyer/pickup/**` for confirmation (routes: GET/POST/PATCH schedule, accept, counter — `app/api/buyer/pickup/[dealId]/route.ts`, `accept/route.ts`, `counter/route.ts`); no component (`components/buyer/Pickup{ScheduleForm,RescheduleButton,CounterClient}.tsx` only) · required change: `POST /api/buyer/pickup/[dealId]/possession` + service + fields.

**R19.3** · §19 Recorded L986 "Possession evidence on the Deal" · MISSING · current: Deal has no such fields (`schema.prisma:574-616`).

**R19.4** · §19 Buyer sees L988 "A short confirmation form, available on mobile at the dealership" · MISSING · current: buyer pickup page shows QR + reschedule when confirmed, "Pickup complete!" after dealer scan (`app/buyer/pickup/page.tsx:103-109, 158-208`).

**R19.5** · §19 Exit L990 "Possession affirmatively confirmed with no material discrepancy" · MISSING.

**R19.6** · §19 If it fails L992 "material discrepancy blocks completion and creates an Operations case with the dealership notified" · MISSING · current: no case model (schema grep for Case/Exception/Escalation models → only `FinancingReviewTask`, `schema.prisma:5797`); ops "exception cases" are derived from audit logs (`admin-buyer-command-center.service.ts:134-139`).

**R19.7** · §19 L992 "A dealer release with no buyer confirmation reminds the buyer" · MISSING.

**R19.8** · §19 L992 "**the Deal never completes automatically on the dealer's word alone**" · BROKEN · current: dealer scan alone → `advanceDealStatus(dealId, "COMPLETED", { actorRole: "DEALER" })` (`scan/route.ts:90`); admin force complete (`admin .../pickup/complete/route.ts:69-74`) · required change: scan records release only; completion requires possession confirmation (R19.2) — see R20.1.

### Stage 20 — Completion (L1000–1019)

**R20.1** · §20 Entry L1002 "Dealer release evidence **and** buyer possession confirmation both present" · BROKEN · evidence: `scan/route.ts:84-121` completes on dealer scan; `pickup.service.ts:93-100` `completePickup` (no callers) also completes unilaterally · required change: completion service requiring both evidence records.

**R20.2** · §20 L1004 requirement 1 "One verified buyer and any required co-buyer identified" · MISSING · current: no check at completion (`deal.service.ts:104-215` checks status + insurance only).

**R20.3** · req 2 "Unbroken reference chain Deal → Vehicle Request, payment, sourcing case, auction, selected offer, buyer, vehicle, dealership" · MISSING · current: `Deal.offerId`/`vehicleRequestOfferId` nullable (`schema.prisma:577-578`); concierge deals have no dealer (`scan/route.ts:44-47`); no chain validation.

**R20.4** · req 3 "One confirmed vehicle and VIN bound to the Deal" · MISSING · current: no VIN on Deal/Pickup.

**R20.5** · req 4 "The winning dealership reaffirmed the transaction" · MISSING · grep `reaffirm` → 0.

**R20.6** · req 5 "The final recap confirmed by both parties" · MISSING · grep `recap` → 0.

**R20.7** · req 6 "Financing completed, or cash confirmed" · MISSING at completion (see R16.5).

**R20.8** · req 7 "Funding cleared" · MISSING (R16.6).

**R20.9** · req 8 "AutoLenis fees resolved" · MISSING at completion · current: `feePaidAt` drives the fee ladder earlier (`deal.service.ts:254-…`) but COMPLETED does not re-check it; `dealer-billing.service.ts:68-73` treats COMPLETED with unpaid fee as past-due (so it is expected to happen).

**R20.10** · req 9 "Insurance verified or policy bound" · ALREADY CORRECT · evidence: `deal.service.ts:134-138`, `INSURANCE_SATISFIED :41-45`; scan pre-check `:76-82` · stronger safeguard: only admin `force` may bypass, audited with reason and role-gated (`admin .../pickup/complete/route.ts:30-34, 69-74, 87-93`) — preserve.

**R20.11** · req 10 "The exact approved contract version signed by every required signer" · MISSING at completion · current: e-sign COMPLETED checked only at proposal (`buyer/pickup/[dealId]/route.ts:54`); `ContractScan.contractVersionId` links verdict to version (`schema.prisma:650-652`) but nothing verifies signed-version = approved-version at completion.

**R20.12** · req 11 "The dealership's fully executed contract stored" · PARTIAL · current: executed-artifact availability boolean for dealers (`dealer-deals.service.ts:60-64, 140-146`), gated by schema flag; not a completion precondition.

**R20.13** · req 12 "The vehicle released by the correct dealership" · ALREADY CORRECT (for the dealer-scan path) · evidence: `scan/route.ts:54-62`; test `scan-route.test.ts:146` · notes: admin override path has no dealer involvement by design.

**R20.14** · req 13 "Buyer possession, VIN, mileage, and condition confirmed" · MISSING (R19.2).

**R20.15** · req 14 "No blocking hold or unresolved delivery discrepancy" · PARTIAL · current: cancellation excluded by `canTransition` (COMPLETED only from PICKUP_SCHEDULED/PICKUP_COMPLETE, `deal.service.ts:29-30`); no hold/discrepancy model.

**R20.16** · §20 L1002 "website shows the exact missing checkpoint and the responsible party" · MISSING · current: single-string 409s (`scan/route.ts:77-81, 93, 99-103`).

**R20.17** · §20 Atomically L1021 "mark pickup complete; mark the Deal COMPLETED; record completion time; emit the canonical completion event exactly once [BUILT — seam exists]; queue buyer and dealership completion communications durably; preserve executed contract, receipt, recap, full history" · BROKEN / PARTIAL
- sequence (dealer scan): (1) `advanceDealStatus` CAS `updateMany where status=deal.status` (`deal.service.ts:150-153`) → history row `.catch(()=>{})` (`:167-176`) → activity `.catch` (`:179-186`) → `emitDealStatusComms` (`:194`, idempotency ledger, in-app **skipped** for COMPLETED per `INAPP_OWNED_BY_CALLERS`, `acquisition-comms.ts:303-304`, SMS sent) → `emitDealCompletionEvent` (`:202-204`) → (2) separate `prisma.$transaction([pickup.update, buyerActivityEvent.create])` (`scan/route.ts:108-121`) → (3) direct `resend.emails.send(...).catch(() => {})` inline HTML, **no idempotency key, not via outbox** (`scan/route.ts:123-134`).
- atomic? **No** — three independent writes; a crash between (1) and (2) leaves Deal COMPLETED with pickup not COMPLETED; no `Deal.completedAt` column (only `Pickup.completedAt`, `schema.prisma:831`; `DealStatusHistory.createdAt`).
- canonical event exactly-once: **yes structurally** (CAS + terminal state, `deal-completion-event.service.ts:4-9`) but **best-effort**: `try/catch` never throws (`:23-55`), forwards to Make via `after()` (`lib/events/emit.ts:198-212`) and skips silently if no buyer (`:31`); not persisted to an outbox → an emit failure is lost.
- durable comms: buyer email on scan path = best-effort direct Resend; admin path uses `sendDealCompleteEmail` → `sendIdempotent` (EmailSendLog precheck + direct Resend, `resend.service.ts:129-175, 886-895`) — idempotent but not retried; dealer completion/payout emails only on the admin path (`admin .../pickup/complete/route.ts:120-142`); buyer **in-app** COMPLETED notification is created by `completePickup` (dead) and admin routes, **not** by the scan route → the dealer-scan path yields no buyer in-app notification (`acquisition-comms.ts:280-310` ownership list is stale for this path).
- preserve: receipt page `app/buyer/deal/[dealId]/receipt/page.tsx`; complete page `.../complete/page.tsx:17-24`; no recap artifact.
- required change: one `completeDeal` service: `$transaction` { possession+release evidence check, pickup COMPLETED, deal CAS → COMPLETED with `completedAt`, DealStatusHistory, outbox rows (buyer + dealer completion, keys `deal-complete-${dealId}` / `dealer-deal-complete-${dealId}`) } then emit the canonical event; delete the inline Resend in the scan route; fix the `INAPP_OWNED_BY_CALLERS` entry.
- legacy path: `pickup.service.ts::completePickup` (no callers), admin `pickup/complete`, `deals/[dealId]/action` DEAL_STAGE_ADVANCED→COMPLETED (`action/route.ts:102-127` sends its own email + notifications), `journey/complete` & `complete-all` (write `pickup.status` directly, `journey/complete/route.ts:225-243`, `complete-all/route.ts:146-163`).

**R20.18** · §20 L1023 "*Today a token scan advances the Deal first and updates pickup and activity separately, with a best-effort completion email*" [NEW] · ALREADY CORRECT (as a statement) · evidence: `scan/route.ts:86-134` exactly as described.

**R20.19** · §20 L1025 "Completed is terminal" · PARTIAL · current: `TRANSITIONS.COMPLETED = []`, `TERMINAL` includes COMPLETED (`deal.service.ts:31,36,63-70`) ✔; but `force: true` bypasses `canTransition` (`:129-131`) and is used by `journey/reopen` `COMPLETED → PICKUP_SCHEDULED` (`app/api/admin/buyers/[buyerId]/journey/reopen/route.ts:117-124`) and by `DEAL_STAGE_ADVANCED` with client-supplied `force` (`deals/[dealId]/action/route.ts:41-46, 65-70`) · stronger safeguard: SUPER/OPERATIONS role + reason required on those routes (`reopen:21-23`, `action:37-50`) — preserve · required change: refuse `force` out of COMPLETED (or make it an explicit, separately-audited "reopen" that writes an append-only correction rather than rewriting status).

**R20.20** · §20 L1025 "Corrections are append-only and never rewrite completed history" · MISSING · current: no correction model; `DealStatusHistory` rows are append-only by construction (`schema.prisma:2810-2821`) but Deal/Pickup rows are mutated in place · required change: correction records (child of Deal) — can share the Stage 21 obligation model.

**R20.21** · HTML S20 tables `deal_timeline` · DUPLICATED/UNUSED · current: `DealTimeline` model (`schema.prisma:2967-2979`) + `recordTimelineEvent`/`recordStatusTransition` (`deal-timeline.service.ts:4-17`) have **no callers**; `advanceDealStatus` writes `DealStatusHistory` directly (`deal.service.ts:167-176`) · required change: pick one (DealStatusHistory is the live one); remove or wire the other.

### Stage 21 — Post-completion dealership obligations (L1029–1043)

**R21.1** · §21 L1031 "Tracked as child records of the completed Deal, without reopening or altering it" · MISSING · current: no obligation model (schema grep `obligation|post_completion` → 0; HTML table `post_completion_obligations` absent) · required change: `PostCompletionObligation` model (dealId, type, status, ownerRole, dueAt, resolvedAt, evidence) + migration + RLS.

**R21.2** · L1033 "Title and registration delivery, expected date, temporary tag expiry" · MISSING.

**R21.3** · L1034 "Trade payoff completion, lienholder paid confirmation" · MISSING (grep `lienholder` → 0).

**R21.4** · L1035 "Due-bill repairs and promised equipment" · MISSING.

**R21.5** · L1036 "Missing accessories or second keys" · MISSING.

**R21.6** · L1037 "Dealership correction of transaction documents" · MISSING.

**R21.7** · L1039 "Each obligation is PENDING, OVERDUE, or RESOLVED, with an owner and a due date" · MISSING.

**R21.8** · L1039 "Overdue obligations notify the buyer and the dealership, escalate to Operations, and register on the dealership scorecard" · MISSING · current: `checkSLAs` (`lib/services/monitoring/health.service.ts:509-…`) covers auctions, stuck deals >14d, sourcing, deposit evidence — nothing post-completion; scorecard has no obligation dimension (`dealer-scorecard.service.ts`) · required change: cron sweep → OVERDUE + outbox notifications + SYSTEM_ALERT + scorecard input.

**R21.9** · L1041 "The dealership remains responsible for performance. AutoLenis tracks status and communication" · MISSING (policy; depends on R21.1).

**R21.10** · HTML S21 sees "Outstanding obligation status with expected dates" (buyer) · MISSING · current: post-completion buyer surfaces are `complete` + `receipt` pages only.

**R21.11** · HTML S21 tables `dealer_scorecard_snapshots` consequence · MISSING · current: snapshot cron weekly, idempotent per ISO week (`app/api/cron/dealer-scorecard-snapshot/route.ts:32-50`) — reuse for a new column.

---

## Duplicates

1. **QR/token generation** — `lib/services/pickup/qr.service.ts::generatePickupQr` (coordination confirm) vs `lib/services/pickup/pickup.service.ts::generateQrPayload` (admin schedule + regenerate). Different payload shapes (pickupId `"initial"` vs real id; nonce format differs).
2. **Deal completion writers** — `app/api/dealer/pickup/scan/route.ts`; `app/api/admin/deals/[dealId]/pickup/complete/route.ts` (force); `app/api/admin/deals/[dealId]/action/route.ts` (`DEAL_STAGE_ADVANCED`, optional force); `app/api/admin/buyers/[buyerId]/journey/complete/route.ts:225-243` and `complete-all/route.ts:146-163` (direct `pickup` writes + `moveBuyerWorkflowStage(force=true)`); `lib/services/pickup/pickup.service.ts::completePickup` (no callers).
3. **Completion email** — inline HTML direct Resend (`scan/route.ts:126-134`, no key) vs `resend.service.ts::sendDealCompleteEmail` (key `deal-complete-${dealId}`) used by admin complete + admin action; neither uses the comms outbox.
4. **Pickup-scheduled buyer/dealer comms** — `pickup-notifications.service.ts` (outbox, D2 rail) vs `resend.service.ts::sendPickupReadyEmail`/`sendDealerPickupScheduledEmail` (admin schedule route) vs `acquisition-comms.ts` PICKUP_SCHEDULED (SMS) vs in-app rows created in `pickup-coordination.service.ts:129-141` and `pickup.service.ts:53-61`.
5. **Check-in** — `app/api/admin/deals/[dealId]/pickup/check-in/route.ts` (requires SCHEDULED, `:17`) vs `app/api/admin/pickups/[pickupId]/mark-arrived/route.ts` (no status guard).
6. **Regenerate QR** — `app/api/admin/deals/[dealId]/pickup/regenerate-qr` vs `app/api/admin/pickups/[pickupId]/regenerate-qr`.
7. **Status history** — `DealStatusHistory` (live, written in `deal.service.ts:167`) vs `DealTimeline` + `deal-timeline.service.ts` (no callers).
8. **Scheduling seams** — coordination round-trip (`pickup-coordination.service.ts`) vs admin `schedulePickup` upsert+force (`pickup.service.ts:21-65`) vs buyer `reschedulePickup` (`scheduling.service.ts`).

## Stronger safeguards to preserve

- CAS on `(status, proposedAt)` for every coordination transition; client must echo `proposedAt` (`pickup-coordination.service.ts:240-244` etc.; `confirm/route.ts:12-16`).
- Compensating revert of a confirmed pickup when the deal advance fails (`pickup-coordination.service.ts:149-171`).
- Pre-check of deal status before the CAS so a cancelled deal never strands a SCHEDULED pickup (`:74-78, 233, 301`).
- Concierge (dealer-less) deals refused from the dealer round-trip and the dealer scan (`buyer/pickup/[dealId]/route.ts:46-52`; `scan/route.ts:44-62`).
- Uniform 422 for foreign-dealer and dealer-less tokens (no state oracle) (`scan/route.ts:48-61`).
- Insurance hard-gate enforced inside the seam at write time, re-checked after the route pre-check (`deal.service.ts:134-138`; `scan/route.ts:95-104`).
- Deal CAS in `advanceDealStatus` → canonical completion event emitted once (`deal.service.ts:150-165, 202-204`).
- `expectedFrom` guard prevents backward writes (`deal.service.ts:88-94, 127`).
- Buyer reschedule has no availability override; admin override requires reason and is audited (`scheduling.service.ts:34-37`; `admin .../pickup/schedule/route.ts:22-27, 56-65, 69-74`).
- Admin force-complete restricted to SUPER_ADMIN/OPERATIONS_ADMIN with mandatory reason (`admin .../pickup/complete/route.ts:30-34, 22-24`).
- Dealer isolation on pickup lists — city/state only (`dealer-deals.service.ts:170-172, 196-200`); dealer emails carry vehicleRef + city/state only (`pickup-notifications.service.ts:7-8`).
- Round-scoped idempotency keys; reminder keys distinct from initial sends (`pickup-notifications.service.ts:82, 117, 151, 228, 262`).
- Outbox `ON CONFLICT (dedup_key) DO NOTHING` + status CAS drain (`comms-outbox.service.ts:4-9, 94-139`).
- Scorecard snapshot idempotent per ISO week (`dealer-scorecard-snapshot/route.ts:32-50`).
- QR expiry bound to the appointment (`scheduledAt + 48h`).

## Legacy paths

- `lib/services/pickup/pickup.service.ts` — `schedulePickup` (upsert, `force: true` advance from any status, regenerates token), `regenerateQr`, `checkInPickup`, `completePickup` (dead).
- `lib/services/pickup/qr.service.ts::validateQrPayload` — dead export.
- `app/api/admin/deals/[dealId]/pickup/{schedule,check-in,complete,regenerate-qr}` and `app/api/admin/pickups/[pickupId]/{mark-arrived,regenerate-qr}` — admin-authoritative bypasses of the round-trip.
- `app/api/admin/buyers/[buyerId]/journey/{complete,complete-all,reopen}` — direct `pickup.status` writes; `reopen` forces COMPLETED → PICKUP_SCHEDULED.
- `app/api/admin/deals/[dealId]/action` `DEAL_STAGE_ADVANCED` with client-supplied `force`.
- `PATCH /api/buyer/pickup/[dealId]` reschedule → `RESCHEDULED` without token rotation.
- `DealStatus.PICKUP_COMPLETE` intermediate — no writer except admin workflow move (`workflow/move/route.ts:28`); `canTransition` allows `PICKUP_SCHEDULED → COMPLETED` directly (`deal.service.ts:29`).
- `app/api/cron/holds` — no-op reconciler (`released: 0`).
- `lib/services/admin/admin-queue.service.ts` `PICKUP_EXCEPTION` = stale PICKUP_SCHEDULED deals, not `PickupStatus.EXCEPTION`.
- Scan UI `components/dealer/PickupActionsClient.tsx` — pasted token, treats any 409 as "already scanned" (`:32-35`) although 409 also means INSURANCE_REQUIRED / NOT_READY.

## Out-of-scope findings

- **Security**: plaintext release token returned to the dealer portal via `getDealerDeals` (`dealer-deals.service.ts:57,127`) — the dealer can complete a deal without the buyer present. Should be removed regardless of the token redesign.
- `INAPP_OWNED_BY_CALLERS` (`acquisition-comms.ts:303-310`) claims the scan route owns the COMPLETED in-app notification; it does not create one → no buyer in-app notification on the dealer-scan completion path (same "ownership outlived owner" pattern the file documents for SIGNED).
- `PickupActionsClient` maps every 409 to "already scanned" (`:32-35`) — an insurance-blocked scan is mis-reported to the dealer.
- Buyer location gap (`docs/plans/BUYER-LOCATION-GAP.md`): with NULL `buyers.city/state`, dealer pickup emails and the dealer pickups page render empty location / "Buyer location on file" (`pickup-notifications.service.ts:71-72`; `app/dealer/pickups/page.tsx:22-25`). No pickup-specific defect beyond degraded copy; not investigated further.
- `admin-queue.service.ts` `PICKUP_EXCEPTION` semantics (see Legacy).
- `DealTimeline` model unused (see Duplicates #7).

## UNVERIFIED items

- Runtime behaviour of two concurrent dealer scans (R18.20) — reasoned statically from `advanceDealStatus` return semantics; no test exercises it (`scan-route.test.ts` has no concurrency case).
- Whether any pickup test suite currently passes — not run (forbidden).
- Whether `comms-outbox-drain` is live in production (schedule present in `vercel.json:244-245`; deployment state unknown).
- Whether `MAKE_WEBHOOK_URL` is set in production (canonical completion event forwarding is skipped with a warning otherwise, `lib/events/emit.ts:213-217`).
- Whether any `DealerAvailability` rows exist in production (no write path found in code).
- Whether the `20260930`/`20261001` pickup migrations are applied in production (migration files carry "REQUIRED PRE-LIVE STEP" warnings; DB not queried).
- `Deal.completedAt` truly absent from the DB (schema read only; no drift check).

## Open questions for the owner

1. "Two unsuccessful counter rounds": is a round one buyer↔dealer exchange (cap should be 4 counters / 2 flips per side) or one counter action (current `MAX_PICKUP_COUNTERS = 2`)?
2. Should the release token remain a QR image the buyer presents, or become a short human-readable code (current dealer UI is a paste box)? Either way it must not be served to the dealer.
3. Should Stage 18 "dealer release recorded" become a new `PickupStatus` (e.g. `RELEASED`) between `CHECKED_IN` and `COMPLETED`, and should `DealStatus.PICKUP_COMPLETE` be repurposed as "released, awaiting buyer possession"?
4. Is admin `force` out of `COMPLETED` (journey reopen) to be removed, or retained as an audited exception that writes an append-only correction?
5. Where should "funding cleared" and "AutoLenis fees resolved" facts live (Financing vs Deal) — the payments/ledger owner must decide before the completion requirement list can be enforced.
6. Does the delivery variant need a transporter identity record, or only a mode + address on the pickup?
7. Who owns Stage 21 obligations operationally (Ops queue type, dealer portal view, buyer page) — needed to size the model.

---

## Verification corrections (adversarial pass)

Independent re-check of every ALREADY CORRECT / MISSING / BROKEN / DUPLICATED row plus a sample of PARTIAL rows, against HEAD 0cd399f. Method: opened every cited file at the cited lines; for every MISSING row searched the whole `frontend/` tree (app, lib, components, prisma incl. `manual_supabase_sql` + `migrations`, scripts) under ≥3 alternative spellings (camelCase / snake_case / synonyms). Static reading only — no tsc, no tests, no DB. Paths relative to `frontend/` unless prefixed. Format: `spec_ref | original status → corrected status | reason | evidence`.

### Rows whose status changes

1. **R17.18** (§17 implicit — round-specific idempotency keys) | ALREADY CORRECT → **PARTIAL** | Four of the five keys are round-scoped, but the dealer confirmation email key `dealer-pickup-scheduled-${dealId}` is per-deal. Because the outbox dedup is `ON CONFLICT (dedup_key) DO NOTHING`, once a deal has been confirmed once the dealer can never receive a second "pickup confirmed" email — which the spec requires after a missed pickup returns to a new proposal round (L920). The buyer in-app row written on confirm has no idempotency at all. | `lib/services/pickup/pickup-notifications.service.ts:189` `idempotencyKey: \`dealer-pickup-scheduled-${dealId}\`` (vs `:117,151,228,262` which append `roundKey(p)`); `lib/services/comms/comms-outbox.service.ts:4-6` ("ON CONFLICT (dedup_key) DO NOTHING"); `pickup-coordination.service.ts:129-141` (in-app create, `.catch(() => {})`, no key).

2. **R17.9 — token-exposure sub-claim** (and the "Out-of-scope findings › Security" bullet) | BROKEN ("dealer can complete without the buyer presenting anything") → **BROKEN, exposure sub-claim corrected to LATENT OVER-SELECTION (not reachable by the dealer today)** | (a) The cited function is wrong: `getDealerDeals` selects no pickup fields at all. The `qrCodeData` select is in `getDealerDealById`. (b) Its only caller is the server-rendered `app/dealer/deals/[dealId]/page.tsx`, which never references `deal.pickup` in JSX and passes no deal object to any client component, so the plaintext token is never serialized to the dealer's browser. (c) Likewise `getDealerPickupActions` selects `qrCodeImage` but `app/dealer/pickups/page.tsx` never renders it (`CardShell`/`CardHead` are server functions in the page; `PickupActionsClient` receives only `dealId`). Both selects are still a latent leak one prop-pass away and must be removed, but the statement that the dealer can currently self-complete a deal without the buyer is not supported by the code. The crypto (`Math.random`), plaintext storage, equality lookup, no `consumedAt`, no revocation, dead `validateQrPayload` findings all stand. | `lib/services/dealer/dealer-deals.service.ts:70-82` (`getDealerDeals` select: id/status/createdAt/offer only), `:87-129` (`getDealerDealById` … `qrCodeData: true` at `:127`), `:201-216` (`qrCodeImage: true`); caller grep → only `app/dealer/deals/[dealId]/page.tsx:2,32` and `app/dealer/pickups/page.tsx:2,56`; `app/dealer/deals/[dealId]/page.tsx` grep `pickup|qrCode` → only `:59` (href to `/dealer/pickups`); `app/dealer/pickups/page.tsx:27,35` (server `CardShell`/`CardHead`), `:134` `<PickupActionsClient dealId={a.id} />`; no `"use client"` in either page; no `app/api/dealer/deals/[dealId]/route.ts` exists.

3. **R17.13** (§17 Exit "Confirmed appointment with a live token") | PARTIAL → **PARTIAL (worse than recorded — a live token can exist WITHOUT a confirmed appointment)** | Admin `regenerateQr` has no pickup-status guard and neither admin regenerate route checks status, so a token can be minted for a `PROPOSED` / `DEALER_COUNTERED` / `EXCEPTION` / `NOT_SCHEDULED` pickup; its expiry is `now + 48h`, untethered from `scheduledAt`. The scan route accepts any non-COMPLETED pickup whose token matches, so such a token is scannable with no confirmed appointment. | `lib/services/pickup/pickup.service.ts:67-84` (`regenerateQr`: `findUnique` → regenerate, `qrExpiresAt: new Date(Date.now() + 48 * 3600000)` at `:79`, no status check); `app/api/admin/deals/[dealId]/pickup/regenerate-qr/route.ts:15-18`; `app/api/admin/pickups/[pickupId]/regenerate-qr/route.ts:15-18`; `app/api/dealer/pickup/scan/route.ts:36-37, 69-71` (only `COMPLETED` excluded).

4. **R20.21** (HTML S20 tables `deal_timeline`) | DUPLICATED/UNUSED → **DUPLICATED/UNUSED (confirmed; scill-vs-code drift added)** | Confirmed zero callers for `recordTimelineEvent`, `recordStatusTransition` **and** `getDealTimeline` outside the service file. Note the `autolenis-deal-lifecycle` skill (rule 8 "call `recordStatusTransition`"; "Diagnose a stuck deal → step 1 `getDealTimeline`") describes this dead module as live — running code outranks the skill (source-of-truth rank 1 vs 2); the implementer must not "wire it back" on the skill's say-so without a decision. | repo grep `recordTimelineEvent|recordStatusTransition|dealTimeline\.|getDealTimeline` → only `lib/services/deal/deal-timeline.service.ts:4-16`; `lib/services/deal/deal.service.ts:167-176` writes `dealStatusHistory` directly; `.claude/skills/autolenis-deal-lifecycle/SKILL.md` (Core rules #8; Workflows "Diagnose a stuck deal" #1).

### Rows confirmed as recorded, with corrected evidence or added gaps

5. **R17.10** (§17 "Any schedule change revokes the prior token and issues a new one") | BROKEN → **BROKEN (confirmed) + two uncovered gaps** | Confirmed: buyer reschedule writes `scheduledAt/status/location` only. Additional gaps the row omits: (a) the buyer's PATCH reschedule of a **dealer-confirmed** slot sends **no dealer notification** (no in-app, no email) and does not re-enter the confirm round-trip — a unilateral change of a two-party agreement; (b) the `reason` field is accepted and silently discarded (route comment admits it). | `lib/services/pickup/scheduling.service.ts:67-74`; `app/api/buyer/pickup/[dealId]/route.ts:97` ("reason is accepted for client UX but not stored"), `:130-147` (only a **buyer** notification is created); `components/buyer/PickupRescheduleButton.tsx:35` (sends `reason`).

6. **R17.11 / R17.17** (24h/2h reminders) | MISSING → **MISSING (confirmed; evidence path corrected)** | The cron-schedule citation `cron-schedule.ts:61` has no such file at that path; the real file is `lib/services/monitoring/cron-schedule.ts`. Repo-wide search for appointment reminders (`pickupReminder|pickup_reminder|pickup-reminder|appointment.?remind|24.?h.*remind|2.?h.*remind|scheduledAt.*(lt|gte)`) → only the auction-deadline reminders (`app/api/jobs/dealer-bid-reminder`, `app/api/cron/dealer-invitation-reminder`) and social/CRM schedulers; nothing scans `pickups.scheduled_at`. | `lib/services/monitoring/cron-schedule.ts:61` `"pickup-confirmation-nudge": { intervalMinutes: HOUR }`; `vercel.json:28-29`; `lib/services/pickup/pickup-sla.service.ts:45-49, 67-72` (filters on `proposedAt`, never `scheduledAt`).

7. **R17.5** (two unsuccessful counter rounds → Operations) | PARTIAL → **PARTIAL (confirmed) + one added gap** | Confirmed `MAX_PICKUP_COUNTERS = 2`, increment on **both** sides' counters, escalation on the 3rd; admin queue `PICKUP_EXCEPTION` really is "PICKUP_SCHEDULED stale > 7d", not `PickupStatus.EXCEPTION`. Added: the Ops path `schedulePickup` upserts `SCHEDULED` but leaves `proposedTime/proposedBy/proposedAt/counterCount` and both reminder markers untouched, so a resolved exception keeps stale round data and a stale CAS token on the row. | `pickup-coordination.service.ts:32, 266-268, 281, 333-335, 348, 360-376`; test `lib/services/pickup/__tests__/pickup-coordination.test.ts:255`; `lib/services/admin/admin-queue.service.ts` `case "PICKUP_EXCEPTION"` (`status: "PICKUP_SCHEDULED", updatedAt < now-7d`); `lib/services/pickup/pickup.service.ts:38-45` (update block sets only `scheduledAt/location/status/qr*`).

8. **R18.20** (HTML S18 "Validate the token exactly once") | BROKEN → **BROKEN (confirmed statically; runtime UNVERIFIED)** | Confirmed from code, not from the row: `advanceDealStatus` returns `false` (never throws) when the CAS loses and the fresh status is already `COMPLETED`; the scan route discards the boolean and unconditionally runs the pickup/activity `$transaction` and the direct Resend send. The only existing test for double-scan is sequential (second scan after the first committed), so the concurrent case has no coverage. | `lib/services/deal/deal.service.ts:148-165` (`swap.count === 0` → `fresh.status === newStatus` → `return false`); `app/api/dealer/pickup/scan/route.ts:90` (`await advanceDealStatus(...)` — result unused), `:108-121`, `:123-134`; `app/api/dealer/pickup/__tests__/scan-route.test.ts:205` ("an already-scanned pickup is rejected") — sequential only.

9. **R20.17** (§20 "Atomically …") | BROKEN / PARTIAL → **BROKEN / PARTIAL (confirmed) + two omitted asymmetries** | Confirmed three-write non-atomic sequence, no `Deal.completedAt`, `INAPP_OWNED_BY_CALLERS` stale (it names `pickup.service.completePickup`, which has zero callers). Omitted from the row: on the **dealer-scan** path (the only non-admin completion path) (a) the CRM `deal_complete` lifecycle sequence is never scheduled — `scheduleLifecycleWorkload({ workload: "deal_complete" })` has exactly one caller, the admin force-complete route; (b) the dealership receives **no** completion / payout communication at all — `sendDealerPickupCompletedEmail` / `sendDealerPayoutInitiatedEmail` are called only from the admin route. So the "queue buyer **and dealership** completion communications durably" requirement is MISSING (not merely non-durable) on the scan path. | `prisma/schema.prisma:574-616` (Deal — no `completedAt`; `completed_at` hits at `:697,806,831,…` belong to other models); `lib/services/notifications/acquisition-comms.ts:284-286, 295-305`; repo grep `completePickup\b` → only that comment; `app/api/admin/deals/[dealId]/pickup/complete/route.ts:111-118, 125-142`; repo grep `workload: "deal_complete"` → only `admin .../pickup/complete/route.ts:112`; `app/api/dealer/pickup/scan/route.ts:123-145` (buyer email only).

10. **Duplicates #5** (check-in) | DUPLICATED → **DUPLICATED (confirmed) + inconsistency** | The deal-scoped route demands `status === "SCHEDULED"` exactly, so a `RESCHEDULED` pickup (the status every buyer reschedule produces) cannot be checked in through it, while the pickup-scoped route has no status guard at all (can "check in" a COMPLETED or NOT_SCHEDULED pickup). | `app/api/admin/deals/[dealId]/pickup/check-in/route.ts:17`; `app/api/admin/pickups/[pickupId]/mark-arrived/route.ts:15-18`; `lib/services/pickup/scheduling.service.ts:71` (`status: PickupStatus.RESCHEDULED`).

11. **R16.10** (no payment dispute / cancellation / hold) | PARTIAL → **PARTIAL (confirmed)** | `cron/holds` is a documented no-op (`released: 0, autoRefundsDisabled: true`); no hold/dispute fact exists on Deal/Pickup. Searched `hold|dispute|chargeback` in pickup + deal services → none. | `app/api/cron/holds/route.ts:1-21`; `prisma/schema.prisma:574-616, 826-855`.

12. **R16.1 / R17.1** (entry gate) | PARTIAL / MISSING → **confirmed** | Proposal gate = `eSignEnvelope.status === "COMPLETED"` + `deal.status === "SIGNED"` + dealer present; `proposePickup` checks ownership, pickup state, availability only. `Financing.status` (`PENDING|SELECTED|APPROVED|DECLINED`) has no "funded/cleared" value and is never read by any pickup file (grep `financing` in `lib/services/pickup/*` → 0). | `app/api/buyer/pickup/[dealId]/route.ts:46-72`; `pickup-coordination.service.ts:185-193`; `prisma/schema.prisma:2059-2071, 1711-1716`.

13. **R19.8 / R20.1** (never completes on dealer's word alone) | BROKEN → **BROKEN (confirmed)** | `advanceDealStatus(pickup.dealId, "COMPLETED", { actorRole: "DEALER" … })` runs on the dealer scan alone; no buyer-side confirmation route/component/field exists (searched `possession|vehicleReceived|vehicle_received|deliveryAcknowledg|buyer_acknowledg` → only an unrelated seed-data scripture string). | `app/api/dealer/pickup/scan/route.ts:90`; `prisma/seed.ts:457` (false positive); `app/api/buyer/pickup/**` = `route.ts`, `accept/route.ts`, `counter/route.ts` only.

14. **R16.2–R16.14, R18.4–R18.17, R19.1–R19.7, R20.2–R20.9, R20.11, R20.14, R20.16, R20.20, R21.1–R21.11** (MISSING rows) | MISSING → **MISSING (confirmed under alternative names)** | Searches (each ≥3 spellings, whole `frontend/` incl. `prisma/manual_supabase_sql` and `prisma/migrations`): readiness (`pickup.?readiness|readinessCheck|isPickupReady|readyForPickup`) → only `sendPickupReadyEmail` (an email) and a scan error code; obligations (`obligation|post.?completion|due.?bill|we.?owe`) → prequal DTI "obligations", legal copy, dealer-agreement headings only; no-show (`no.?show|missed.?pickup|missed_appointment`) → marketing copy only; delivery variant (`fulfillmentMode|deliveryMode|homeDelivery|deliveryAddress|transporter`) → a signup marketing string and email-delivery code only; odometer/VIN/condition at release (`odometer|mileageAtRelease|vinConfirmed|vinMatch|conditionAtRelease`) → shortlist filter, JSON-LD, form placeholder only; identity/co-buyer (`IdentityVerificationStatus|identityVerif|coBuyer`) → the enum is declared but bound to **no model field** (`schema.prisma` has exactly one hit, the enum itself) and `coBuyer` is a boolean on the public vehicle-request intake only; title/lienholder/temp tag (`lienholder|payoffConfirm|tempTag|temporaryTag|titleDelivery|titleStatus`) → `tradeTitleStatus` on the public intake form only; recap/reaffirm → a weekly-digest email label only; funding/down-payment (`fundingCleared|fundsCleared|fundedAt|downPayment`) → `downPaymentCents` is displayed on the admin request page from intake metadata, no Deal/Financing fact; token hashing (`consumedAt|revokedAt|tokenHash|randomBytes`) in pickup code → none (pattern exists for dealer claim/invitation tokens only). | `prisma/schema.prisma:1950` (enum, sole hit); `app/api/public/request-vehicle/route.ts:106,124,267`; `app/admin/requests/[requestId]/page.tsx:119,167`; `prisma/migrations/20260828000000_dealer_invitation_token_hash/migration.sql:24-25`; `prisma/manual_supabase_sql/tier0_claim_token_and_ism_contact.sql:8,12`.

15. **R20.3** (reference chain) | MISSING → **MISSING (confirmed; VIN location clarified)** | Neither `Deal` nor `Offer` carries a vehicle/VIN; the only vehicle identity is `AuctionVehicle.inventoryItemId` (nullable) via `Offer → Auction → AuctionVehicle[]`, and concierge deals (`vehicleRequestOfferId`) have no dealer and no auction. | `prisma/schema.prisma:577-578, 503-512` (`inventoryItemId String?`), `:539` (Offer has only `vehiclePriceCents`); `app/api/dealer/pickup/scan/route.ts:44-47`.

16. **R17.16** (HTML S17 dealer "Publish availability") | PARTIAL → **PARTIAL (confirmed)** | No write path: repo grep `dealerAvailability(Window|BlackoutDate)?\.(upsert|update|create|createMany|updateMany|delete)` → 0 outside tests; no `app/**/availability` route exists (only an unrelated admin test file matches). The resolver's ZIP/state fallback means every dealer is bookable Mon–Sat defaults today. | `lib/services/pickup/availability.service.ts:245-286`; `find app -path '*availability*'` → `app/api/admin/__tests__/auction-vehicle-availability.test.ts` only.

### Requirements in L877–1021 / HTML S16–S21 not covered by any row

17. **HTML S16 rec "Readiness confirmation timestamp on the pickup record"** | (uncovered) → **MISSING** | `Pickup` has no readiness field of any kind. | `prisma/schema.prisma:826-855`.

18. **HTML S20 sees "Deal completed, with the executed contract, receipt and support information"** | (uncovered) → **PARTIAL** | The completion page shows an OTD figure, a Receipt button, a Share & Earn button and a testimonial prompt; neither it nor the receipt page links the executed contract or any support contact, although a buyer executed-contract download route exists. | `app/buyer/deal/[dealId]/complete/page.tsx:15-52`; `app/buyer/deal/[dealId]/receipt/page.tsx` grep `contract|executed|support|download|href=` → 0; `app/api/buyer/deals/[dealId]/contract/download/route.ts` (exists, unlinked from completion surfaces).

19. **HTML S21 buyer "Report anything outstanding"** | (uncovered) → **MISSING** | No buyer-side post-completion report/claim path; buyer pickup API surface is propose/reschedule/accept/counter only. | `app/api/buyer/pickup/**` (3 routes); `app/buyer/pickup/page.tsx:103-109` (COMPLETED → "Pickup complete!" + link to summary only).

20. **§18 L938 / HTML S18 "Confirm … token validity" — abuse control on the validation endpoint** | (uncovered) → **MISSING** | `POST /api/dealer/pickup/scan` has no rate limiter; a dealer session can submit unlimited token guesses, and the 422/409 split (`INVALID_TOKEN` vs `ALREADY_SCANNED` / `INSURANCE_REQUIRED` / `NOT_READY_FOR_PICKUP`) is an oracle for a token that *does* exist. Low practical risk today because the payload embeds the deal UUID, but a required control once the token becomes a short human-entered code. | `app/api/dealer/pickup/scan/route.ts` (no `rateLimit`/`limiter` import — grep → 0), `:41, 61, 66, 70, 77-81, 93`.

21. **§17 L912 "Operations schedules directly" — round-state reset** | (uncovered) → **PARTIAL** | See item 7: the Ops path neither clears the stale round nor resets `counterCount`, and it also fires its own buyer/dealer emails through the direct-Resend rail rather than the outbox rail the round-trip uses (Duplicates #4 already lists this). | `lib/services/pickup/pickup.service.ts:21-65`; `app/api/admin/deals/[dealId]/pickup/schedule/route.ts:97-118`.

22. **Security control — RLS on `pickups`** | (uncovered) → **UNVERIFIED** | No `pickups` RLS enable/policy statement was found in `prisma/manual_supabase_sql/*.sql` or any migration (grep `pickups` ∧ `ROW LEVEL|POLICY` → 0); the 20261001 migration adds columns/index only. All pickup access is via Prisma (service role), so this is a defence-in-depth gap only if RLS is genuinely absent — cannot be proven without the DB. | `prisma/migrations/20261001000000_pickup_confirm_roundtrip/migration.sql:26-40`; `prisma/migrations/20260930000000_add_dealer_availability/migration.sql:12-14` (new availability tables DO get RLS).

### Prior-row claims re-verified and left unchanged (evidence opened)

- R17.2/R17.3/R17.4/R17.6/R17.7/R17.8 — CAS on `(status, proposedAt)`, compensation revert, pre-check of `CONFIRMABLE_DEAL_STATUSES`, buyer no-override, dealer isolation via NOT_FOUND: `pickup-coordination.service.ts:78, 149-171, 187, 232, 240-244, 262, 274-285, 301, 308-312, 341-352, 365-369`; `confirm/route.ts:12-16`; `PickupConfirmClient.tsx:111,137`; tests `pickup-coordination.test.ts:163-316`; `reschedule-route.test.ts:110`.
- R18.2/R18.3/R20.10/R20.13 — `scan/route.ts:29-30, 44-62, 65-67, 76-82`; `deal.service.ts:41-45, 134-138`; tests `scan-route.test.ts:133-212`.
- R20.18/R20.19 — `scan/route.ts:86-134`; `deal.service.ts:29-31, 36, 63-70, 129-131`; `journey/reopen/route.ts:117-124` (`case "pickup"` forces `PICKUP_SCHEDULED` with `force: true`), `:21-23` (role gate); `deals/[dealId]/action/route.ts:37-46, 65-70`.
- R21.8 — `lib/services/monitoring/health.service.ts:509-536` (stuck > 14d only); `dealer-scorecard.service.ts:21-45`; `dealer-scorecard-snapshot/route.ts:32-50`; `schema.prisma:1255-1269`.
- R16.15, R16.11 (`dealer-pickup-scheduled.tsx:81` "Ensure vehicle is clean and ready for handover"), R16.9 (`TradeInSubmission` buyer-scoped, no `dealId`, `schema.prisma:2036-2057`), R20.12 (`dealer-deals.service.ts:134-138, 151-153`), R20.15 (`deal.service.ts:29-30`).

### Net effect on the summary

- Summary line 2 must drop "the plaintext token is also returned to the dealer … so the dealer never needs the buyer to present anything" → replace with "the plaintext token and QR image are over-selected into two dealer-facing server queries (not rendered today — remove before any client hand-off)".
- Summary line 7 gains: the dealer-scan path also never schedules the `deal_complete` lifecycle sequence and never notifies the dealership.
- New open question for the owner: should `regenerateQr` be refused unless the pickup is `SCHEDULED`/`RESCHEDULED`/`CHECKED_IN` (today it mints a live token for an unconfirmed appointment)?
