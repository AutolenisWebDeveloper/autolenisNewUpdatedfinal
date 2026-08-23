# Automation Vendor Retirement Readiness

Companion to `docs/inngest-migration-ledger.md`. Where the Inngest ledger tracks the
**executed** retirement of Inngest as a runtime, this document is the **evidence-based
readiness assessment** for the other automation vendors — **QStash, Make.com, GHL, and
Buffer** — produced by a repo-wide trace of every producer, consumer, guard, and env
gate. It authorizes **no cutover**: it maps each vendor, states a verdict, and lists the
owner-gated steps a future cutover would take.

> **Nothing here has been deleted, disconnected, or cut over.** All findings are
> read-only. Production env state (which secrets are actually set) cannot be read from
> the repo — every such item is flagged **OWNER-CHECK**.

---

## QStash (Upstash) — big & LIVE · retirement readiness

**What it is.** QStash is used **only as a delayed-HTTP job queue**: `dispatch()`
(`lib/qstash/dispatch.ts`) calls `publishJSON({ url, body, delay, retries })`. There are
**no QStash-native schedules/crons** — all recurring cadence is Vercel Cron
(`vercel.json`); multi-touch sequences are per-message `delaySeconds`. The client
(`lib/qstash/client.ts`), receiver/verify (`lib/qstash/{receiver,verify}.ts`), shared
DB stop-guards (`lib/qstash/state.ts`), and the send layer (`lib/qstash/notify.ts`,
TCPA-gated Twilio + suppression-gated Resend) complete the surface. Env:
`QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`
(`QSTASH_URL` is declared but **unused** — base URL comes from `NEXT_PUBLIC_APP_URL`).

**Consumers (16 routes under `app/api/jobs/**`).** Every route verifies the signature
(`verifyQStashRequest` → 401) and returns HTTP 500 on error so QStash retries. **None
mutates money/deal/auction/deposit state — all send notifications** and some chain the
next delayed touch. "Deal-path" below therefore means *triggered by / gated on* the
deposit/auction/offer/deal-completion path, not money movement.

### Complete per-job disposition (all 16, evidence-backed from the current branch)

| Job route | Actual behavior (code) | Disposition | Internal replacement |
| --- | --- | --- | --- |
| `deposit-reminder` | 3-touch $99 activation reminder; reads `hasPaidDeposit` | DEFER (deposit/money-path) | — |
| `auction-active` | auction-started notify; seeded from **Stripe webhook** (deposit PAID) | DEFER (auction lifecycle) | — |
| `auction-midpoint` | mid-auction notify; reads `hasSelectedOffer` | DEFER (auction lifecycle) | — |
| `auction-closing` | closing notify; auction lifecycle | DEFER (auction lifecycle) | — |
| `dealer-invited` | dealer invite notify; seeded from `dealer-invitation.service` | DEFER (dealer participation in live deal) | — |
| `dealer-bid-reminder` | bid reminder; reads `hasDealerBid` | DEFER (bids) | — |
| `offer-received` | offer-received notify; seeded from `dealer/offers` | DEFER (offers) | — |
| `offer-follow-up` | offer follow-up; reads `hasSelectedOffer` | DEFER (offers) | — |
| `deal-complete` | deal-complete notify; seeded from pickup/complete; seeds `review-request` | DEFER (deal completion) | — |
| `form-submitted` | intake welcome; seeds `check-form-completion` | DEFER (funnel entry into deposit path) | — |
| `check-form-completion` | 3-touch activation nudge; reads `hasPaidDeposit` | DEFER (reads deposit state) | — |
| `review-request` | post-purchase feedback notify; **sole producer is the deferred `deal-complete`**; fans out to refinance + referral | DEFER (deal-completion-coupled) — its route is the cutover enqueue-point for refinance/referral | — |
| `refinance-outreach` | 60-day OpenRoad refinance notify; guarded by completed-purchase + `BuyerActivityEvent` | **INTERNAL PARITY BUILT** | `refinance_outreach_schedule` + `refinance-outreach-drain` |
| `referral-nudge` | buyer referral notify (terminal); no guard | **INTERNAL PARITY BUILT** | `outreach_touch_schedule` (`referral_nudge`) + `outreach-touch-drain` |
| `affiliate-inactive` | affiliate re-engagement notify; seeded from `cron/affiliate-inactive` (Vercel cron, non-deal); chains `affiliate-reengagement-2` | **INTERNAL PARITY BUILT** | `outreach_touch_schedule` (`affiliate_inactive`) + `outreach-touch-drain` |
| `affiliate-reengagement-2` | affiliate 2nd-touch notify (terminal); no guard | **INTERNAL PARITY BUILT** | `outreach_touch_schedule` (`affiliate_reengagement_2`) + `outreach-touch-drain` |

**No `DEAD/DUPLICATE` job found** — every one of the 16 has a live producer/consumer.
The four `INTERNAL PARITY BUILT` are the only jobs whose behavior is purely non-deal
notification with no money/deal-state read or write; the rest are deal/money-path or
(review-request) coupled to a deferred deal-path producer.

### Migration split

**DEAL-PATH — DEFER TO THE BUSINESS-LIFECYCLE PROGRAM (do NOT rewire in this run):**
| Job route | Seeded from |
| --- | --- |
| `deposit-reminder` (3-touch $99 activation) | `buyer/deposit/create-intent`, `buyer/onboarding/complete` |
| `auction-active` → `auction-midpoint` → `auction-closing` | **Stripe webhook** (deposit PAID + auction created) |
| `offer-received` → `offer-follow-up` | `dealer/offers` (dealer submits an offer) |
| `dealer-invited` → `dealer-bid-reminder` | `auction/dealer-invitation.service` |
| `deal-complete` → (seeds `review-request`) | `admin/deals/[id]/pickup/complete` |

These are woven into the transaction funnel and read live deal state via
`lib/qstash/state.ts` (`hasPaidDeposit`, `hasSelectedOffer`, `hasDealerBid`). Rewiring
the payment/auction/deal path is explicitly **out of scope** for the automation-
consolidation run and belongs to the business-lifecycle program.

**BORDERLINE (funnel entry — treat as deal-path / defer):** `form-submitted`,
`check-form-completion` — generic in content but structurally sit in the
deposit-activation funnel and read live deposit state (`hasPaidDeposit`). Recommend
deferring with the deal-path set.

**NON-DEAL-PATH — internal parity BUILT this run (all four):** `refinance-outreach`
(own table — reference implementation), plus `referral-nudge`, `affiliate-inactive`,
`affiliate-reengagement-2` (consolidated `outreach_touch_schedule`).
`review-request` is DEFERRED (its sole producer, `deal-complete`, is deal-path) —
its route is the cutover enqueue-point for refinance/referral, so those two cut over
by editing `review-request`'s dispatch lines while it itself stays QStash-triggered.

**`refinance-outreach` — internal parity BUILT (DORMANT) this run (reference
implementation):**
- `prisma/migrations/manual_supabase_sql/refinance_outreach_schedule.sql`
  (additive, OWNER-GATED): durable single-touch queue table with
  `UNIQUE(dedup_key)` (enqueue-once per buyer) + a partial due index.
- `lib/services/refinance/refinance-outreach-drain.service.ts`:
  `enqueueRefinanceOutreach` (dormant producer — upsert `ON CONFLICT (dedup_key)
  DO NOTHING`, run_at = deal-complete + ~60d) and `drainDueRefinanceOutreach`
  (claim CAS + stale reclaim; re-checks the SAME guards the QStash route enforced
  — completed-purchase count + the `REFINANCE_EMAIL_SENT`/`CLICKED`
  `BuyerActivityEvent` send-guard; sends through the SAME `notifyContact`
  TCPA/suppression-gated layer; bounded retry `MAX=4`; **columns-only terminal**,
  nothing to `jobs_dead_letter`; a missing table pre-cutover returns `NO_TABLE`,
  not an error).
- `app/api/cron/refinance-outreach-drain/route.ts` (cron auth + `withCronRun`,
  `*/15`) + `vercel.json` + the CRON_STALENESS registry.
- Tests: `lib/services/refinance/__tests__/refinance-outreach-drain.test.ts` (11)
  + `app/api/cron/__tests__/refinance-outreach-drain-route.test.ts` (3), under
  `test:refinance` (now runs with `--experimental-test-module-mocks`) / `test:cron`.
- **DORMANCY / single-authority proof:** `enqueueRefinanceOutreach` has **zero
  production callers** — the touch is still enqueued to QStash from the
  `review-request` job (`dispatch({ path:'/api/jobs/refinance-outreach',
  delaySeconds:5184000 })`, unchanged), and the QStash route is untouched. The
  cron therefore no-ops (`NO_DUE`/`NO_TABLE`). QStash stays the SOLE live authority
  — the HARD INVARIANT (never two authorities able to send the same message) holds.
- **Owner-gated ATOMIC cutover (NOT executed):** (1) apply
  `refinance_outreach_schedule.sql` to Supabase; (2) in `review-request`'s route,
  replace the single `dispatch({ path:'/api/jobs/refinance-outreach', … })` with
  `enqueueRefinanceOutreach({ buyerId, firstName, email, leadId: buyerId, runAt:
  now + 60d })`; (3) delete `app/api/jobs/refinance-outreach/route.ts`; (4) make
  `OperationsService.autoDrainDeadLetterJobs` NOT re-publish a
  `qstash:/api/jobs/refinance-outreach` dead-letter row (route it to
  `enqueueRefinanceOutreach`, or drop it — the internal path is columns-only).
  One authority before and after; the swap is a single producer line.

**`referral-nudge` + `affiliate-inactive` + `affiliate-reengagement-2` — internal
parity BUILT (DORMANT) this run (consolidated):**
- `prisma/migrations/manual_supabase_sql/outreach_touch_schedule.sql` (additive,
  OWNER-GATED): ONE sequence-discriminated table (the same multi-sequence shape as
  `lead_nurture_schedule`, NOT a generalized queue — a fixed 3-value CHECK) with
  `UNIQUE(base_key, sequence)` (enqueue-once per touch, closing the QStash
  no-dedup double-send gap) + a partial due index.
- `lib/services/crm/outreach-touch-drain.service.ts`: `enqueueOutreachTouch`
  (dormant producer) and `drainDueOutreachTouches` (claim CAS + stale reclaim;
  message bodies ported **verbatim** from the three QStash routes; sends through
  the SAME `notifyContact` TCPA/DNC/suppression/STOP-gated layer; a gated/suppressed
  send is a terminal success exactly as the QStash job treats it; `affiliate_inactive`
  chains `affiliate_reengagement_2` at +14d reusing the base_key; bounded retry
  `MAX=4`; **columns-only terminal**; missing table → `NO_TABLE`, not an error).
- `app/api/cron/outreach-touch-drain/route.ts` (cron auth + `withCronRun`, `*/15`)
  + `vercel.json` + the CRON_STALENESS registry.
- Tests: `lib/services/crm/__tests__/outreach-touch-drain.test.ts` (14) +
  `app/api/cron/__tests__/outreach-touch-drain-route.test.ts` (3), under
  `test:crm-services` / `test:cron`.
- **DORMANCY / single-authority proof:** `enqueueOutreachTouch` has **zero
  production callers** — `affiliate_inactive` is still dispatched to QStash from the
  `cron/affiliate-inactive` Vercel cron (its recent-activity + weekly
  `lastInactiveNudgeAt` guard UNCHANGED on the producer), the QStash job still
  chains `affiliate-reengagement-2`, and `referral-nudge` is still dispatched from
  the `review-request` job — all UNCHANGED. The cron no-ops (`NO_DUE`/`NO_TABLE`).
  QStash stays the SOLE live authority for all three.
- **Owner-gated ATOMIC cutovers (NOT executed):** apply
  `outreach_touch_schedule.sql`; then per touch — (referral) in `review-request`,
  swap `dispatch({ path:'/api/jobs/referral-nudge', delaySeconds:2332800 })` →
  `enqueueOutreachTouch({ sequence:'referral_nudge', …, runAt: now+27d })`;
  (affiliate) in `cron/affiliate-inactive`, swap the `dispatch({ path:
  '/api/jobs/affiliate-inactive' })` → `enqueueOutreachTouch({ sequence:
  'affiliate_inactive', …, runAt: now })` (the drain then chains reengagement-2
  internally); delete the three QStash routes; make
  `OperationsService.autoDrainDeadLetterJobs` not re-publish those `qstash:*` rows.
  One authority before and after each swap.

**`review-request` (DEFERRED — deal-completion-coupled) stays a QStash job.** At the
refinance/referral cutovers its route is simply edited to call the internal
`enqueue*` functions instead of `dispatch()`; it remains QStash-triggered by the
deferred `deal-complete`, so no dual authority arises. Its own migration off QStash
belongs to the business-lifecycle program alongside `deal-complete`.

**Parity requirements any internal replacement MUST reproduce:** (1) the signature-
verify equivalent (worker auth), (2) the `lib/qstash/state.ts` stop-guards (+
`refinance-outreach`'s `BuyerActivityEvent` guard), (3) `retries`/HTTP-500 retry
behaviour, (4) the `jobs_dead_letter` DLQ capture in `dispatch.ts` that
`cron/dlq-drain` drains. **Idempotency gap to CLOSE, not replicate:** several un-guarded
jobs (`offer-received`, `dealer-invited`, `auction-active`, `deal-complete`,
`review-request`, `referral-nudge`, the affiliate jobs) have **no message-level dedup**
and can double-send on a QStash retry — an internal queue with a persisted dedup key
should fix this.

**DLQ crossover (important).** `OperationsService.autoDrainDeadLetterJobs` re-publishes
`qstash:*` dead-letter rows via `dispatch()` and all **other** rows via `inngest.send`.
Any QStash workload migrated to an internal path must ensure its dead-letter rows are
re-driven internally (columns-only terminal, as the Inngest content/intake batches did),
**not** through the QStash or Inngest re-emit branches.

**VERDICT — QStash:** **ALL non-deal-path parity BUILT & DORMANT this run** — the four
purely-non-deal notification jobs (`refinance-outreach`, `referral-nudge`,
`affiliate-inactive`, `affiliate-reengagement-2`) have complete internal replacements
(two durable schedulers: `refinance_outreach_schedule` + the consolidated
`outreach_touch_schedule`), each proven dormant (zero production callers; QStash
producers unchanged; QStash the sole live authority). The 12 deal/money-path or
deal-completion-coupled jobs are **DEFERRED to the business-lifecycle program**, each
mapped in the disposition table above. No cutover executed; QStash stays fully wired.
**OWNER-CHECK:** confirm prod `QSTASH_*` secrets and current job volume before any cutover.

---

## Make.com — likely DORMANT · retirement readiness

**What it is.** A single signed-webhook forwarder: `forwardToMake(envelope)`
(`lib/events/make-webhook.ts`) HMAC-signs a versioned `DomainEventEnvelope` and POSTs it
to one Make "router" scenario. Its documented contract: *Make receives every domain
event and owns branching/delay/sequencing, but NEVER sends on its own — it calls back
into `/api/crm/dispatch/*` so AutoLenis owns the actual send + consent + suppression +
idempotency + audit.*

**Dormancy proof (repo-level).** Every dispatch **no-ops when `MAKE_WEBHOOK_URL` is
unset**: `emit.ts` only schedules the forward `if (process.env.MAKE_WEBHOOK_URL)` (else a
WARN), and `make-webhook.ts` returns early when it or `MAKE_WEBHOOK_SECRET` is unset.
`forwardToMake` returns `Promise<void>`, **resolves-never-rejects**, is fire-and-forget
via `after()` (5s timeout), and **no caller inspects its result** — nothing in the repo
depends on the forward succeeding. `MAKE_WEBHOOK_URL` has **no functional reader** besides
the gate + the forwarder.

**Internal equivalent already exists.** The same domain events are consumed internally by
`emitDomainEvent` itself — contact upsert, forward-only lifecycle-stage advance +
`stage_changed` timeline, `domain_event` timeline row, lead scoring
(`recordScoringAction`), interest-tag segmentation. The **actual sends** are owned by the
internal `WorkflowEngine` (`triggerForEvent` + `action.sendEmail/sendSms`) and the
`/api/crm/dispatch/*` endpoints. Make adds **only** externally-hosted scenario
orchestration (branching/delay/sequencing), for which the in-app engine is a built,
flag-gated (`CRM_INAPP_ENGINE_ENABLED`, default off) replacement.

**VERDICT — Make.com:** **READY-TO-RETIRE (no build required to preserve internal data).**
Owner cutover checklist: (1) **OWNER-CHECK** whether prod has `MAKE_WEBHOOK_URL` set AND
`CRM_INAPP_ENGINE_ENABLED` off — if so, live nurture *sequencing* runs only in Make today
and must be enabled in-app (or accepted as lost) before unsetting the URL; (2) unset
`MAKE_WEBHOOK_URL` / `MAKE_WEBHOOK_SECRET`; (3) optionally remove the forwarder. **Do NOT
delete/disconnect in this run.**

---

## GHL (GoHighLevel) — fire-and-forget tag sync · retirement readiness

**What it is.** The entire GHL surface is `syncGhlTag(email, tag)`
(`lib/services/ghl/tag-sync.ts`, ~17 lines): POST `{ email, tags:[tag] }` to
`GHL_WEBHOOK_URL`, fire-and-forget, `void` return, `.catch(()=>{})`. **No-ops when
`GHL_WEBHOOK_URL` is unset or `email` is missing.** Nothing in the repo reads GHL data
back — it is a pure outbound sink. Two adjacent env-gated webhooks exist:
`GHL_PARTIAL_LEAD_WEBHOOK_URL` and client-side `NEXT_PUBLIC_GHL_THANKYOU_WEBHOOK_URL`
(same no-op-if-unset pattern).

**Tags synced (10 sites):** `deposit-paid`, `offer-received`, `offer-selected`,
`dealer-invited`, `dealer-won`, `dealer-applied`, `dealer-approved`,
`affiliate-applied`, `affiliate-approved`, `purchase-complete`.

**Already captured internally.** Every tagged milestone is a domain event AutoLenis
already records natively via `emitDomainEvent`: the same events write
`contact_timeline_events`, advance `lifecycle_stage`, accrue lead score, and set
`contacts.tags`. The tags are outbound labels for GHL-hosted automations; their *meaning*
already lives in AutoLenis's own CRM.

**VERDICT — GHL:** **READY-TO-RETIRE (minimal/no build).** The only thing lost is external
GHL-side automations keyed on those tags — an operational/marketing concern, not a code
dependency. Owner cutover checklist: (1) **OWNER-CHECK** whether GHL-hosted journeys are
live off these tags in prod; (2) if a specific automation must persist, map it to the
internal CRM (segment + workflow) first; (3) unset `GHL_WEBHOOK_URL` /
`GHL_PARTIAL_LEAD_WEBHOOK_URL` / `NEXT_PUBLIC_GHL_THANKYOU_WEBHOOK_URL`. **Do NOT
delete/disconnect in this run.**

---

## Buffer — real social infra · retirement readiness

**What it is.** A full `PublishingProvider` against Buffer's GraphQL API
(`lib/social/providers/buffer.provider.ts`, Bearer `BUFFER_API_KEY`) plus an admin
management surface (list/edit/duplicate/delete). Provider selection
(`publishing.factory.ts`): Facebook/Instagram → `MetaProvider` if `META_ACCESS_TOKEN`
else Buffer; TikTok → `TikTokProvider` if `TIKTOK_ACCESS_TOKEN` else Buffer; LinkedIn →
`LinkedInProvider` if `LINKEDIN_ACCESS_TOKEN` else Buffer; **YouTube → always delegates to
Buffer (no first-party publish surface); default/unknown → Buffer.** Publishing is
**disabled by default** (`ENABLE_BUFFER_PUBLISHING`, ships empty → `NoopPublishingProvider`
returns "publishing disabled").

**What actually publishes.** The `social-publish-queue` cron (every 5m) selects due
`APPROVED`/`SCHEDULED` `SocialPost` rows across tiktok/instagram/facebook/youtube/linkedin
and calls `publishApprovedPost` (atomic row claim). Direct-platform providers
(Meta Graph API, TikTok Content Posting API, LinkedIn ugcPosts) **supersede Buffer when
their token is set** — but they publish immediately (no native scheduling; AutoLenis's own
DB+cron handles future scheduling). **YouTube has NO in-repo direct publisher** — retiring
Buffer removes the only YouTube publish surface, and Buffer is the universal fallback for
every platform when direct tokens are absent.

**VERDICT — Buffer:** **PARITY-NOT-JUSTIFIED (keep / document, do not build speculative
social infra).** Direct-platform parity already exists for FB/IG/TikTok/LinkedIn; replacing
Buffer would require net-new YouTube upload OAuth+resumable-upload infrastructure plus
re-implementing provider-native scheduling and the admin management surface — speculative
work with no clear economic justification given Buffer ships gated-off. Recommend
**documenting** Buffer as (a) the YouTube publish surface and (b) the universal fallback,
rather than retiring it. **OWNER-CHECK:** whether prod sets `ENABLE_BUFFER_PUBLISHING=true`
and which of `META_/TIKTOK_/LINKEDIN_ACCESS_TOKEN` are set — that determines how much live
traffic flows through Buffer vs direct APIs today.

---

## Cross-vendor summary

| Vendor | No-ops when unset | Anything depends on its response | Internal equivalent | Verdict |
| --- | --- | --- | --- | --- |
| **QStash** | n/a (LIVE) | Consumers send notifications; no money mutation | Vercel-Cron+Postgres substrate (proven) | **All 4 non-deal jobs parity BUILT+DORMANT; 12 deal/coupled jobs DEFERRED (mapped)** |
| **Make.com** | Yes | No | `WorkflowEngine` + `/api/crm/dispatch/*` (flag-gated) | **Ready-to-retire · OWNER-CHECK prod flags** |
| **GHL** | Yes | No (`void`, `.catch`) | contacts/lifecycle/timeline/tags via `emitDomainEvent` | **Ready-to-retire · OWNER-CHECK GHL automations** |
| **Buffer** | Yes (Noop provider) | Publish outcome consumed; self-heals to FAILED/retry | Partial — direct FB/IG/TikTok/LinkedIn; **no direct YouTube** | **Parity-not-justified (keep/document) · OWNER-CHECK prod tokens** |

**No production side effects were produced generating this assessment, and no vendor
config, route, key, package, or subscription was changed.**
