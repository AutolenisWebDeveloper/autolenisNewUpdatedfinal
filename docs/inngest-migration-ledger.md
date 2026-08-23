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

Registered function arrays (as of Batch 4): `inngestFunctions` (`lib/inngest/functions.ts`),
`intakeFunctions` (`lib/inngest/intake-functions.ts`), `dealerAwardFunctions`
(`lib/inngest/dealer-award-functions.ts`). **`contentFunctions` /
`lib/inngest/content-functions.ts` were removed in Batch 4** (content generation
migrated to the `content-generation-drain` cron). `inngestFunctions` no longer
contains `analyticsRefreshFn` / `inactivityScannerFn` / `savedSearchMatcherFn`
(Batch 3).

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

### 2. Transactional/nurture email — `emailSendFn` / `autolenis/email.send`  ⟶  `KEEP TEMPORARILY`

- Emitters: `lib/services/email/{nurture-sequence,lead-magnet-sequence,transactional-dispatch}.ts`, `campaignFanoutFn`, `formAbandonmentFn`, `exitIntentFn`, `workflow.engine.ts`, admin CRM send-email/bulk-send.
- Side effects: Resend send; consult suppression/consent. Retry + DLQ on final failure.
- Replacement: DB-backed send-queue table drained by a Vercel Cron, reusing the existing suppression/consent + `EmailSendLog` services. **Requires an internal comms-dispatch queue** (does not exist yet).
- Difficulty: Medium-High. Cutover risk: **communication duplication** — idempotency per (recipient, template, dedup-key) is mandatory.
- Dependency order: migrate BEFORE `campaignFanoutFn` and `scheduledCampaignCronFn` (they fan out into this).

### 3. SMS — `smsSendFn` / `autolenis/sms.send`  ⟶  `KEEP TEMPORARILY`
- Same shape as email; TCPA consent + quiet-hours + suppression already in services. Same internal-queue prerequisite and duplication risk.

### 4. Campaign fan-out — `campaignFanoutFn` / `autolenis/campaign.execute`  ⟶  `KEEP TEMPORARILY`
- Emitters: `app/api/admin/crm/campaigns/route.ts`, `campaigns/bulk-send`, `scheduledCampaignCronFn`.
- Fans a campaign into per-recipient email/sms sends. Depends on #2/#3.

### 5. Scheduled campaign cron — `scheduledCampaignCronFn` / **Inngest cron `*/5`**  ⟶  `MIGRATE TO EXISTING INTERNAL PATH`
- Pure scheduler: scans due campaigns, emits `campaign.execute`. Trivially a Vercel Cron route, BUT depends on #4/#2/#3 for the downstream send. Migrate after them.

### 6. Workflow resume — `workflowResumeFn` / `autolenis/workflow.resume`  ⟶  `MIGRATE TO DB-SCHEDULED STATE`
- Emitter: `lib/services/workflow.engine.ts` (delayed step resume). Uses Inngest's **delay** primitive.
- Replacement: a `workflow_step` table with `run_at` + a Vercel Cron drain (DB-scheduled state). Difficulty: Medium (delay semantics). Migrate as its own batch.

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

### 10. Form abandonment — `formAbandonmentFn` / `autolenis/lead.form_abandoned`  ⟶  `KEEP TEMPORARILY`
- Emitter: `app/api/public/crm/partial-lead/route.ts`. Emits `email.send` (nurture). Depends on #2.

### 11. Exit intent — `exitIntentFn` / `autolenis/lead.exit_intent_captured`  ⟶  `KEEP TEMPORARILY`
- Emitter: `app/api/public/crm/exit-intent/route.ts`. Emits `email.send`. Depends on #2.

### 12–13. Content generate/regenerate — `contentGenerateFn` / `contentRegenerateFn` (`autolenis/content.{generate,regenerate}`)  ⟶  **MIGRATED + worker DELETED (Batch 4)**
- **Not a duplicate.** Verified the existing `content-publisher` cron *publishes* already-generated/approved articles (`publishDueScheduled`) and `social-generate` produces social posts — neither generates buying-guide articles. So this is a real workload to migrate, not dead/duplicate code.
- **New home:** `lib/services/content/content-generation-processor.service.ts` (`processContentItem` + `drainContentGenerationQueue`) driven by Vercel Cron route `app/api/cron/content-generation-drain/route.ts` (cron auth + `withCronRun`, `*/5 * * * *`, `maxDuration=300`). Registered in `vercel.json` + the CRON_STALENESS registry.
- **Queue = the existing table.** `ContentGenerationJobItem.status` IS the durable queue; no new queue and no second DLQ. Concurrency + crash-recovery via a Postgres compare-and-set on the row status: `QUEUED` (or a `PROCESSING` row older than `STALE_MS = 15m` > the 300s maxDuration) → `PROCESSING`, `attemptCount++`; a losing racer updates 0 rows and backs off. `attemptCount` bounds retries at `MAX_CONTENT_ATTEMPTS = 4` (parity with the retired `retries: 3`).
- **Emitter rewired:** `content-generation.service.ts` no longer calls `inngest.send`. `enqueueGeneration` just writes items `QUEUED` (job → `PROCESSING`); `resumeJob`/`retryFailedItems` re-queue by status (retry resets `attemptCount=0`) — the drain does the work. `contentIdentityKey` inlined so the service no longer imports `lib/inngest`.
- **Terminal/replay Inngest-free:** a MAX-attempts failure is terminal **COLUMNS-ONLY** (`item.status=FAILED`) — **nothing is written to `jobs_dead_letter`**, so `OperationsService.autoDrainDeadLetterJobs`/`retryDeadLetterJob` (which `inngest.send`) can NEVER re-emit a content job. Admin `retryFailedItems` is the replay path.
- **Business logic unchanged:** same `generateArticle` (Groq) → `contentArticle.upsert` (by unique slug, converges on retry/overlap) → `snapshot` → `validateArticle` (PUBLISHED→REVIEW_NEEDED downgrade gate preserved) → finalize item → `reconcileJob` → `recordWorkflowEvent`. Content has **no external email/SMS/dealer side effects**, so a redundant generation is at worst wasted Groq work, never a duplicate production comm.
- **Worker DELETED:** `lib/inngest/content-functions.ts` removed and dropped from `app/api/inngest/route.ts` (proved: only the serve route imported `contentFunctions`; no live emitter of the events remains; no test imported the file).
- **Tests:** `lib/services/content/__tests__/content-generation-processor.test.ts` (claim-race SKIP, happy path, PUBLISHED downgrade both ways, RETRY below MAX with no DLQ write, terminal FAILED columns-only at MAX, NO_KEYWORD, drain NO_QUEUED/aggregation) + `app/api/cron/__tests__/content-generation-drain-route.test.ts`. `test:content` now runs with `--experimental-test-module-mocks`.
- **Status:** **MIGRATED, worker deleted.** No Inngest dependency remains for content. Live verification: confirm `cron_job_logs` for `content-generation-drain` shows real claims/successes and an admin generate job completes end-to-end on the drain.

### 14. Dealer award — `dealerAwardFn` / `autolenis/dealer.award`  ⟶  `KEEP TEMPORARILY`
- Emitter: `app/api/buyer/auctions/[auctionId]/select-offer/route.ts`. Post-acceptance dealer award dispatch. **Financial/deal-adjacent** — migrate carefully, its own batch, after comms internalized.

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

**NEXT EXECUTABLE WORKLOAD:** `workflowResumeFn` (#6 — durable Postgres
`run_at` state), then the comms keystone.

**THEN (in dependency order):** `workflowResumeFn` (#6 — durable Postgres
`run_at` state, its own batch) → the comms keystone (`emailSendFn` #2 / `smsSendFn`
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
