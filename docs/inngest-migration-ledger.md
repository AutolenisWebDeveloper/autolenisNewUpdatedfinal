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

Registered function arrays: `inngestFunctions` (`lib/inngest/functions.ts`),
`contentFunctions` (`lib/inngest/content-functions.ts`), `intakeFunctions`
(`lib/inngest/intake-functions.ts`), `dealerAwardFunctions`
(`lib/inngest/dealer-award-functions.ts`).

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
| Migration difficulty | Medium (idempotency/concurrency/historical-safety analysis). |
| Cutover risk | Low code risk; **historical-safety** is the key control (48h eligibility window excludes the 43 dormant records; `INTAKE_ELIGIBILITY_START_AT` optional hard floor). |
| Test/parity | `lib/jobs/__tests__/idempotency-claim.test.ts`, `lib/services/acquisition/__tests__/intake-processor.test.ts`, `app/api/cron/__tests__/intake-reconcile-route.test.ts`, `lib/inngest/__tests__/intake-process.test.ts`, updated `promote-opportunity` / `unified-intake-emit` / `intake-turn` tests. |
| Live verification | Confirm `cron_job_logs` for `intake-reconcile` shows attempted/succeeded > 0 after deploy; confirm no `autolenis/intake.process` events remain queued in Inngest Cloud before removing the worker. |
| Dependency order | None (leaf workload). |
| **Status** | **MIGRATED.** No repo code requires Inngest for intake. Worker retained as dormant compatibility sink → `READY FOR REMOVAL` after live verification confirms an empty Inngest queue. |

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

### 7. Inactivity scanner — `inactivityScannerFn` / **Inngest cron `0 * * * *`**  ⟶  `MIGRATE TO EXISTING INTERNAL PATH`
- Self-contained (no `inngest.send` fan-out in body). **Prime next candidate** (see below).

### 8. Saved-search matcher — `savedSearchMatcherFn` / **Inngest cron `0 */6 * * *`**  ⟶  `MIGRATE TO EXISTING INTERNAL PATH`
- Self-contained cron. Verify any buyer-notification path during migration.

### 9. Analytics refresh — `analyticsRefreshFn` / **Inngest cron `0 2 * * *`**  ⟶  `MIGRATE TO EXISTING INTERNAL PATH`
- Self-contained internal refresh, no external side effects. **Safest single next migration.**

### 10. Form abandonment — `formAbandonmentFn` / `autolenis/lead.form_abandoned`  ⟶  `KEEP TEMPORARILY`
- Emitter: `app/api/public/crm/partial-lead/route.ts`. Emits `email.send` (nurture). Depends on #2.

### 11. Exit intent — `exitIntentFn` / `autolenis/lead.exit_intent_captured`  ⟶  `KEEP TEMPORARILY`
- Emitter: `app/api/public/crm/exit-intent/route.ts`. Emits `email.send`. Depends on #2.

### 12–13. Content generate/regenerate — `contentGenerateFn` / `contentRegenerateFn` (`autolenis/content.{generate,regenerate}`)  ⟶  `KEEP TEMPORARILY`
- Emitter: `lib/services/content/content-generation.service.ts`. Already use the shared `idempotency_keys` guard. Medium migration (LLM generation, long-running) — good fit for a DB-queue + cron drain later.

### 14. Dealer award — `dealerAwardFn` / `autolenis/dealer.award`  ⟶  `KEEP TEMPORARILY`
- Emitter: `app/api/buyer/auctions/[auctionId]/select-offer/route.ts`. Post-acceptance dealer award dispatch. **Financial/deal-adjacent** — migrate carefully, its own batch, after comms internalized.

---

## Next executable workload (identified, NOT implemented here)

**NEXT EXECUTABLE WORKLOAD:** Migrate the self-contained **Inngest-cron** functions
to Vercel Cron routes — begin with **`analyticsRefreshFn`** (#9), then
`inactivityScannerFn` (#7) and `savedSearchMatcherFn` (#8).

**WHY:** They are pure schedulers/maintenance jobs with **no `inngest.send`
fan-out** in their bodies (evidence: no send call sites fall within their function
line ranges in `lib/inngest/functions.ts`), so they carry no delay/retry/dedup
semantics to replicate and no downstream event dependency. They map 1:1 onto the
exact Vercel-Cron substrate this batch just validated — the lowest-risk, zero-new-
primitive migration, and each one removes an Inngest trigger from the surface.
`analyticsRefreshFn` is safest first: a daily internal refresh with no external
(email/SMS/dealer) side effects.

**DEPENDENCIES:** None for #9. #7/#8: verify neither emits buyer/dealer
communications via a helper before cutover. Do NOT take `scheduledCampaignCronFn`
(#5) yet — it fans out into the email/SMS event workers, which must be internalized
first.

**EXPECTED INTERNAL REPLACEMENT:** New `app/api/cron/<name>/route.ts` handlers with
the standard cron auth (`x-vercel-cron` OR `Bearer CRON_SECRET`), wrapped in
`withCronRun(...)`, calling the same underlying service the Inngest function calls
today; add the schedule to `vercel.json`; then drop the function from
`inngestFunctions`.

**LIVE VERIFICATION:** After cutover, confirm `cron_job_logs` shows the new cron
running green with real work, and confirm the corresponding Inngest cron no longer
fires (Inngest Cloud dashboard) — `LIVE VERIFICATION REQUIRED` before removing the
Inngest function.

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
