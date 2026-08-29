# Inngest Retirement — Migration Ledger

Repository-local ledger for the workload-by-workload retirement of **Inngest** as a
runtime dependency. Vendor direction (owner-locked): **Inngest → REMOVE after
complete internal parity.** The internal substrate is the proven **Vercel Cron →
App-Router route → application/domain services → Postgres** pattern, with
`withCronRun()` / `cron_job_logs` observability and the `idempotency_keys` /
`jobs_dead_letter` tables.

> This ledger is **inventory + handoff only**. It authorizes nothing beyond the
> batch that wrote/updated it. Each subsequent workload is its own reviewed batch.

Status legend:
`KEEP TEMPORARILY` · `MIGRATE TO EXISTING INTERNAL PATH` · `MIGRATE TO DB-SCHEDULED STATE` ·
`DUPLICATE — DELETE AFTER PARITY` · `DEAD/UNUSED` · `LIVE VERIFICATION REQUIRED` ·
`MIGRATED` · `READY FOR REMOVAL`

---

## Global Inngest surface (do NOT remove in a workload batch)

| Component | File | Notes |
| --- | --- | --- |
| Inngest client | `lib/inngest/client.ts` | `new Inngest({ id: 'autolenis' })`. Remove only after ALL workers gone. |
| Serve endpoint | `app/api/inngest/route.ts` | Registers all function arrays. Keep until every worker migrated. |
| DB idempotency primitives | `lib/jobs/idempotency.ts` (re-exported by `lib/inngest/idempotency.ts`) | Transport-agnostic; **reused** by the internal path. Keep. |
| DLQ table | `jobs_dead_letter` (migrations/01) | Keep — shared infra. |
| Idempotency table | `idempotency_keys` (migrations/01) | Keep — shared infra. |
| Env: `INNGEST_SIGNING_KEY`, `INNGEST_EVENT_KEY` | Vercel env | Owner-gated; remove only at final retirement. |

Registered function arrays (as of **Batch 9 — Inngest workload retirement COMPLETE**):
`app/api/inngest/route.ts` now serves only `intakeFunctions`
(`lib/inngest/intake-functions.ts`, a dormant buyer-intake compatibility sink with
NO live emitter). **`inngestFunctions` (`lib/inngest/functions.ts`) is now `[]`** —
every worker it once held is migrated onto the internal Vercel-Cron substrate
(`analyticsRefreshFn`/`inactivityScannerFn`/`savedSearchMatcherFn` Batch 3,
content Batch 4, `workflowResumeFn` Batch 5, `emailSendFn`/`smsSendFn` Batch 6b,
`dealerAwardFn` Batch 7, `campaignFanoutFn`/`scheduledCampaignCronFn` Batch 8,
`formAbandonmentFn`/`exitIntentFn` Batch 9). `dealerAwardFunctions`
(`lib/inngest/dealer-award-functions.ts`) and `contentFunctions`
(`lib/inngest/content-functions.ts`) were **deleted** in Batches 7 and 4. The only
remaining Inngest surface is the global infra in the table above — removed by the
**owner-gated FINAL-REMOVAL checklist** (`docs/inngest-final-removal-checklist.md`,
ready-to-execute, **not executed by the automation run**), after live verification.

---

## Workload inventory

### 1. Buyer intake — `intakeProcessFn`  ⟶  **MIGRATED (this batch)**

| Field | Value |
| --- | --- |
| Function / event | `intakeProcessFn` / `autolenis/intake.process` |
| Business purpose | Market enrichment → dealer discovery → phone-script drafting → lead scoring + hot-lead alerts → dealer outreach → coverage gate, per BuyerOpportunity. |
| Former emitters | `unified-buyer-intake.service.ts::promoteOpportunity`, `app/api/concierge/route.ts` (early-lead), `app/api/cron/intake-reconcile/route.ts` (re-emit). **All removed.** |
| Business logic owner | `lib/services/acquisition/intake-pipeline.service.ts::runIntakePipeline` (already Inngest-free) wrapped by `lib/services/acquisition/intake-processor.service.ts::processBuyerOpportunityIntake`. |
| Trigger (new) | Vercel Cron `/api/cron/intake-reconcile` (*/5) → `processEligibleBuyerIntakes`. Authoritative execution AND recovery in one path. |
| Delay semantics | None required. |
| Retry semantics | Next cron tick re-drives any incomplete row (idempotent, resumable). |
| Concurrency semantics | Crash-safe claim (`claimJob` on `idempotency_keys`, staleMs 10m > route maxDuration 300s); one executor per opportunity; overlapping ticks safe. |
| Idempotency | Per-stage guards in the pipeline (`marketEnrichedAt`, existing prospects, `scriptDraftedAt`, `leadTemperature`, outreach `outreachLog` dedup) + `intakeProcessedAt` completion marker. |
| External side effects | Groq/compound web search, dealer discovery, Resend email, Twilio SMS (founder + buyer), dealer outreach email. |
| Existing internal equivalent | The Vercel-Cron substrate + `runIntakePipeline`. |
| Replacement | Done — `processEligibleBuyerIntakes` cron. |
| Completion semantics (Batch 2) | `runIntakePipeline` now returns **structured per-stage outcomes** (SUCCESS / ZERO_RESULTS / SKIPPED / FAILED). REQUIRED stages = the sourcing spine (`dealer_discovery`, `dealer_outreach`); all others best-effort. The processor stamps `intakeProcessedAt` **only when no REQUIRED stage FAILED** — ZERO_RESULTS ("ran fine, 0 dealers") is a valid completion; an EXECUTION failure of a REQUIRED stage is NOT. |
| Bounded retry + terminal (Batch 2) | A REQUIRED-stage failure increments `buyer_opportunities.intake_attempts`; at `MAX_INTAKE_ATTEMPTS` (3, matching the retired worker's `retries:3`) the row is dead-lettered by setting `intake_failed_at` (+ sanitized `intake_failure_reason`). Terminal state lives **only on BuyerOpportunity** — nothing is written to `jobs_dead_letter`, so the Inngest-based DLQ drainer (`OperationsService.autoDrainDeadLetterJobs → inngest.send`) can NEVER re-emit a terminal intake. The eligibility query excludes `intake_failed_at IS NOT NULL`, so a provider outage can't re-drive one every 5 min forever. |
| Observability (Batch 2) | `cron_job_logs.result` now disambiguates `succeeded` / `zeroSupply` / `requiredStageFailed` / `deadLettered` / `stageFailureCounts`; `businessDead` (zero completions + execution failures) escalates to a FAILED cron / HTTP 500, while an all-ZERO_SUPPLY batch stays green. |
| Migration difficulty | Medium (idempotency/concurrency/historical-safety + completion-policy analysis). |
| Cutover risk | **Additive schema** (`intake_attempts`, `intake_failed_at`, `intake_failure_reason`) — **PRODUCTION CUTOVER REQUIRES `prisma migrate deploy` — OWNER-GATED** (deploy the migration with/before this code; the eligibility query references `intake_failed_at`). Historical-safety unchanged (48h window + optional `INTAKE_ELIGIBILITY_START_AT`). |
| Test/parity | `lib/jobs/__tests__/idempotency-claim.test.ts`, `lib/services/acquisition/__tests__/{intake-processor,intake-pipeline-outcomes,post-intake-outreach-status}.test.ts`, `app/api/cron/__tests__/intake-reconcile-route.test.ts`, `lib/inngest/__tests__/intake-process.test.ts`, updated `promote-opportunity` / `unified-intake-emit` / `intake-turn` tests. |
| Live verification | Confirm `cron_job_logs` for `intake-reconcile` shows the disambiguated fields after deploy; force a REQUIRED-failure (temporarily break discovery/outreach in staging) and confirm `requiredStageFailed` → retry → `deadLettered` at attempt 3, with `intake_failed_at` set and the row no longer re-selected; confirm no `autolenis/intake.process` events remain queued in Inngest Cloud before removing the worker. |
| Dependency order | None (leaf workload). |
| **Status** | **MIGRATED + trustworthy completion (Batch 2).** No repo code requires Inngest for intake; terminal/retry is Inngest-free (columns-only, not `jobs_dead_letter`). Worker retained as dormant compatibility sink → `READY FOR REMOVAL` after live verification confirms an empty Inngest queue. |

### 2 & 3. Email / SMS — `emailSendFn` / `smsSendFn` (`autolenis/email.send`, `autolenis/sms.send`)  ⟶  **MIGRATED + workers DELETED (Batch 6a infra + 6b cutover)**

> **Batch 6b (the atomic cutover) is DONE.** Every `autolenis/email.send` / `autolenis/sms.send` emitter now calls `enqueueEmail`/`enqueueSms` (repo grep for those event names as emitters returns ZERO); `emailSendFn`/`smsSendFn`/`runEmailSend`/`runSmsSend` are deleted from `functions.ts` and removed from `inngestFunctions`; `dlq-behavior.test.ts` (which drove the deleted workers) is removed; `OperationsService.retryDeadLetterJob`/`autoDrainDeadLetterJobs` now route `autolenis/email.send`→`enqueueEmail` and `autolenis/sms.send`→`enqueueSms` (Inngest-free replay), keeping `inngest.send` only for still-live workers (e.g. `autolenis/dealer.award`). **Emitters cut over:** `transactional-dispatch` (covers dealer-award, which routes through `enqueueTransactionalEmail`), `nurture-sequence`, `lead-magnet-sequence`, `workflow.engine` (email/sms/notify), admin `send-email`/`send-sms`/`campaigns/bulk-send`, and — inside the still-on-Inngest campaign/lead workers — `campaignFanoutFn`, `formAbandonmentFn` (×3), `exitIntentFn`. **PRODUCTION CUTOVER REQUIRES applying `comms_outbox.sql` to Supabase BEFORE this code deploys — OWNER-GATED** (enqueue throws if the table is absent). Sender-migration + dealer-award tests updated; full matrix (975 tests) green. Detail of the 6a infrastructure below.

**Batch 6a — the internal comms-dispatch queue (built & now LIVE-emitted-into after 6b):**

- **Emitters (all must cut over in 6b):** `lib/services/email/{nurture-sequence,lead-magnet-sequence,transactional-dispatch}.ts`, `workflow.engine.ts` (email/sms/notify), `dealer-award` sender wrappers, admin CRM `send-email`/`send-sms`/`campaigns/bulk-send`, `campaignFanoutFn`, `formAbandonmentFn`, `exitIntentFn`.
- **Internal comms-dispatch queue — BUILT & DORMANT (Batch 6a):**
  - `comms_outbox` table (`prisma/manual_supabase_sql/comms_outbox.sql`, additive Supabase, **OWNER-GATED**): `channel`, **`dedup_key` UNIQUE**, `status`, `payload` jsonb, `attempts`, `run_at`, `claimed_at`, `last_error`, `last_result`, `provider_id`.
  - `lib/services/comms/comms-outbox.service.ts`: `enqueueEmail`/`enqueueSms` (INSERT … ON CONFLICT (dedup_key) DO NOTHING → **enqueue-once**, the HARD dedup), `deliverEmail`/`deliverSms` (faithful reproduction of the retired workers' consent/DNC/suppression-hard-vs-soft/TCPA gates + content resolve + provider send + EmailSendLog/timeline/campaign_recipients recording), and `drainCommsOutbox`/`processOutboxRow` (claim CAS with stale-reclaim, bounded retry `MAX=4`, **columns-only terminal** — status='failed', nothing to jobs_dead_letter).
  - `lib/services/comms/comms-providers.ts`: the Resend/Twilio adapter (no raw SDK calls outside it).
  - `app/api/cron/comms-outbox-drain/route.ts` (every minute) + `vercel.json` + CRON_STALENESS.
- **HARD INVARIANT satisfied:** dedup at ENQUEUE (unique dedup_key = the producer's idempotencyKey or the recipient+kind+day fallback the workers used) + claim at DRAIN (one drain sends) → retry/dup-event/dup-cron never double-send. Terminal FAILED is columns-only so the Inngest DLQ drainer can't re-emit a comms job. A provider error fails closed (throws → bounded retry), never a fabricated success. The residual crash-mid-send window matches the pre-migration Inngest behaviour (transactional additionally guarded by the EmailSendLog SENT-precheck).
- **DORMANT until 6b:** in 6a nothing enqueues to `comms_outbox` (emitters still `inngest.send`), so the drain is a no-op and there is no double-authority.
- **Security-review hardening (applied):** two duplicate-send vectors the security review flagged are closed. (C1) all POST-SEND bookkeeping (campaign_recipients stamp, timeline insert, EmailSendLog SENT write) is now **best-effort** (try/catch, logged, never re-thrown) so a DB blip after a successful provider send can never re-queue → re-send the message. (P1) a `dispatched_at` column is stamped **immediately before** the provider call; on a stale-claim **reclaim**, a row with `dispatched_at` set is **NOT re-sent** — it is marked terminal `RECLAIM_UNCERTAIN` (a crash after dispatch never double-sends; a genuinely-not-sent message is surfaced for review). Email additionally passes the outbox dedup_key as a **Resend idempotency key** (provider-side ~24h dedup). SMS reclaim relies on the no-resend rule (Twilio has no native idempotency) — parity-or-better vs the retired Inngest worker. (P2, marketing-without-contactId skips the consent gate, is unchanged — parity with the retired worker's CAN-SPAM model, and no cutover emitter sends marketing without a contactId.)
- **Tests (Batch 6a + hardening):** `lib/services/comms/__tests__/comms-delivery.test.ts` (every gate: transactional DUPLICATE/hard-vs-soft-suppression bypass, DNC/missing-contact GATED, marketing CONSENT_GATED, SMS TCPA/INVALID/suppressed, provider-error throw + EmailSendLog FAILED record, happy-path recording, **C1 best-effort bookkeeping**, **onDispatch-before-send**) + `comms-outbox-queue.test.ts` (enqueue dedup, claim CAS, gated terminal, RETRY with backoff, terminal FAILED columns-only, drain aggregation, **reclaim-after-dispatch → RECLAIM_UNCERTAIN**, **reclaim-pre-dispatch → safe re-deliver**) + the drain route contract test.
- **Batch 6b (the atomic cutover — the ONLY step that changes live behaviour):** switch every emitter from `inngest.send('autolenis/email.send'|'…sms.send')` to `enqueueEmail`/`enqueueSms`; delete `emailSendFn`/`smsSendFn` (and, once campaign/lead/dealer-award are internalized, their workers); make `OperationsService.retryDeadLetterJob`/`autoDrainDeadLetterJobs` NOT re-emit `autolenis/email.send`/`sms.send` via `inngest.send`. **This is the big-bang required by the "never two authorities" rule and must ship atomically.**
- Dependency order: 6b unblocks `campaignFanoutFn` (#4), `scheduledCampaignCronFn` (#5), `formAbandonmentFn` (#10), `exitIntentFn` (#11), `dealerAwardFn` (#14) — all fan into email/sms.

### 4 & 5. Campaign fan-out + scheduled cron — `campaignFanoutFn` / `scheduledCampaignCronFn` (`autolenis/campaign.execute`)  ⟶  **MIGRATED + workers DELETED (Batch 8)**
- **Unified onto one cron.** `app/api/cron/campaign-dispatch/route.ts` (`*/2`, cron auth + `withCronRun`) → `lib/services/campaign/campaign-dispatch.service.ts::drainDueCampaigns` scans **due** campaigns (`status='scheduled' AND scheduled_at <= now`) and fans each one out via `processCampaign` (the verbatim fanout logic — segment resolve, DNC/consent/suppression filter, `campaign_recipients` upsert, per-recipient `enqueueEmail`/`enqueueSms` to the outbox, finalize `completed`).
- **Immediate + scheduled unified.** `scheduledCampaignCronFn`'s scan+emit is now the drain's scan. For **send-immediately**, `campaigns/route.ts` no longer emits `campaign.execute` — it stamps the campaign `status='scheduled', scheduled_at=now()` so the same drain picks it up (≤2-min latency vs the old near-instant event — acceptable for marketing).
- **Retry-safe concurrency.** `processCampaign` claims a `claimJob('campaign-dispatch:{id}')` **lease** (NOT a status flip): the campaign stays `'scheduled'` through the fanout, so a failed/crashed run is re-selected and re-driven; the lease is released on success and left `'failed'` (reclaimable, `STALE_MS=10m`) on failure. Idempotency is guaranteed regardless by `UNIQUE(campaign_id, contact_id)` + the outbox dedup_key `campaign:{id}:{contact}:{channel}`, so an overlapping re-run never double-sends.
- **Workers DELETED:** `campaignFanoutFn` + `scheduledCampaignCronFn` removed from `functions.ts` + `inngestFunctions`; `campaigns/route.ts`'s `inngest.send` removed (import dropped). No `campaign.execute` emitter remains.
- **Tests:** `lib/services/campaign/__tests__/campaign-dispatch.test.ts` (NO_DUE, claim→gated-fanout→completed→release, lost-claim NOT_RUNNABLE, no-segment, fanout-failure lease-'failed'+rethrow) + `campaign-dispatch-route.test.ts`. New `test:campaign` suite wired into `test:all` + coverage-check.
- **Status:** **MIGRATED, workers deleted.** No Inngest dependency remains for campaigns. Live verification: create an immediate + a scheduled campaign; confirm `cron_job_logs` for `campaign-dispatch` fans them out and each completes once.

### 6. Workflow resume — `workflowResumeFn` / `autolenis/workflow.resume`  ⟶  **MIGRATED + worker DELETED (Batch 5)**
- **Delay is now durable Postgres state, not Inngest's `ts`.** The WorkflowEngine `delay` node persists `resume_at` (when) + `resume_node_id` (which node) on the `workflow_enrollments` row instead of emitting `autolenis/workflow.resume` with a future `ts`. Additive Supabase migration `prisma/manual_supabase_sql/workflow_scheduled_resume.sql` adds the two columns + a partial index `WHERE resume_at IS NOT NULL AND status='active'`. **PRODUCTION CUTOVER REQUIRES applying this SQL to Supabase — OWNER-GATED** (raw Supabase, not `prisma migrate deploy`).
- **New home:** `lib/services/crm/workflow-resume-drain.service.ts::drainDueWorkflowResumes` driven by `app/api/cron/workflow-resume-drain/route.ts` (cron auth + `withCronRun`, `* * * * *` for ≤1-min resume lateness on long nurture delays, `maxDuration=300`). Registered in `vercel.json` + CRON_STALENESS.
- **Crash-safe at-least-once (reuses `claimJob`):** each due row is claimed on `workflow-resume:{enrollment}:{node}` (reclaimable after 10-min stale). `resume_at` is cleared **only after a successful resume**, and **only if unchanged** (`.eq('resume_at', originalResumeAt)`) — a re-suspend at a later delay writes a new future `resume_at` that the conditional clear leaves intact. A failed/crashed resume leaves `resume_at` set → re-selected + re-driven next tick. `resumeEnrollment` is idempotent per node (its email/SMS/notify sends already carry `workflow:{enrollment}:{node}:{channel}` idempotency keys), so a re-run never double-sends.
- **No delay-path Inngest, no DLQ:** the delay node's only write is the enrollment update; nothing goes to `jobs_dead_letter`, so the Inngest DLQ drainer can't re-emit a workflow resume. (The engine still imports `inngest` for its email/SMS/notify sends — those ride the email.send/sms.send spine and are the SEPARATE comms migration.)
- **Worker DELETED:** `runWorkflowResume` + `workflowResumeFn` removed from `functions.ts` and `inngestFunctions`; the two `workflowResumeFn` DLQ tests removed from `dlq-behavior.test.ts` (email/SMS DLQ tests retained).
- **Dormancy:** the WorkflowEngine is double-gated OFF in prod (every workflow archived by the Make cutover T1 + `CRM_INAPP_ENGINE_ENABLED` default off), and the `resume_at` column is brand-new, so there are ZERO live/pending resumes today — this batch is dormant-safe and only takes effect if the in-app engine is re-enabled. When disabled, `resumeEnrollment` no-ops and the drain clears any (non-existent in prod) stale resume — acceptable for the retired state.
- **Tests:** `lib/services/crm/__tests__/workflow-resume-drain.test.ts` (NO_DUE, claim+resume+conditional-clear, lost-claim skip, failed-resume no-clear + guard 'failed', malformed-row clear, query-error throw) + `app/api/cron/__tests__/workflow-resume-drain-route.test.ts`.
- **Independent-review follow-up (applied):** (1) **stranded-suspend fix (CONFIRMED regression)** — the delay node now checks the persist `error` and returns `{status:'failed'}` on a write failure (mirroring the sibling write nodes + the old `inngest.send` throw), so a failed `resume_at` write fails the node instead of reporting `suspended` with no durable state. (2) **loop-key collision** — the claim key now includes the `resume_at` instant (`workflow-resume:{enrollment}:{node}:{resume_at}`) so a workflow that loops back through the same delay node gets a distinct claim identity and isn't blocked forever by the prior pass's `completed` guard. (3) **disable-strand** — the drain now short-circuits (`ENGINE_DISABLED`) when `CRM_INAPP_ENGINE_ENABLED` is off, leaving `resume_at` intact so a pending resume survives a disable window and fires on re-enable instead of being silently discarded. Tests added for the disabled-engine path + updated key assertions.
- **Status:** **MIGRATED, worker deleted.** No Inngest dependency remains for workflow resume. Live verification (only if the in-app engine is re-enabled): confirm a delay node persists `resume_at` and the `workflow-resume-drain` cron resumes it on schedule.

### 7. Inactivity scanner — `inactivityScannerFn` / **Inngest cron `0 * * * *`**  ⟶  **MIGRATED (Batch 3)**
- **New home:** `lib/services/crm/inactivity-scanner.service.ts::scanInactiveContacts` (business logic) driven by Vercel Cron route `app/api/cron/inactivity-scan/route.ts` (cron auth + `withCronRun`). Schedule added to `vercel.json` at the **same** `0 * * * *` cadence. Removed from `inngestFunctions`.
- **Side effects:** unchanged — emits `buyer_inactive` per stale early-stage contact through `emitDomainEvent` (Make forward + optional in-app engine; **no direct email/SMS, no `inngest.send`**). NOT one of the safety-sensitive direct-comms paths.
- **Idempotency:** unchanged — the spine's forward-only lifecycle advance moves an emitted contact to `inactive`, so it drops out of `EARLY_STAGES` and is never re-emitted. Per-contact `try/catch` isolation preserved; no-identity rows skipped.
- **Deliberate divergence (improvement):** the Supabase query error is now surfaced (`throw inactivity_scan_query_failed`) so a DB failure records a FAILED cron / HTTP 500 instead of the old silent `data ?? []` → green. Stricter, matches the "no green run conceals a dead workload" rule; the next hourly tick replays.
- **Tests:** `lib/services/crm/__tests__/inactivity-scanner.test.ts` (emit-once, skip-no-identity, per-item isolation, NO_STALE, query-error throw) + `app/api/cron/__tests__/inactivity-scan-route.test.ts` (auth guard, delegation, 500-on-throw).
- **Status:** **MIGRATED.** `READY FOR REMOVAL` of the Inngest function once live verification confirms the Inngest cron no longer fires (see below).

### 8. Saved-search matcher — `savedSearchMatcherFn` / **Inngest cron `0 */6 * * *`**  ⟶  **MIGRATED (Batch 3)**
- **New home:** `lib/services/crm/saved-search-matcher.service.ts::matchSavedSearches` driven by `app/api/cron/saved-search-match/route.ts`. `vercel.json` schedule at the **same** `0 */6 * * *` cadence. Removed from `inngestFunctions`.
- **Pure mapping extracted:** `buildInventoryWhereFromFilters` moved out of `lib/inngest/functions.ts` into a dependency-free `lib/crm/saved-search-filters.ts` (only the Prisma type); the existing proof test import was repointed there. No behavior change.
- **Side effects:** unchanged — emits `saved_search_matched` via `emitDomainEvent` (Make forward, no direct send). **Dedup:** unchanged — the per-search `lastMatchAt` cursor advances after each alert so the SAME items never re-alert; `domainEntityId` deliberately varies per run so genuinely new matches over time each emit. Per-search `try/catch` isolation preserved.
- **Tests:** `lib/services/crm/__tests__/saved-search-matcher.test.ts` (emit+cursor-advance, no-match no-op, no-identity skip, per-search isolation, NO_SAVED_SEARCHES) + `app/api/cron/__tests__/saved-search-match-route.test.ts` + the moved `lib/crm/__tests__/saved-search-filters.proof.test.ts`.
- **Status:** **MIGRATED.** `READY FOR REMOVAL` after live verification.

### 9. Analytics refresh — `analyticsRefreshFn` / **Inngest cron `0 2 * * *`**  ⟶  **MIGRATED (Batch 3)**
- **New home:** `lib/services/analytics/analytics-refresh.service.ts::refreshAnalyticsViews` (the exact `refresh_analytics_views` RPC the admin manual-refresh route already calls) driven by `app/api/cron/analytics-refresh/route.ts`. `vercel.json` schedule at the **same** `0 2 * * *` cadence. Removed from `inngestFunctions`.
- **Side effects:** none external — REFRESH MATERIALIZED VIEW CONCURRENTLY (idempotent replay). Retry posture unchanged: an RPC error throws → FAILED cron / HTTP 500; the next day's run replays (no dead-letter), matching the Inngest `throw`.
- **Tests:** `lib/services/analytics/__tests__/analytics-refresh.test.ts` (RPC called, OK on success, throw on RPC error) + `app/api/cron/__tests__/analytics-refresh-route.test.ts`.
- **Status:** **MIGRATED.** `READY FOR REMOVAL` after live verification.

### Batch 3 cutover + live verification (shared, entries 7–9)
- **No schema change** — reuses existing tables (`contacts`, `saved_searches`, `inventory_items`, `mv_funnel_metrics`, `cron_job_logs`). Nothing to `prisma migrate deploy` for this batch.
- **Cutover is atomic in the code:** the three functions are removed from `inngestFunctions` **and** the three Vercel crons are added to `vercel.json` in the same change, so after deploy exactly one authority schedules each workload. A brief deploy-window overlap (old deployment's Inngest cron + new deployment's Vercel cron firing once each) is low-risk: these emit only to the (dormant) Make forward + optional in-app engine, never a direct email/SMS, and each side is independently idempotent (stage-advance / lastMatchAt cursor / idempotent RPC).
- **`LIVE VERIFICATION REQUIRED`** before deleting the Inngest function *definitions*: confirm `cron_job_logs` shows `analytics-refresh` / `inactivity-scan` / `saved-search-match` running green with real work, AND confirm the corresponding Inngest crons no longer fire (Inngest Cloud dashboard) after the deploy sync.

### 10 & 11. LP lead-nurture — `formAbandonmentFn` / `exitIntentFn` (`autolenis/lead.form_abandoned`, `autolenis/lead.exit_intent_captured`)  ⟶  **MIGRATED + workers DELETED (Batch 9) — LAST live Inngest workload**
- **The inter-touch delay is now durable Postgres state, not Inngest `step.sleep`.** The 3-touch form-abandonment sequence (`1h → 23h → 72h`) and the single 30-min exit-intent recovery are each a chain of durable `lead_nurture_schedule` rows: `run_at` holds WHEN a touch fires, and the `lead-nurture-drain` cron sends the due touch (re-checking the lead's completion + suppression at send time) and schedules the NEXT touch. Nothing depends on Inngest, `setTimeout`, or a detached promise.
- **New home:** `lib/services/crm/lead-nurture.service.ts` (`scheduleLeadNurture` enqueues touch 1; `drainDueLeadNurture` sends due touches + schedules the next) driven by `app/api/cron/lead-nurture-drain/route.ts` (cron auth + `withCronRun`, `* * * * *` for ≤1-min lateness on the long nurture windows, `maxDuration=120`). Registered in `vercel.json` + the CRON_STALENESS registry (`intervalMinutes:1`).
- **Emitters rewired:** `app/api/public/crm/partial-lead/route.ts` (`form_abandoned` → `scheduleLeadNurture('form_abandonment', …)`) and `app/api/public/crm/exit-intent/route.ts` (`exit_intent_captured` → `scheduleLeadNurture('exit_intent', …)`). Both dropped the `inngest` import. A repo grep for `autolenis/lead.form_abandoned` / `autolenis/lead.exit_intent_captured` as **emitters** now returns ZERO (only the DLQ replay branch + the retired-worker SQL/doc references remain). (The additive `emitDomainEvent('partial_lead_captured'|'exit_intent_captured', …)` calls in those routes are the SEPARATE Make/CRM domain-event spine — never Inngest events — and are unchanged.)
- **Migration schema (additive, OWNER-GATED):** `prisma/manual_supabase_sql/lead_nurture_schedule.sql` — the `lead_nurture_schedule` table (`sequence`, `step`, `contact_id`, `contact_email`, `first_name`, `campaign`, `idempotency_key`, `run_at`, `status ∈ {pending,sending,done,canceled,failed}`, `attempts`, `last_error`, `claimed_at`), a **`UNIQUE(idempotency_key, step)`** index (enqueue-once per touch), and a partial due index `ON (run_at) WHERE status IN ('pending','sending')`. Raw Supabase SQL — **PRODUCTION CUTOVER REQUIRES applying this SQL to Supabase — OWNER-GATED** (not `prisma migrate deploy`; `scheduleLeadNurture` throws if the table is absent).
- **HARD INVARIANT — zero duplicate touches:** dedup at THREE layers. (1) Scheduling a touch is enqueue-once via `UNIQUE(idempotency_key, step)` + `ON CONFLICT DO NOTHING (ignoreDuplicates)` — a re-trigger (same lead, same day) or a re-scheduled next-step adds no row. (2) The drain's claim CAS (`pending → sending`, guarded, with a stale `sending` reclaim after `STALE_MS=10m > maxDuration`) serializes concurrent drains so one drain sends a given touch. (3) The touch email itself carries the outbox dedup_key `${idempotency_key}${keySuffix}` (`-touch1/-touch2/-touch3` / `-recovery`), so even an overlapping re-drive collapses at the comms outbox. A converted lead (`lifecycle_stage != 'lead'`) cancels the rest of the sequence; a missing template throws → bounded retry (`MAX_TOUCH_ATTEMPTS=4`, then terminal `failed`); an inactive template skips the send but still advances. **Terminal state is COLUMNS-ONLY** (`status='failed'` on the row) — nothing to `jobs_dead_letter`, so the Inngest DLQ drainer can't re-emit a nurture touch.
- **DLQ replay is Inngest-free:** `OperationsService.reemitDeadLetterJob` now routes `autolenis/lead.form_abandoned` → `scheduleLeadNurture('form_abandonment')` and `autolenis/lead.exit_intent_captured` → `scheduleLeadNurture('exit_intent')` (mapping the snake_case Inngest payload), so replaying a historical dead-letter row re-drives the internal scheduler, never the deleted worker.
- **Workers DELETED:** `formAbandonmentFn` + `exitIntentFn` + their `buildLpRecoveryUrl` / `buildUnsubUrl` / `renderRecoveryTemplate` helpers removed from `lib/inngest/functions.ts`; **`inngestFunctions` is now `[]`.** `app/api/inngest/route.ts` serves only the dormant `intakeFunctions`. `OperationsService`'s Inngest health check now reports `healthy / "Retired — all workloads migrated"` for an empty registry (an empty registry is the intended terminal state, not a degradation).
- **Tests:** `lib/services/crm/__tests__/lead-nurture.test.ts` (14: form/exit initial-delay scheduling, idempotent conflict → `scheduled:false`, DB-error throw; drain NO_DUE, send-touch-1 → done → schedule touch-2 at +23h with the `-touch1` outbox key, converted-lead cancel, suppressed-skip-but-advance, inactive-template-skip-but-advance, final-touch markInactive + no-next, missing-template retry vs MAX-attempts `failed`, lost-claim skip, query-error throw) + `app/api/cron/__tests__/lead-nurture-drain-route.test.ts` (auth guard, delegation, 500-on-throw). Both under the existing `test:crm-services` / `test:cron` suites (no new suite needed).
- **Status:** **MIGRATED, workers deleted.** With this batch **every Inngest workload is retired** — no repo code path schedules or handles an Inngest function (only the dormant `intakeProcessFn` compatibility sink remains served). Live verification: create an abandoned LP form + an exit-intent capture; confirm `cron_job_logs` for `lead-nurture-drain` sends the touches on schedule, a converting lead stops mid-sequence, and no `autolenis/lead.*` events remain queued in Inngest Cloud.

### 12–13. Content generate/regenerate — `contentGenerateFn` / `contentRegenerateFn` (`autolenis/content.{generate,regenerate}`)  ⟶  **MIGRATED + worker DELETED (Batch 4)**
- **Not a duplicate.** Verified the existing `content-publisher` cron *publishes* already-generated/approved articles (`publishDueScheduled`) and `social-generate` produces social posts — neither generates buying-guide articles. So this is a real workload to migrate, not dead/duplicate code.
- **New home:** `lib/services/content/content-generation-processor.service.ts` (`processContentItem` + `drainContentGenerationQueue`) driven by Vercel Cron route `app/api/cron/content-generation-drain/route.ts` (cron auth + `withCronRun`, `*/5 * * * *`, `maxDuration=300`). Registered in `vercel.json` + the CRON_STALENESS registry.
- **Queue = the existing table.** `ContentGenerationJobItem.status` IS the durable queue; no new queue and no second DLQ. Concurrency + crash-recovery via a Postgres compare-and-set on the row status: `QUEUED` (or a `PROCESSING` row older than `STALE_MS = 15m` > the 300s maxDuration) → `PROCESSING`, `attemptCount++`; a losing racer updates 0 rows and backs off. `attemptCount` bounds retries at `MAX_CONTENT_ATTEMPTS = 4` (parity with the retired `retries: 3`).
- **Emitter rewired:** `content-generation.service.ts` no longer calls `inngest.send`. `enqueueGeneration` just writes items `QUEUED` (job → `PROCESSING`); `resumeJob`/`retryFailedItems` re-queue by status (retry resets `attemptCount=0`) — the drain does the work. `contentIdentityKey` inlined so the service no longer imports `lib/inngest`.
- **Terminal/replay Inngest-free:** a MAX-attempts failure is terminal **COLUMNS-ONLY** (`item.status=FAILED`) — **nothing is written to `jobs_dead_letter`**, so `OperationsService.autoDrainDeadLetterJobs`/`retryDeadLetterJob` (which `inngest.send`) can NEVER re-emit a content job. Admin `retryFailedItems` is the replay path.
- **Business logic unchanged:** same `generateArticle` (Groq) → `contentArticle.upsert` (by unique slug, converges on retry/overlap) → `snapshot` → `validateArticle` (PUBLISHED→REVIEW_NEEDED downgrade gate preserved) → finalize item → `reconcileJob` → `recordWorkflowEvent`. Content has **no external email/SMS/dealer side effects**, so a redundant generation is at worst wasted Groq work, never a duplicate production comm.
- **Worker DELETED:** `lib/inngest/content-functions.ts` removed and dropped from `app/api/inngest/route.ts` (proved: only the serve route imported `contentFunctions`; no live emitter of the events remains; no test imported the file).
- **Tests:** `lib/services/content/__tests__/content-generation-processor.test.ts` (claim-race SKIP, happy path, PUBLISHED downgrade both ways, RETRY below MAX with no DLQ write, terminal FAILED columns-only at MAX, NO_KEYWORD, drain NO_QUEUED/aggregation) + `app/api/cron/__tests__/content-generation-drain-route.test.ts`. `test:content` now runs with `--experimental-test-module-mocks`.
- **Independent-review follow-up (applied):** (1) **throughput** — raised the drain to `*/2` + `CONTENT_DRAIN_BATCH=10`; overlapping invocations (maxDuration 300s > 120s interval) work on disjoint items via the STALE_MS guard, restoring the retired `concurrency:5` ballpark. A bulk `filter` regen (up to ~5000 slugs) drains over hours, not instantly — documented in-code so a long PROCESSING job isn't read as stuck. (2) **cancel-vs-finalize race** — finalize/terminal/retry writes are now guarded `updateMany(where status=PROCESSING)`, so an admin `cancelJob`/`pauseJob` issued mid-generation WINS (item keeps CANCELED/PAUSED; drain returns SKIPPED) instead of being overwritten to SUCCEEDED. (3) tests strengthened to assert the claim-CAS query shape (QUEUED|stale-PROCESSING, `attemptCount:{increment:1}`) + the cancel-wins path; stale "Inngest-backed" comments in the two admin content routes corrected.
- **Known parity note (accepted):** the retired worker held a slug+op `idempotency_keys` guard that blocked two DIFFERENT job-items for the same slug from generating at once; the drain's claim is per-item-id. Two overlapping same-slug items can both call Groq and race on `contentArticle.upsert` (one takes a self-healing RETRY on P2002). Acceptable because content has no external comms — worst case is redundant Groq work; the `idempotencyKey` column is now a vestigial audit field. Per-job slug de-dup (`[...new Set(slugs)]`) already minimizes it.
- **Status:** **MIGRATED, worker deleted.** No Inngest dependency remains for content. Live verification: confirm `cron_job_logs` for `content-generation-drain` shows real claims/successes and an admin generate job completes end-to-end on the drain.

### 14. Dealer award — `dealerAwardFn` / `autolenis/dealer.award`  ⟶  **MIGRATED + worker DELETED (Batch 7)**
- **Durable marker, not an event.** `select-offer` no longer emits `autolenis/dealer.award` via `after(() => inngest.send)`. The Deal (created by `commitOfferSelection` before this point) carries a new `dealerAwardDispatchedAt` marker (NULL on a fresh acceptance) — **that row IS the durable signal**, surviving request-context death exactly as the Inngest worker did.
- **New home:** `lib/services/deal/dealer-award-dispatch.service.ts::drainDealerAwardDispatch` driven by `app/api/cron/dealer-award-dispatch/route.ts` (cron auth + `withCronRun`, `* * * * *`, `maxDuration=300`). Scans deals `offerId != null AND dealerAwardDispatchedAt IS NULL AND createdAt >= now-7d`, derives `auctionId` from `offer.auctionId`, and dispatches via the **same idempotent** `emitDealerAwardOutcomes` the worker called.
- **Marker = terminal (columns-only); claimJob = lease.** The Deal marker is the durable terminal state — **nothing is written to `jobs_dead_letter`** (the Inngest DLQ drainer can't re-emit a dealer-award job). `claimJob('dealer-award:{dealId}')` is a short concurrency lease: **released on success** (the marker is then the source of truth), left `'failed'` (reclaimable) on failure — so a stamp-failure can never strand a deal, and `emitDealerAwardOutcomes` idempotency (per-recipient outbox dedup + in-app Notification dedup) means a re-drive never double-notifies.
- **Historical safety:** the migration `20261009000000_add_deal_dealer_award_dispatch` (additive `dealerAwardDispatchedAt` + **backfill of every existing offer-accepted deal = created_at**) plus the 7-day scan window mean the cron can NEVER mass-notify dealers about historical auctions. **PRODUCTION CUTOVER REQUIRES `prisma migrate deploy` — OWNER-GATED** (deploy the migration with/before this code; the scan references the new column).
- **Worker DELETED:** `dealerAwardFn` + `lib/inngest/dealer-award-functions.ts` removed and dropped from `app/api/inngest/route.ts`; `dealer-award-fn.test.ts` removed. `OperationsService.reemitDeadLetterJob` now routes `autolenis/dealer.award` → `emitDealerAwardOutcomes` (Inngest-free replay).
- **Tests:** `lib/services/deal/__tests__/dealer-award-dispatch.test.ts` (NO_PENDING, claim→dispatch→stamp→release, no-auction stamp-and-skip, lost-claim skip, dispatch-failure no-stamp + lease 'failed') + `app/api/cron/__tests__/dealer-award-dispatch-route.test.ts`. The existing `dealer-award.dispatch.test.ts` (planner + failure propagation) still passes unchanged.
- **Independent-review follow-up (applied):** bounded retry closes the "one persistently-failing dispatch re-drives every 60s for 7 days then silently abandons" gap. A new `Deal.dealerAwardAttempts` counter (additive, in the same migration) bounds retries at `MAX_DISPATCH_ATTEMPTS = 4`; at MAX the drain stamps the marker **terminal** (stops the retry loop) and leaves `dealerAwardAttempts >= MAX` as a **queryable recovery handle** (`dealerAwardDispatchedAt IS NOT NULL AND dealerAwardAttempts >= 4`) — no `jobs_dead_letter` row (avoids an Inngest DLQ re-emit loop), surfaced via a structured `logger.error`. The drain summary now reports `deadLettered`. Two stale worker-reference comments (`dealer-award.ts` header, `operations.service.ts` DLQ comment) corrected.
- **Status:** **MIGRATED, worker deleted.** No Inngest dependency remains for dealer award. Live verification: confirm `cron_job_logs` for `dealer-award-dispatch` shows dispatches on new acceptances and the marker is stamped once.

---

## Next executable workload (identified, NOT implemented here)

**DONE (Batch 3):** The three self-contained Inngest-cron functions
(`analyticsRefreshFn` #9, `inactivityScannerFn` #7, `savedSearchMatcherFn` #8) are
**MIGRATED** to Vercel Cron routes on the internal substrate and removed from
`inngestFunctions` (see entries 7–9). Live verification pending before deleting the
function definitions.

**DONE (Batch 4):** Content generate/regenerate (#12–13) — **MIGRATED**, worker
deleted (see entry 12–13). Proven not a duplicate; runs on the
`content-generation-drain` cron; terminal state columns-only (Inngest-free).

**DONE (Batch 5):** `workflowResumeFn` (#6) — **MIGRATED**, worker deleted (see
entry 6). Durable `resume_at` state + `workflow-resume-drain` cron; delay-path
Inngest-free.

**NEXT EXECUTABLE WORKLOAD:** the comms keystone (`emailSendFn` #2 / `smsSendFn`
#3) — internal comms-dispatch queue with a per-(recipient,template,dedup-key)
idempotency key; **zero duplicate production comms**. Everything below fans into it.

**THEN (in dependency order):** the comms keystone (`emailSendFn` #2 / `smsSendFn`
#3 — internal comms-dispatch queue with a per-(recipient,template,dedup-key)
idempotency key; **zero duplicate production comms**) → the workloads that fan into
comms (`campaignFanoutFn` #4, `scheduledCampaignCronFn` #5, `formAbandonmentFn` #10,
`exitIntentFn` #11) → `dealerAwardFn` (#14). Do NOT take `scheduledCampaignCronFn`
before the email/SMS workers are internalized.

**EXPECTED INTERNAL REPLACEMENT (crons):** New `app/api/cron/<name>/route.ts`
handlers with the standard cron auth (`Bearer CRON_SECRET` via
`authorizeCronRequest`), wrapped in `withCronRun(...)`, calling a `lib/services/**`
service; add the schedule to `vercel.json`; then drop the function from
`inngestFunctions`.

**LIVE VERIFICATION:** After each cutover, confirm `cron_job_logs` shows the new
cron running green with real work, and confirm the corresponding Inngest cron no
longer fires (Inngest Cloud dashboard) — `LIVE VERIFICATION REQUIRED` before
deleting the Inngest function definition.

---

## Cutover requirements for Batch 1 (buyer intake)

- **No schema change** — reuses existing `buyer_opportunities.intake_processed_at`,
  `idempotency_keys`, `cron_job_logs`. Nothing to `prisma migrate deploy` for this batch.
- Historical backfill of the 43 dormant opportunities is **OUT OF SCOPE** and
  **OFF by default** — a separate, owner-authorized remediation.
- Optional owner action at cutover: set `INTAKE_ELIGIBILITY_START_AT` (ISO) to the
  deploy timestamp as an explicit hard floor (belt-and-suspenders; the 48h window
  already excludes the 43). Optional tuning: `INTAKE_ELIGIBILITY_WINDOW_HOURS`,
  `INTAKE_BATCH_SIZE`.
- Live verification: watch `cron_job_logs` for `intake-reconcile` (attempted /
  succeeded / failed / `allAttemptedFailed`).
