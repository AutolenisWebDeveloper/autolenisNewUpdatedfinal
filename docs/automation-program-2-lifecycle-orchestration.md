# Automation Program 2 — Business Lifecycle Orchestration & Communications Authority

> Implementation record. Program 2 completes and hardens AutoLenis's lifecycle
> orchestration **on the infrastructure that already exists**. It builds no new
> workflow engine, queue, outbox, retry, idempotency, or communications system.

## 1. Baseline

| Item | Value |
| --- | --- |
| Baseline `origin/main` SHA | `33495aa0ad5ad8256f29593329d4970a525708d9` |
| Program 2 branch | `claude/business-lifecycle-orchestration-vd6pu8` |
| App root | `frontend/` |

## 2. Program 1 dependency — VERIFIED

Program 1 (durable recovery, invariants & operational exceptions) is merged into
`main` and is the base of this branch:

- `97d3877` `feat(reliability): Program 1 — durable recovery, invariants & operational exceptions`
- merge `33495aa` (`#329`) — HEAD of `main`, and the branch point of this work.

The concierge→Deal convergence work (`#327`/`#328`, `81c1856`, `51e2c0d`) is also
present and was reviewed directly (§5). Program 1's own commit message confirms it
added **no new table/queue/event platform** — it hardened the pre-existing
substrate. Program 2 consumes that substrate; it does not fork it.

Production **deploy / production-verification** of Program 1 cannot be confirmed
from inside this environment — see §13 / §14 (NOT VERIFIED). All code-level
evidence (merged, present, consumed) is confirmed.

## 3. Existing capability map (what Program 2 consumes, does not rebuild)

| Capability | Where it already lives |
| --- | --- |
| Internal lifecycle scheduler (the 12 workloads) | `lib/services/crm/lifecycle-touch-drain.service.ts` — `enqueueLifecycleTouch` + `drainDueLifecycleTouches`, 16-sequence registry, message bodies ported **verbatim** from the QStash routes |
| Backing table | `lifecycle_touch_schedule` (raw Supabase SQL, `prisma/migrations/manual_supabase_sql/lifecycle_touch_schedule.sql`) — `UNIQUE(base_key, sequence)` |
| Drain cron | `app/api/cron/lifecycle-touch-drain` (`vercel.json` `*/15 * * * *`) — live but dormant (NO_DUE/NO_TABLE) |
| Communications delivery | `lib/qstash/notify.ts` `notifyContact` (TCPA/consent/suppression/STOP gated) + `comms_outbox` drain |
| Idempotency | `UNIQUE(base_key, sequence)` (per touch) + `lib/jobs/idempotency.ts` (`acquireIdempotencyGuard`, `claimJob`, `moveJobToDeadLetter`) |
| DLQ / recovery | `jobs_dead_letter` + `OperationsService.autoDrainDeadLetterJobs` (`cron/dlq-drain`) |
| Provider-event dedup | `PaymentProviderEvent` + `lib/services/webhooks/provider-event-dedup.ts` |
| Observability | `withCronRun` → `CronJobLog`; dead/failing-cron watchdogs; `SYSTEM_ALERT` ops-exception rail |
| Feature flags | `FeatureFlag` model + `lib/services/system/feature-flags.service.ts` (`FLAGS`, `isEnabled`, default OFF) |
| State guards | `lib/qstash/state.ts` — `hasPaidDeposit`, `hasSelectedOffer`, `hasDealerBid` (Program 2 adds `hasLiveAuction`) |
| Retired dealer-bid-reminder owner | `cron/dealer-invitation-reminder` (endsAt-driven, idempotent, ACTIVE-only) |

**Architecture note:** Inngest is fully retired (no dependency, no `lib/inngest`,
no `app/api/inngest`). Program 2 did not reintroduce it.

## 4. The 12 workloads — before → after authority

The internal consumer (drain) already existed for all 12; what was missing was the
**producer** side. Program 2 adds one thin activation-control router
(`lib/services/crm/lifecycle-scheduler.ts`, `scheduleLifecycleWorkload`) that each
**root** producer calls. The 6 chained descendants inherit authority from their
root (whichever authority started the chain owns the whole chain).

| # | Workload | Root/chained | Old authority (producer) | New authority (flag ON) | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | deposit-reminder | root | QStash `dispatch` (create-intent, onboarding) | internal `deposit_reminder_1` (+chain) | migrate |
| 2 | auction-active | root | QStash (stripe standard branch) | internal `auction_active` | migrate |
| 3 | auction-midpoint | chained | QStash chain from auction-active | internal chain | migrate |
| 4 | auction-closing | chained | QStash chain from auction-midpoint | internal chain (+guard fix) | migrate |
| 5 | dealer-invited | root | QStash (dealer-invitation.service) | internal `dealer_invited` | migrate |
| 6 | dealer-bid-reminder | chained | QStash chain from dealer-invited | **none** — `cron/dealer-invitation-reminder` owns it | **retire** |
| 7 | offer-received | root | QStash (dealer/offers) | internal `offer_received` | migrate |
| 8 | offer-follow-up | chained | QStash chain from offer-received | internal chain | migrate |
| 9 | deal-complete | root | QStash (admin pickup-complete) | internal `deal_complete` | migrate |
| 10 | review-request | chained | QStash chain from deal-complete | internal chain (+coupled refinance/referral) | migrate |
| 11 | form-submitted | root | QStash (request-vehicle, signup, voice-intake) | internal `form_submitted` (buyerId enrollments) | migrate (partial) |
| 12 | check-form-completion | chained | QStash chain from form-submitted | internal chain | migrate |

Notes:
- **#6 dealer-bid-reminder is RETIRED, not migrated.** On the internal path
  `dealer_invited` does not chain a bid reminder; the pre-existing idempotent
  `cron/dealer-invitation-reminder` (targets only `status: ACTIVE` auctions inside
  the deadline window) is the single owner. Evidence: it already runs hourly in
  `vercel.json`, dedups on `dealer-auction-reminder-{auctionId}-{email}`.
- **#11 form-submitted is a partial migration.** The 3 producers that carry a
  `buyerId` (landing-page request, signup, voice dispatch-request) route through
  the flag. The 2 voice producers that carry **no** `buyerId`
  (`voice/handle-turn` "phone-voice-partial", `twilio/voice/status`
  "phone-voice-abandoned") intentionally stay on QStash — the internal path needs
  an `entity_id` to key on and to resolve the chained check-form-completion
  contact. This is single-authority-preserving: each individual call goes to
  exactly one system; no enrollment is ever double-produced.

## 5. Concierge lifecycle — authoritative handling

The concierge flow mints an auction **already `CLOSED`** with offers present,
`postCloseProcessedAt` set at creation, and **no** `AuctionInvitation` rows
(`concierge-conversion.service.ts`). Disposition of each concierge lifecycle
touchpoint:

| Touchpoint | Handling |
| --- | --- |
| $99 deposit confirmation | Existing — `sendDepositConfirmationEmail` + GHL tag in the Stripe `concierge_deposit` branch. Reused, unchanged. |
| Offers-ready | Existing — in-app "Your offers are ready" notification in the concierge branch. Reused, unchanged. |
| Buyer selection | Canonical `select-offer` route → `commitOfferSelection`. Reused, unchanged. |
| Deal creation | Canonical spine (`Deal.offerId`, `FINANCING_PENDING`). Reused, unchanged. |
| **CLOSED-auction exclusion from live-auction comms** | **Enforced (§10)** — see below. |

### CLOSED-auction truthfulness (§10) — the enforced invariant

A concierge-converted CLOSED auction must never receive live-auction copy ("your
auction is live / dealers are bidding / closing soon"). Enforcement is layered:

1. **Producer-level (primary).** The concierge Stripe branch never launches a live
   auction, never invites dealers, and never schedules `auction_active` — so the
   auction/midpoint/closing/dealer-bid-reminder sequences are never produced for a
   concierge buyer. The auction-scanning producers (`auction-close` cron,
   `deposit-activation-reconcile`) exclude it by `status = CLOSED` /
   `postCloseProcessedAt != null`.
2. **Event-workflow fix (new).** The concierge branch emits `deposit_paid` with
   `data.concierge = true`. The prebuilt `auction_launch` workflow triggers on
   `deposit_paid`. `WorkflowEngine.triggerForEvent` now **skips the
   `auction_launch` workflow when `triggerData.concierge === true`** — a
   state-eligibility skip (a concierge deposit is not eligible for the
   live-auction-launch workflow), not a copy edit.
3. **Drain-time guard (new, defense-in-depth).** The internal
   `auction_active/-midpoint/-closing` sequences now guard on `auctionLiveGuard`
   = converted **or** no live ACTIVE auction → cancel. So even if such a touch
   were ever enqueued for a CLOSED/concierge auction, the drain cancels it (no
   send, no chain).

Residual (owner/external): the Make.com path forwards the `deposit_paid` envelope
(including `concierge: true`) to an external scenario this repo cannot gate. The
concierge flag is present in the payload for the Make scenario to branch on — see
§14.

## 6. Reused / extended / repaired / consolidated / retired / new

- **Reused (unchanged):** `lifecycle_touch_schedule` table + drain, `comms_outbox`,
  `notifyContact`, `FeatureFlag`/`isEnabled`, `lib/jobs/idempotency.ts`,
  `jobs_dead_letter`/`dlq-drain`, `cron/dealer-invitation-reminder`, the concierge
  deposit/offers/select/deal touchpoints.
- **Extended:** `lib/qstash/state.ts` (+`hasLiveAuction`);
  `lib/services/crm/lifecycle-touch-drain.service.ts` (auction sequences now use
  `auctionLiveGuard`); `feature-flags.service.ts` (+6 per-workload flags);
  `WorkflowEngine.triggerForEvent` (concierge eligibility skip).
- **Repaired:** the QStash `auction-closing` guard gap is closed on the internal
  path (already fixed in the dormant drain; Program 2 additionally adds the
  live-auction check to active/midpoint/closing).
- **Consolidated:** dealer-bid-reminder folded into `cron/dealer-invitation-reminder`.
- **Retired:** QStash dealer-bid-reminder chain (at cutover of #5).
- **Newly created:** exactly one file —
  `lib/services/crm/lifecycle-scheduler.ts`, a thin per-workload activation-control
  **router** over the two existing schedulers (QStash `dispatch` + internal
  `enqueueLifecycleTouch`). Justification: Program 2 §7 mandates a per-workload
  activation control defaulted OFF; routing through one switch makes dual authority
  structurally impossible (exactly one branch per call). It is not a new
  reliability/queue system.

## 7. State & cancellation guards (re-evaluated at execution time)

Every lifecycle touch re-reads authoritative state at drain time and cancels
(no send, no chain) when obsolete:

| Sequence | Guard (cancel when true) |
| --- | --- |
| deposit_reminder_1/2/3 | `hasPaidDeposit` (already activated) |
| auction_active / _midpoint / _closing | `auctionLiveGuard` = `hasSelectedOffer` OR NOT `hasLiveAuction` |
| offer_follow_up_1/2 | `hasSelectedOffer` |
| check_form_completion_1/2/3 | `hasPaidDeposit` |
| dealer_invited, offer_received, deal_complete, review_request, form_submitted | terminal/entry touches — no conversion guard (parity with QStash) |

## 8. Idempotency / recovery

- **Idempotency:** `UNIQUE(base_key, sequence)` — each touch enqueues once; a
  producer firing twice adds no row. Base keys: `deposit-reminder:{buyerId}`,
  `auction:{auctionId}`, `dealer-invited:{auctionId}:{dealerId}`,
  `offer-received:{auctionId}`, `deal-complete:{dealId}`,
  `form-submitted:{buyerId}`.
- **Recovery:** claim CAS (`pending→sending`), stale-`sending` reclaim (10 min),
  bounded retry (`MAX_ATTEMPTS = 4`, linear backoff), terminal `status='failed'`
  (columns-only — never re-driven from `jobs_dead_letter`, so no DLQ branch can
  resurrect a touch). Router fails **safe** to QStash on a flag-read error and
  never falls back to QStash after choosing internal (no double-send).

## 9. Migrations

**None required for merge/deploy.** The `lifecycle_touch_schedule` table already
exists as owner-gated raw Supabase SQL
(`prisma/migrations/manual_supabase_sql/lifecycle_touch_schedule.sql`). Applying
that SQL to production remains an **owner-gated** step that must precede enabling
any internal producer flag (§12). The 6 `FeatureFlag` rows are created on demand by
the admin toggle (absent row = OFF), so no data migration is needed.

## 10. Test evidence (executed this session)

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS — 0 errors (67 pre-existing warnings in untouched files) |
| `pnpm test:coverage-check` | PASS — 174/174 test files reachable (incl. 2 new) |
| `pnpm test:all` (full matrix) | PASS — 1217 tests, 0 fail |
| `pnpm build` (`prisma generate && next build`) | PASS (exit 0) |
| `/security-review` on the diff | PASS — no newly-introduced exploitable findings |

New / extended tests:
- New `lib/services/crm/__tests__/lifecycle-scheduler.test.ts` (13) — OFF→QStash
  byte-for-byte body/delay, ON→internal seq/baseKey/entity/runAt mapping, single
  authority (exactly one branch), form-submitted no-buyerId → QStash fallback,
  fail-safe to QStash on flag error, no double-send on enqueue error.
- Extended `lib/services/crm/__tests__/lifecycle-touch-drain.test.ts` (+4 §10
  cases) — auction_active/-midpoint/-closing CANCEL when not live; send + chain
  when live. (23 tests total, all pass.)
- New `lib/services/concierge/__tests__/concierge-auction-launch-exclusion.test.ts`
  (3) — concierge `deposit_paid` skips `auction_launch`; standard/`concierge:false`
  deposit still enrolls it.

## 11. Independent second review — findings & fixes

A from-scratch second review (per `autolenis-code-verification`) + a security
sub-review were performed. Verified:
- flag-OFF branch reproduces each original `dispatch()` body/delay exactly
  (behaviour-neutral deploy), incl. `campaign: undefined` dropping out of the
  JSON body for the voice/dispatch-request path;
- the standard `deposit_paid` emit carries NO `concierge` flag, so the
  `auction_launch` skip affects concierge deposits ONLY (standard deposits still
  enroll);
- `hasLiveAuction` is buyer-scoped (documented) and, given AUCTION_DURATION_HOURS
  = 48, the +12h/+24h midpoint/closing touches land while ACTIVE — no false
  suppression on the happy path;
- single-authority holds across a mid-sequence cutover (in-flight QStash chains
  drain on QStash; new enrollments start internal; no enrollment double-produced);
- no new secret/PII in logs; Prisma/Supabase writes parameterized; fail-safe on
  flag error; no fallback-to-QStash after choosing internal (no double-send).

No CRITICAL/HIGH/material-MEDIUM findings required a code change.

## 12. Cutover matrix (owner-gated; safe default after deploy = ALL OFF, QStash authoritative)

| Workload | Current authority | Internal replacement | Default after deploy | Cutover action | Verification | Rollback |
| --- | --- | --- | --- | --- | --- | --- |
| deposit-reminder | QStash | `deposit_reminder_1` chain | OFF (QStash) | enable `lifecycle_internal_deposit_reminder` | one authority; no dup sends; touches enqueue at +24h | disable flag |
| auction-active/-midpoint/-closing | QStash | `auction_active` chain | OFF (QStash) | enable `lifecycle_internal_auction` | live-auction guard cancels CLOSED; no dup | disable flag |
| dealer-invited | QStash | `dealer_invited` | OFF (QStash) | enable `lifecycle_internal_dealer_invited` | bid reminders come only from `dealer-invitation-reminder` cron | disable flag |
| dealer-bid-reminder | QStash | RETIRED (cron owns it) | OFF (QStash chain) | retire at dealer-invited cutover | exactly one reminder/auction from the cron | re-enable QStash dealer-invited chain |
| offer-received/-follow-up | QStash | `offer_received` chain | OFF (QStash) | enable `lifecycle_internal_offer` | one offer-received/auction; follow-ups guarded | disable flag |
| deal-complete/review-request | QStash | `deal_complete` chain | OFF (QStash) | enable `lifecycle_internal_deal_complete` | review couples refinance/referral; no dup | disable flag |
| form-submitted/check-form-completion | QStash | `form_submitted` chain (buyerId only) | OFF (QStash) | enable `lifecycle_internal_form_submitted` | buyerId enrollments internal; voice-no-buyerId stay QStash | disable flag |

**Pre-cutover prerequisite:** apply `lifecycle_touch_schedule.sql` to production and
verify the physical table exists (`SELECT to_regclass('public.lifecycle_touch_schedule')`).

## 13. Production-verification requirements (read-only / non-destructive)

After owner-approved merge/deploy, before any cutover, verify:
- deployed SHA;
- all 6 `lifecycle_internal_*` flags absent/OFF (internal producers dormant);
- QStash remains sole authority; `lifecycle_touch_schedule` has no unexpected rows;
- no new `jobs_dead_letter` growth; no duplicate sends; no money / DocuSign /
  MicroBilt activity caused by deploy;
- concierge CLOSED auctions excluded from live-auction logic (spot-check a recent
  concierge deposit emitted no `auction_launch` enrollment);
- Program 1 recovery/observability healthy (`cron_job_logs`, health check).

Then perform each QStash cutover separately, under owner authorization, one
workload at a time, watching for duplicates and orphaned scheduled jobs.

## 14. Remaining NOT VERIFIED

- **NOT VERIFIED — REQUIRES PRODUCTION ACCESS:** Program 1 deploy/production-verify
  status; physical presence of `lifecycle_touch_schedule` in prod; current value of
  `CRM_INAPP_ENGINE_ENABLED`.
- **NOT VERIFIED — REQUIRES LIVE TRAFFIC:** end-to-end internal-path send once a
  workload is cut over (a real buyer/dealer must exercise it).
- **OWNER / EXTERNAL:** the Make.com scenario must branch on `data.concierge` to
  avoid live-auction messaging on the concierge path — this repo cannot gate the
  external scenario. The flag is present in the forwarded envelope.
- **NOT PERFORMED (owner-gated per §31):** merge, deploy, flag enablement, QStash
  disablement, production data mutation, test customer/dealer sends.
