# Inngest FINAL-REMOVAL Checklist — ready-to-execute, **DO NOT EXECUTE**

**Status:** Every Inngest **workload** is retired (Batches 1–9; see
`docs/inngest-migration-ledger.md`). `inngestFunctions` is `[]`; the serve endpoint
carries only the dormant `intakeProcessFn` compatibility sink, which has **no live
emitter**. No repository code path schedules or handles an Inngest function for
real work.

This document is the **owner-gated teardown plan** for the residual Inngest
*infrastructure* (client, serve route, package, env, the dormant sink). It is
**not executed by the automation run** — the mandate stops before vendor
disconnect, package removal, prod env change, and merge/deploy. Execute it only
after **live verification** (below) confirms the Inngest Cloud app is idle.

> **Gate for the whole checklist:** do steps 1–2 (live verification) FIRST. Only
> after they pass may steps 3–8 (code/package/env removal) proceed, and only step 9
> (deleting the Inngest Cloud app + revoking keys) actually severs the vendor. Each
> is reversible up to step 9.

---

## 0. Pre-removal surface inventory (what still references Inngest)

Confirm this is still the complete set at execution time with:
`grep -rn "inngest" frontend/lib frontend/app frontend/package.json frontend/vercel.json`
(case-insensitive), minus comments. As of Batch 9:

| # | Artifact | Kind | Notes |
| --- | --- | --- | --- |
| A | `frontend/lib/inngest/client.ts` | code | `new Inngest({ id: 'autolenis' })`. Delete last (everything imports it). |
| B | `frontend/app/api/inngest/route.ts` | code (public route) | `serve()` endpoint. Serves `[...inngestFunctions(=[]), ...intakeFunctions]`. Uses `INNGEST_SIGNING_KEY`. |
| C | `frontend/lib/inngest/functions.ts` | code | Now `export const inngestFunctions = []` (comment-only body). |
| D | `frontend/lib/inngest/intake-functions.ts` | code | Dormant `intakeProcessFn` on `autolenis/intake.process`. **No live emitter** (entry #1). |
| E | `frontend/lib/services/operations.service.ts` | code | Imports `inngest` + `inngestFunctions`. `reemitDeadLetterJob` fall-through `inngest.send` (line ~60) + `inngestCheck` health probe. |
| F | `frontend/lib/inngest/idempotency.ts` | code (shim) | **Transport-agnostic** re-export of `@/lib/jobs/idempotency` + `isFinalAttempt`/`contentIdentityKey`. Imports **nothing** from Inngest — safe to keep or fold. Importers: `acquisition-comms.ts`, `deposit-activation.service.ts`. |
| G | `frontend/package.json` | dep | `"inngest": "^3.27.0"`. |
| H | Vercel env | secret | `INNGEST_SIGNING_KEY`, `INNGEST_EVENT_KEY`. |
| I | `frontend/lib/inngest/__tests__/*` | test | `idempotency.test.ts`, `intake-process.test.ts` (+ any others). Run under `test:intake`. |
| J | Inngest Cloud | vendor | The hosted `autolenis` app, its signing/event keys, and any Cloud-defined crons. |

**Not Inngest surface (do NOT touch):** `frontend/lib/jobs/idempotency.ts`,
`idempotency_keys` + `jobs_dead_letter` tables (shared internal infra, used by
every cron), and the `@/lib/inngest/idempotency` **re-export** consumers once
repointed (F).

---

## 1. LIVE VERIFICATION — the internal substrate carries every workload (do first)

For each migrated workload, confirm in `cron_job_logs` (Supabase) that the
internal cron runs green with real work over ≥1 full period:

- `analytics-refresh`, `inactivity-scan`, `saved-search-match` (Batch 3)
- `content-generation-drain` (Batch 4)
- `workflow-resume-drain` (Batch 5 — only if the in-app engine is enabled)
- `comms-outbox-drain` (Batch 6b)
- `dealer-award-dispatch` (Batch 7)
- `campaign-dispatch` (Batch 8)
- `lead-nurture-drain` (Batch 9)

Also confirm the OWNER-GATED migrations are applied to production Supabase (the
crons that reference new columns/tables will otherwise fail closed):
`comms_outbox.sql`, `workflow_scheduled_resume.sql`, `lead_nurture_schedule.sql`
(raw Supabase), and `intake_*` + `20261009000000_add_deal_dealer_award_dispatch`
(`prisma migrate deploy`).

## 2. LIVE VERIFICATION — Inngest Cloud is idle

In the Inngest Cloud dashboard for the `autolenis` app:
- No function has run in the last ≥7 days (cover the weekly crons).
- No events are queued/pending for any `autolenis/*` name — in particular
  `autolenis/email.send`, `autolenis/sms.send`, `autolenis/campaign.execute`,
  `autolenis/workflow.resume`, `autolenis/dealer.award`,
  `autolenis/content.{generate,regenerate}`, `autolenis/lead.form_abandoned`,
  `autolenis/lead.exit_intent_captured`, `autolenis/intake.process`.
- **If any `autolenis/*` event is still queued, STOP** and drain/let it complete
  before proceeding — do not delete a worker with in-flight events.

Only when 1 **and** 2 are clean do the code steps below become safe.

---

## 3. Neutralize the DLQ fall-through (remove the last live `inngest.send`)

In `frontend/lib/services/operations.service.ts::reemitDeadLetterJob`, the final
`await inngest.send({ name: eventName, data: payload })` is the only remaining
runtime `inngest.send`. Every **known** event already routes internally
(email/sms → outbox, dealer.award → `emitDealerAwardOutcomes`, lead.* →
`scheduleLeadNurture`). Replace the fall-through so an **unknown** dead-letter
event is logged + left in place (or moved to a terminal audit state) instead of
re-emitted to Inngest:

```ts
// was: await inngest.send({ name: eventName, data: payload });
logger.error('[dlq] no internal owner for dead-letter event — not re-emitting', { eventName });
throw new Error(`dead_letter_no_internal_owner: ${eventName}`);
```

(The caller already re-queues the row on throw, so an unrecognized event is
preserved for inspection rather than lost.) Then drop the `inngest` import from
this file. Keep `inngestFunctions` import only if `inngestCheck` still reads it
(step 5).

## 4. Delete the dormant intake sink (D) and empty functions module (C)

- Delete `frontend/lib/inngest/intake-functions.ts` and remove
  `...intakeFunctions` from `frontend/app/api/inngest/route.ts`.
- Delete `frontend/lib/inngest/functions.ts` and its `inngestFunctions` import in
  `route.ts` + `operations.service.ts`.
- Delete `frontend/lib/inngest/__tests__/intake-process.test.ts` (drives the sink).
- `intakeProcessFn` had `retries: 3` — the internal `intake-reconcile` cron already
  owns intake with bounded attempts (entry #1), so removing the sink loses nothing.

## 5. Remove the serve route (B) and the Inngest health probe (E)

- Delete `frontend/app/api/inngest/route.ts` entirely (once C+D are gone it serves
  an empty function list).
- In `operations.service.ts`, delete `inngestCheck()` and its entry in the
  dependency-status array (or replace the whole Inngest row with a static
  "retired" note). Remove the now-unused `inngestFunctions` import.

## 6. Repoint the idempotency shim consumers (F), then optionally fold the shim

- Change the imports in `frontend/lib/services/notifications/acquisition-comms.ts`
  and `frontend/lib/services/auction/deposit-activation.service.ts` from
  `@/lib/inngest/idempotency` to `@/lib/jobs/idempotency`.
- `isFinalAttempt` / `contentIdentityKey` in the shim are Inngest-attempt-shaped
  and content-key helpers; `contentIdentityKey` may still be referenced by content
  code — grep before deleting. Move any still-used helper into
  `@/lib/jobs/idempotency` (or a neutral `lib/jobs/keys.ts`), then delete
  `frontend/lib/inngest/idempotency.ts`. **The shim imports nothing from Inngest,
  so this step is cosmetic** — it can be deferred without blocking vendor removal.

## 7. Delete the client (A) and the `lib/inngest/` directory

- Delete `frontend/lib/inngest/client.ts`.
- After A–F, `frontend/lib/inngest/` should contain only whatever tests remain;
  delete the directory once `lib/inngest/__tests__/idempotency.test.ts` is either
  moved (it tests the neutral primitives — relocate to `lib/jobs/__tests__/`) or
  removed. Update `test:intake` in `package.json` to drop the
  `lib/inngest/__tests__/*.test.ts` glob (leave the `lib/services/acquisition`
  glob) — or rename the suite. Re-run `pnpm test:coverage-check`.

## 8. Remove the package (G) and CI/config references

- `cd frontend && pnpm remove inngest`.
- Grep the repo for `inngest` once more (case-insensitive) — expect only historical
  doc/ledger references and the `INNGEST_*` env names in this checklist. Remove any
  stray `.env.example` / README lines.

## 9. Vendor + secrets teardown (LAST — the only irreversible step) — OWNER-ONLY

- In Vercel, delete the `INNGEST_SIGNING_KEY` and `INNGEST_EVENT_KEY` env vars from
  all environments (Production/Preview/Development).
- In Inngest Cloud, archive/delete the `autolenis` app and revoke its signing +
  event keys.
- Cancel the Inngest subscription/plan if one exists.

> Steps 3–8 ship as an ordinary reviewed PR through the full pipeline
> (`pnpm typecheck && pnpm lint && pnpm test:coverage-check && pnpm test:all &&
> pnpm build`). Step 9 is a manual owner action in the Vercel + Inngest dashboards,
> done **after** that PR is deployed and stable.

---

## Verification after removal (steps 3–8 PR)

Run from `frontend/`:

```
pnpm typecheck
pnpm lint
pnpm test:coverage-check
pnpm test:all
pnpm build
```

- `pnpm build` must succeed with **no** `inngest` module in `node_modules`
  resolution (the dep is gone).
- Grep `grep -rn "from \"@/lib/inngest\|from 'inngest'\|inngest.send\|serve(" frontend/lib frontend/app`
  returns **zero** live references.
- The ops dashboard no longer shows an Inngest dependency row (or shows a static
  "retired" note).
- A synthetic dead-letter row with an **unknown** event name is preserved/logged,
  **not** re-emitted (step 3).

## Rollback

Steps 3–8 are a single PR — revert it to restore the client, serve route, sink,
and package (Inngest Cloud still holds the app until step 9). Do **not** start
step 9 until the steps 3–8 PR has been deployed and observed stable for at least
one full weekly-cron period.
