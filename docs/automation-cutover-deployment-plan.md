# Automation Consolidation — Cumulative Pre-Merge Deployment & Cutover Plan

Deployment-activation and integration review of the **entire**
`claude/automation-consolidation-o94n65` branch against `main`. This is NOT a
re-implementation review (the per-workload batches were each dual-reviewed); it is
the analysis needed to merge and deploy the cumulative diff **safely**, plus the
one ordered, owner-gated production sequence.

**Nothing here is executed.** No merge, deploy, production migration, cutover,
vendor disconnect, or send is performed by this run.

---

## 1. New Vercel crons added by this branch (11)

| Cron (path) | Schedule | Replaces (Inngest) | Authority posture on deploy |
| --- | --- | --- | --- |
| `analytics-refresh` | `0 2 * * *` | `analyticsRefreshFn` cron | ACTIVE (existing tables) |
| `inactivity-scan` | `0 * * * *` | `inactivityScannerFn` cron | ACTIVE (existing tables) |
| `saved-search-match` | `0 */6 * * *` | `savedSearchMatcherFn` cron | ACTIVE (existing tables) |
| `content-generation-drain` | `*/2 * * * *` | `contentGenerate/RegenerateFn` | ACTIVE (existing `ContentGenerationJobItem`) |
| `comms-outbox-drain` | `* * * * *` | `emailSendFn`/`smsSendFn` | ACTIVE — needs `comms_outbox` |
| `campaign-dispatch` | `*/2 * * * *` | `campaignFanoutFn`/`scheduledCampaignCronFn` | ACTIVE (existing `campaigns` + `idempotency_keys`) |
| `dealer-award-dispatch` | `* * * * *` | `dealerAwardFn` | ACTIVE — needs `deals.dealer_award_*` |
| `workflow-resume-drain` | `* * * * *` | `workflowResumeFn` | GATED OFF (engine disabled → short-circuits) |
| `lead-nurture-drain` | `* * * * *` | `formAbandonmentFn`/`exitIntentFn` | ACTIVE — needs `lead_nurture_schedule` |
| `refinance-outreach-drain` | `*/15 * * * *` | QStash `refinance-outreach` (parity) | DORMANT (no producer; NO_TABLE-safe) |
| `outreach-touch-drain` | `*/15 * * * *` | QStash affiliate/referral (parity) | DORMANT (no producer; NO_TABLE-safe) |

All 11 are in `vercel.json` and pinned in the `CRON_STALENESS` monitoring registry
(the `test:monitoring` parity test enforces both directions).

## 2. Database dependencies per new cron

- **Existing tables only** (no migration needed): `analytics-refresh`,
  `inactivity-scan`, `saved-search-match`, `content-generation-drain`,
  `campaign-dispatch` (uses `campaigns` + the shared `idempotency_keys`).
- **New table required:** `comms-outbox-drain` → `comms_outbox`;
  `lead-nurture-drain` → `lead_nurture_schedule`; `refinance-outreach-drain` →
  `refinance_outreach_schedule`; `outreach-touch-drain` → `outreach_touch_schedule`.
- **New columns required:** `dealer-award-dispatch` → `deals.dealer_award_dispatched_at`
  + `deals.dealer_award_attempts`; `workflow-resume-drain` →
  `workflow_enrollments.resume_at` + `resume_node_id`.

## 3. Migrations that MUST exist before deployment (6, all branch-only, additive)

> The intake migration `20261008000000_add_buyer_opportunity_intake_retry_terminal`
> is **already on `main`** (Batch 1/2 merged earlier) — not part of this deploy.

| Migration | Type | Deploy coupling |
| --- | --- | --- |
| `20261009000000_add_deal_dealer_award_dispatch` | Prisma (`prisma migrate deploy`) | **BEFORE/WITH deploy** — `select-offer` stamps + `dealer-award-dispatch` read these columns; the migration also backfills every existing offer-accepted deal so the cron cannot mass-notify historical auctions. |
| `manual_supabase_sql/comms_outbox.sql` | Raw Supabase | **BEFORE/WITH deploy** — every email/SMS emitter enqueues here on deploy; `enqueueEmail`/`enqueueSms` throw if absent. |
| `manual_supabase_sql/lead_nurture_schedule.sql` | Raw Supabase | **BEFORE/WITH deploy** — `partial-lead`/`exit-intent` routes call `scheduleLeadNurture` on deploy. |
| `manual_supabase_sql/workflow_scheduled_resume.sql` | Raw Supabase | **Only if the in-app engine is enabled** — the drain short-circuits `ENGINE_DISABLED` and the delay node is inert while `CRM_INAPP_ENGINE_ENABLED` is off (the default), so this is safe to apply later. Apply before enabling the engine. |
| `manual_supabase_sql/refinance_outreach_schedule.sql` | Raw Supabase | **Deferred to the refinance QStash cutover** — dormant until then. |
| `manual_supabase_sql/outreach_touch_schedule.sql` | Raw Supabase | **Deferred to the affiliate/referral QStash cutover** — dormant until then. |

Every branch migration is additive + defensive (`IF NOT EXISTS`, nullable, idempotent
backfill) and is labelled **PRODUCTION CUTOVER REQUIRES … — OWNER-GATED**. None was
applied to production by this run.

## 4. Missing-table behaviour (verified per route)

- **NO_TABLE-safe (deploy-before-migration is harmless):** `refinance-outreach-drain`
  and `outreach-touch-drain` catch the undefined-table error (`42P01`/`PGRST205`/
  "does not exist") and return `NO_TABLE` (a green no-op). Correct, because they are
  DORMANT — a false red alert would be wrong.
- **Gated-off-safe:** `workflow-resume-drain` returns `ENGINE_DISABLED` **before any
  query** when `CRM_INAPP_ENGINE_ENABLED` is off (the default), so its additive
  columns are not required at deploy.
- **Intentionally NOT missing-table-safe (they alert red if their migration is
  absent):** `comms-outbox-drain`, `lead-nurture-drain`, `dealer-award-dispatch`.
  This is correct: these are ACTIVE cutovers whose producers are live on deploy, so a
  missing table means the workload is genuinely broken and SHOULD surface as a failed
  cron — not be silently masked. The mitigation is ordering (apply their migrations
  with the deploy, step-by-step below), not swallowing the error.

## 5. Does merging/deploying activate anything?

**Yes — intentionally.** Deploying the branch activates the internal cron substrate
that REPLACES Inngest: comms outbox, campaign dispatch, dealer-award dispatch, lead
nurture, content generation, analytics/inactivity/saved-search, and (only if enabled)
workflow resume all begin running on their crons. This is the whole point of the
Inngest retirement, and it is safe **only because the Inngest workers were deleted in
the same branch** (`inngestFunctions = []`), so exactly one authority runs each
workload after deploy. What deploying does NOT activate: the QStash parity
(`refinance-outreach-drain`, `outreach-touch-drain` stay dormant — no producer) and no
new external provider call beyond what Inngest already did. Buffer removal deactivates
a capability (YouTube-via-Buffer) rather than activating one.

## 6. Comms single-authority (verified)

For every migrated communication workload the OLD Inngest authority is **removed**, not
merely superseded:

- `inngestFunctions = []` (`lib/inngest/functions.ts`) — every worker deleted.
- Repo grep for `inngest.send` in non-test code returns exactly ONE call:
  `operations.service.ts` `reemitDeadLetterJob`'s fall-through, which fires only for a
  genuinely-unknown dead-letter event — every migrated event
  (`email.send`/`sms.send` → outbox, `dealer.award` → `emitDealerAwardOutcomes`,
  `lead.form_abandoned`/`lead.exit_intent_captured` → `scheduleLeadNurture`) is routed
  internally before that line.
- `app/api/inngest/route.ts` serves only the dormant `intakeProcessFn` sink (no live
  emitter).

## 7. No duplicate senders (proof)

There is **no deployment state in which two authorities send the same logical
communication**:

- Email/SMS: the Inngest `emailSendFn`/`smsSendFn` are deleted; only `comms-outbox-drain`
  sends. Enqueue-once (`UNIQUE(dedup_key)`) + claim-CAS + Resend idempotency key mean
  even a retry/duplicate-enqueue collapses to one send.
- Campaign / dealer-award / lead-nurture: each old worker deleted; each new path is
  enqueue-once + claim-CAS + columns-only terminal.
- QStash parity (refinance/affiliate/referral): DORMANT — the internal enqueue has ZERO
  production callers and the QStash producer/consumer are UNCHANGED, so QStash remains
  the sole authority until an owner-gated atomic cutover swaps a single producer line.
- The one residual crash window (send succeeds, bookkeeping fails → reclaim) is
  parity-or-better vs the pre-migration Inngest/QStash behaviour and is dedup-guarded.

## 8. Inngest removal readiness

No legitimate production workload depends on Inngest: `inngestFunctions = []`; the only
served function is the dormant `intakeProcessFn` (no live emitter); the DLQ replay path
is Inngest-free for every migrated event. External Inngest teardown is owner-gated in
`docs/inngest-final-removal-checklist.md` (execute after live verification + draining any
queued `autolenis/*` events).

## 9. QStash cutover readiness

Every one of the 16 QStash jobs has exactly one evidence-backed disposition
(`docs/automation-vendor-retirement-readiness.md`): 4 purely-non-deal jobs have internal
parity BUILT + DORMANT (`refinance-outreach` + the consolidated affiliate/referral
scheduler); the 12 deal/money-path or deal-completion-coupled jobs are mapped and
DEFERRED to the business-lifecycle program. No `DEAD/DUPLICATE` job exists. No QStash
cutover is executed.

## 10. Buffer removal readiness

No retained repository functionality silently depends on Buffer: the provider + tests
are deleted, the factory fails explicitly when a direct token is absent, YouTube
publishing fails explicitly (analytics retained), the admin Buffer surface is removed,
and `lib/social/__tests__/publishing-factory.test.ts` regression-proves it. External
Buffer teardown (env/token/account/subscription) is owner-gated in the vendor readiness
doc.

---

## The one safe, owner-gated production sequence

Each step is an OWNER action. Do not proceed to the next until the current one is
verified.

1. **Apply the deploy-coupled migrations** (to production Supabase), in any order among
   themselves (all additive/idempotent):
   - `prisma migrate deploy` → `20261009000000_add_deal_dealer_award_dispatch`
   - raw Supabase → `comms_outbox.sql`, `lead_nurture_schedule.sql`
   (Defer `workflow_scheduled_resume.sql` unless enabling the in-app engine; defer
   `refinance_outreach_schedule.sql` + `outreach_touch_schedule.sql` to their QStash
   cutovers.)
2. **Merge + deploy the branch.** On deploy the internal crons take over from the
   (deleted) Inngest workers. Watch `cron_job_logs` for `comms-outbox-drain`,
   `dealer-award-dispatch`, `lead-nurture-drain`, `campaign-dispatch`,
   `content-generation-drain`, `analytics-refresh`, `inactivity-scan`,
   `saved-search-match` running green with real work. The two QStash-parity crons should
   report `NO_TABLE`/`NO_DUE` (dormant) — that is expected.
3. **Live verification (Inngest):** confirm in Inngest Cloud that no `autolenis/*` event
   is queued and no function has fired since deploy.
4. **Legacy authority removal (Inngest):** execute
   `docs/inngest-final-removal-checklist.md` (steps 3–8 as a reviewed PR: neutralize the
   DLQ fall-through, delete the client/serve route/dormant sink, remove the `inngest`
   package, repoint the idempotency shim), then owner step 9 (delete env + Cloud app +
   subscription).
5. **QStash non-deal atomic cutovers (optional, per touch, owner-gated):** apply the
   dormant schedule migration, swap the single `dispatch()` producer line to the internal
   `enqueue*`, delete the retired QStash route, and stop the DLQ re-publish for it — one
   authority before and after. (Deal/money-path QStash jobs stay with the
   business-lifecycle program.)
6. **Buffer teardown (owner-gated):** with the Buffer-free code deployed, remove the
   `BUFFER_*`/`ENABLE_BUFFER_PUBLISHING` env vars, revoke the Buffer token, disconnect the
   account, cancel the subscription.

**Owner authorization is required for every step (1–6).** This run performed none of
them; it prepared the branch, the migrations, the tests, and this plan.
