# AutoLenis — Admin Consolidation & Program-Integration Audit

**Type:** Read-only discovery audit. No application code changed, no migration applied, no route edited.
**Baseline:** `main` @ `d6f6b56cfbe1c5b9a3753d16d3864ef847d1895f` (merge of PR #367) — SHA verified at audit time.
**Working dir:** `frontend/`.
**Method:** static inspection of `app/admin/**`, `app/api/admin/**`, `lib/services/admin/**`, `lib/auth/**`, `lib/services/ai/action-intent/**`, `lib/services/monitoring/**`, plus read-only Supabase queries against project `aieybibvewmvrubcpthm` (physical schema `public`, snake_case) to confirm what state actually exists to surface.

> **Governing principle applied:** inspect → reuse → consolidate → repair → enhance → create-only-if-absent. A 140-page admin has intentional variation; only genuine defects, real duplication, actual authorization gaps, and true missing capabilities are reported. "Different from how I'd write it" is not a finding.

> **Revision note.** An earlier pass of this audit ran against `aa8c16f`. `main` has since advanced 444 files, and PR #338 (`admin-authz-audit-batch-1`) **remediated that pass's CRITICAL finding**. This document is re-verified against `d6f6b56`; every status below reflects current `main`, and remediated items are marked **CLOSED** with the evidence that closed them.

---

## Admin inventory (measured)

| Metric | Count |
| --- | --- |
| Admin pages (`app/admin/**/page.tsx`) | **140** |
| Admin API routes (`app/api/admin/**/route.ts`) | **308** |
| Top-level admin page domains | 53 |
| Per-actor command-center services | 3 |
| `getAdminFromRequest` route files | 215 |
| Routes gated by shadow RBAC (`requirePermission*`) | 51 |
| Of those, still shadow-only (no hard enforcement) | **31** — all CRM read/manage, `search`, `operations/analytics/refresh` |

> ⚠️ **Correction to the brief's stated context.** The brief cites "~55 pages / ~150 API routes." The real surface is **140 pages / 308 routes** — roughly 2x on both axes. Estimates below are scaled to the true surface.

**Production-state grounding (read-only Supabase, audit time):**

| Signal | Value | Meaning |
| --- | --- | --- |
| deals / offers | **0 / 0** | No deal or dealer offer has ever completed; P4 has no live data |
| auctions | 7 (0 active) | A handful created, none live |
| deposits PAID | 7 — of which **4 carry a real Stripe PI** | Rest are admin-seeded/`pi_admin_` |
| `payment_provider_events` | **0** | **4 real-PI PAID deposits with zero provider events → the P1 reconciliation invariant is live and has widened (was 3 at the prior pass)** |
| `webhook_events` | 2 (was 0) | New rejected-delivery logging is now writing |
| commissions / affiliate_payouts | **0 / 0** | Settlement store empty |
| dealer_prospects | **1,532** | Prospect list loaded |
| dealer_outreach_log | **0** | **Prospecting pipeline has never run in prod** |
| `ai_action_intents` table | **absent** | P6 durable store not migrated — activation blocker (see P6) |

The business is **pre-launch on the transaction side** while infra crons run heavily. Any owner roll-up **must render this truthfully** — empty/dormant/violated, never green-by-default.

---

## PART A — Admin internal audit (ranked; security first)

### ✅ A-CRIT-1 — CLOSED: shadow-only authorization on money/high-privilege routes

**Status on `d6f6b56`: REMEDIATED.** This was the prior pass's CRITICAL finding. `lib/auth/permissions.ts` remains **SHADOW** overall (`RBAC_ENFORCE` deliberately unset — the T4 rollout is still owner-gated), but the routes that move money, fan out sends, or replay jobs now **hard-enforce ahead of the flip**, drawing their allow-list from the same `PERMISSION_ROLES` map so no new policy is invented. Verified route-by-route:

| Route | Enforcement now |
| --- | --- |
| `buyers/[buyerId]/deposit/override` | `ALLOWED_ROLES {SUPER, FINANCE}` + inline 403 |
| `affiliates/commissions/[id]/approve` \| `mark-paid` \| `reject` | `ALLOWED_ROLES {SUPER, FINANCE}` + inline 403 |
| `deals/[dealId]/esign/void` \| `esign/evidence` | `ALLOWED_ROLES {SUPER, OPERATIONS}` + inline 403 |
| `operations/dlq/[id]/retry` | `requirePermissionActorStrict("ops.replay")` — hard-denies regardless of `RBAC_ENFORCE` |
| `crm/campaigns/bulk-send`, `contacts/[id]/send-sms`, `send-email`, `copilot/approve`, `automations/[id]/trigger`, `contacts/import` | `requirePermissionActorStrict("comms.bulk_send")` |
| `crm/conversations/[id]/reply` | `requirePermissionActorStrict("comms.reply")` |
| `crm/campaigns` POST | Correctly branches: `requirePermissionActorStrict("comms.bulk_send")` when `send_immediately \|\| scheduled_at`, else `crm.manage` — the campaign-create bypass of the bulk-send gate is genuinely closed |

**No CRITICAL authorization bypass remains on the current baseline.**

### 🟠 A-HIGH-1 — Email unsuppression is gated shadow-only (consent control)

**Severity: HIGH.** `app/api/admin/crm/suppression/route.ts` `DELETE` calls `SuppressionService.unsuppressEmail()` behind `requirePermissionActor('crm.manage')` — **shadow-only**, so with `RBAC_ENFORCE` unset any authenticated admin (including SUPPORT_ADMIN, whom the owner ruling makes read-only) can **remove an email opt-out and make a previously-suppressed contact mailable again**.

This is the one consequential control the Batch-1 remediation did not cover. It is narrower than the closed cluster — it moves no money, and **SMS unsuppression is deliberately unsupported** (the route rejects non-email types, preserving the TCPA START review flow) — but reversing a CAN-SPAM opt-out is a compliance-class action, not a routine reversible one. It belongs with the `comms.*` strict set.

### 🟠 A-HIGH-2 — Owner-facing health verdict is still structurally green-biased

**Severity: HIGH. Partially remediated, core defect stands.**

*Improved since the prior pass:* MicroBilt now has a real outcome-window check (24h recorded call outcomes) and escalates to **P0** when calls are actively failing — `health.service.ts` explicitly reasons that reporting "healthy while no buyer could be prequalified and no deposit could be taken" is wrong.

*Still defective:*
1. **P1 alerts do not degrade status.** `health.service.ts:175` — `status = !dbOk ? "down" : alerts.some(a => a.startsWith("P0")) ? "degraded" : "healthy"`. **Stripe unreachable is still only P1** (`:163`), as are unresolved contract FAILs, inventory-health breaches, and overdue/failing crons (`:245`, `:262`). All leave the headline reading **"healthy."**
2. **Resend health is still env-presence, not reachability** — `checkResend()` returns `!!process.env.RESEND_API_KEY` (`:73`). A present-but-revoked key reports healthy. (Stripe and MicroBilt now probe for real; Resend did not get the same treatment.)
3. **The PAID-deposit invariant is still excluded from the headline.** `checkDepositProviderEvidence()` is computed inside `checkSLAs()` (the cron cycle), **not** inside `runHealthCheck()`. So `/admin/system-health` can read "all systems nominal" while the invariant is breached — and **the DB grounding shows it is breached right now (4 real-PI PAID deposits, 0 provider events).**

### 🟠 A-HIGH-3 — Route-handler boilerplate duplication (unchanged)

**Severity: HIGH consolidation value.** Measured on the current baseline: **215** route files repeat the `getAdminFromRequest` + 401 preamble; **94** contain the literal `adminError("VALIDATION_ERROR", "Invalid JSON", 400)`; ~61 declare a `reason: z.string().min(...)` schema. Near-identical families persist: buyer account (`suspend`/`unsuspend`/`disable`/`reactivate`/`archive`/`restore`), per-actor `approve|suspend|reactivate|terminate`, all `compliance/flag|resolve`, all `note`, and the commission family. A `defineAdminActionRoute({auth, schema, load, run, audit})` factory (or `withAdmin()` + `parseJson()` wrappers) collapses 60–90 routes to a few lines each, keeping genuine per-route side-effects (Supabase session revocation, suspension email) as `run` callbacks. **Largest single LOC win in the admin layer.**

### 🟠 A-HIGH-4 — Per-actor command-center triplication (unchanged)

**Severity: HIGH consolidation value.** The three command-center services still re-implement the same primitives once per actor, differing only in Prisma model, audit `action` string, and `entityType`:

- **Status transitions** (`find → guard → update({status}) → audit({previousStatus})`) across dealer / affiliate / buyer — ~18 near-identical functions.
- **Compliance flag + resolve** — verified still duplicated in both dealer and affiliate services (2 functions each) plus the buyer exception equivalents.
- **Admin note** — `addDealerAdminNote` / `addAffiliateAdminNote` identical; the buyer variant is inlined in its route.
- **"Latest flagged-vs-resolved" derivation** re-coded in ~9 places (KPI / list / detail / action-availability) with subtle divergence — the divergence is itself a drift risk.

Consolidate to `transitionActorStatus(model, entityType, {guard, action})`, `setComplianceFlag(...)`, `addActorNote(...)`, and one `resolveComplianceState(entityType, ids)`. Per-actor **guards** and **detail-loaders** legitimately differ and must stay parameterized/separate.

### 🟡 A-MED-1 — Duplicate primary auth primitive + bypassed audit helper

- `getAdminFromRequest(request)` (`lib/auth/admin-api.ts`) and `getAuthenticatedAdmin()` (`lib/auth/admin-session.ts`) are the same logic; the former takes a `request` it never uses (it reads `cookies()`). This split is the sole reason the codebase reads as having "parallel admin-auth helpers." The rest (`getAdminWithRole`, `requireAdminRole`, `requireContentCapability`, `getAdminActor`, `requirePermission*`) are a legitimate layered hierarchy, not copies.
- `admin-api.ts` exports `createAuditLog(admin, request, …)` which auto-captures client IP, yet ~11 routes hand-inline `x-forwarded-for` extraction, and the three command-center services hand-roll ~30 `adminAuditLog.create` calls **with no IP capture** — service-written audit rows silently lack `ipAddress`.

### 🟡 A-MED-2 — Suspected supersession / redundant surfaces (NEEDS CONFIRMATION)

| Pair | Evidence | Likely canonical |
| --- | --- | --- |
| `/admin/ops-dashboard` vs `/admin/operations` | Both ops/health surfaces; `operations` is far richer (DLQ, failed enrollments, cron status, audit) and lives in the newer CRM shell | `/admin/operations` |
| `/admin/requests` vs `/admin/vehicle-requests` | Both query `prisma.vehicleRequest`; `vehicle-requests` header notes it replaced a stale-Notification implementation | `/admin/requests` is fuller; confirm intent |
| `/admin/reports/affiliate` vs `/admin/reports/affiliates` | Both in Reports nav with confusingly swapped labels (per-affiliate list vs aggregate KPI) | Complementary but merge-worthy; relabel |

(`/admin/offers` vs `/admin/vehicle-offers` are **distinct models/features**, not supersession.)

### ⚪ A-LOW-1 — Candidate-orphan routes (NEEDS CONFIRMATION)

**No hard-orphan pages** — all pages are reachable via the consolidated nav shell or a parent hub link. ~23 routes have **no in-repo caller** under static analysis: GET routes shadowed by their own Server Component reading Prisma directly (`activity`, `analytics`, `buyers/source-stats`, `reports/funnel`, `reports/risk`, `seo/keywords`, `affiliates/onboarding`, `inventory/upload/history`, `crm/coverage`, `dealer-outreach/stats`, `offers`, `content/jobs`, `faith/*`) and POST routes with no trigger (`dealer-outreach/send-batch`, `inventory/bootstrap`, `content/articles/generate`, `crm/automations/prebuilt`, `payments/fee-check`). **Template-literal and external/integration callers are invisible to grep — confirm before removing anything.** `components/admin/crm/PhaseStub.tsx` is imported by no page.

### ✅ A-MED-3 — CLOSED: three broken admin links

The prior pass found `/admin/audit-logs`, `/admin/payments/concierge-fees`, and `/admin/queues/OFAC_ALERT` referenced from `AdminBuyerCommandCenter.tsx` with no matching page. **All three references are gone on the current baseline** (0 occurrences repo-wide). `pnpm typecheck` passed at the prior pass and no stale-import class of defect was reintroduced by the nav consolidation.

---

## PART B — Program ↔ Admin coverage matrix

| Program | Verdict | Canonical service reused | Admin surface | Specific gap |
| --- | --- | --- | --- | --- |
| **P1 Reliability/Recovery** | **PARTIAL** (improved) | `health.service`, `dead-cron.service`, `cron-monitor.service`, **new** `webhook-delivery-log.service` | `/admin/system-health`, `/admin/operations`, `/admin/queues` (System Alerts) | **Improved:** rejected Stripe deliveries are now recorded and alert through the existing `webhookEvent` + `Notification` tables (good reuse — no second ledger), and MicroBilt now escalates to P0. **Still:** no consolidated automation-health view (health / cron / invariants split across three pages); headline excludes the PAID-deposit invariant and P1s don't degrade (A-HIGH-2); `payout-invariants.ts` and `pickup-sla.service` surfaced **nowhere** |
| **P2 Lifecycle Comms** | **NOT SURFACED** | `crm/lifecycle-scheduler`, `qstash/state`, `lifecycle-touch-drain.service` | `/admin/comms` is **send-only** | The QStash-scheduled pipeline (deposit-reminder, pre-checkout resume, lifecycle touches) has **no admin observability** — no scheduled/pending state, no QStash-vs-internal view, no per-buyer comms timeline. Only hard failures leak into the generic DLQ panel. No `api/admin/comms/*` read route exists |
| **P3 Buyer→Dealer→Auction** | **SURFACED (honestly dormant)** | `dealer-auction-eligibility.service`, `auction/*`, `amips/executive-intelligence` | `/admin/auctions`, `/admin/dealer-outreach`, `/admin/amips`, buyer command center | **Honesty verified:** `dealer-outreach` renders real `groupBy` counts → all **0**; AMIPS National Health Index reads **"Initializing"**, not green. Matches DB (1,532 prospects, 0 outreach). Minor: dealer-outreach reads models directly rather than via `dealer-recruitment/*`, but state shown is real |
| **P4 Deal Completion / e-sign** | **SURFACED** | `esign/esign-dto` (`toAdminEvidencePackage`), `esign.service` | `/admin/esign`, `/admin/deals`, `deals/[dealId]/esign/evidence` | Envelope status, append-only history, terminal attempts and executed-artifact status are surfaced; raw forensics (signer IP/UA/consent) are isolated to the single evidence route, DTO-shaped, audit-logged (`ESIGN_EVIDENCE_EXPORTED`) — **and now hard role-gated** to SUPER/OPERATIONS. **No forensic leak. Gap closed since prior pass** |
| **P5 Affiliate Settlement** | **SURFACED (complete)** | `admin-affiliate-command-center.service` + `commissions/*` | `/admin/affiliates` | Full commission lifecycle (PENDING/APPROVED/PAID/REVERSED), payout state, clawback/reverse/mark-paid controls, now with CAS transitions + authz tests. **No material gap** |
| **P6 ActionIntent Layer** | **NOT SURFACED** | `lib/services/ai/action-intent/*` | API routes only | **No admin page** renders the pending-intent queue (0 hits across `app/admin`); approve/reject are reachable only by direct API call. The list route now wires the **durable** `createDurableEngineDeps()` (Prisma store) rather than in-memory — but **`ai_action_intents` does not exist in the production database**, so the durable path would fail if enabled. The dormant gate is correctly ordered (404 before any store access), so this is a **latent activation blocker, not a live bug** |

**Top three owner flags:** (1) **P6** has approve/reject logic with no console UI *and* a missing table behind its now-durable store; (2) **P2**'s entire QStash lifecycle-comms program is unobservable; (3) **P1**'s `/admin/system-health` can read "all systems nominal" while the PAID-deposit invariant is breached — which it currently is.

---

## PART C — Linking-rule violations (ungoverned consequential actions only)

**Correct model:** admin READS each program through its canonical services (**largely true** — command centers, `health.service`, `esign-dto`, AMIPS, and the new webhook-delivery logging all reuse canonical services rather than forking them), and admin ACTIONS use existing deterministic commands, **but any materially consequential action Program 6 policy classifies as approval-required must pass the Program 6 authorization+approval boundary rather than retaining an ungoverned bypass.**

**Established reality of the Program 6 boundary:** the ActionIntent engine is imported **only** by the four AI concierge agents and the three `action-intents` routes. **No human admin-console route creates or routes through an ActionIntent.** The layer is dormant (surface flag off; durable table unmigrated) and its catalog covers a handful of intent types (`admin.advance_deal_status`, `admin.extend_auction`, `admin.trigger_deposit_refund`, plus self-service).

**Genuine violations — materially consequential actions executing outside the Program 6 approval boundary:**

| Console action | Consequence | Program 6 intent exists? | Current governance |
| --- | --- | --- | --- |
| `payments/deposit/[id]/refund` | Money out (Stripe refund) | **Yes — `admin.trigger_deposit_refund`** | Direct execution **bypassing the defined intent**; hard role-gated (FINANCE/SUPER); **no approval step** |
| `buyers/[buyerId]/deposit/override` | Money-equivalent (mints PAID deposit) | No | Direct; now hard role-gated; no approval |
| `affiliates/commissions/[id]/approve` \| `mark-paid` | Money movement (settlement) | No | Direct; now hard role-gated; no approval |
| `crm/suppression` DELETE | Reverses a consent opt-out | No | Direct; **shadow-only gate** (A-HIGH-1) |
| `deals/[dealId]/esign/void` | Contractual, irreversible | No | Direct; now hard role-gated; no approval |
| `operations/dlq/[id]/retry` | Replays arbitrary inherited side effects | No | Direct; strict-gated; no approval |
| `buyers/[buyerId]/launch-auction`, `journey/complete-all` | Launches auction / force-completes journey, seeds deposits | No | Direct; hard role-gated (SUPER/OPS); no approval |

**Read this precisely — the finding has changed shape since the prior pass.** Batch 1 fixed the *authorization* half: these actions are no longer callable by the wrong role (except suppression). What remains is the *approval* half: **there is no maker-checker or second-approver control anywhere in the admin console**, and the one intent type Program 6 actually defines for a console-equivalent action (`admin.trigger_deposit_refund`) is bypassed by direct execution. Because Program 6 is dormant and AI-scoped, this is best read as **"the approval boundary was never extended to the human console,"** not as a live break of an active control — but it is exactly the ungoverned surface Part C targets, and it is now the *only* remaining half of the original violation.

**Not flagged (correctly reversible):** notes, reminders, status reads, assignment, workflow move/pause/resume, list/detail fetches. These execute directly and should. The list is not padded with them.

---

## PART D — Owner roll-up gap

**Does a unified owner "how is the business doing + what needs my decision" view exist? — No.** Fragmented across five-plus disconnected surfaces, none aggregating the others:

| Surface | Shows | Source |
| --- | --- | --- |
| `/admin/dashboard` | 5 raw counts + activity feed + quick-links | inline `prisma.count` |
| `/admin/ops-dashboard` | 12 funnel/pipeline counts + in-progress deals | `admin-ops.service` |
| `/admin/operations` | Infra only: dependency health, DLQ (+terminal), failed enrollments, cron, audit | `OperationsService` |
| `/admin/queues` | 8 exception queues with inline resolve | `admin-queue.service` |
| `/admin/system-health` | DB / inventory / OFAC / contract + integration flags | `health.service` |
| AMIPS Executive Intelligence | Executive roll-up **scoped only to dealer-acquisition/market** | `amips/intelligence` |

`dashboard`, `ops-dashboard`, `system-health` and the AI briefing agent each **independently re-run the same four counts** (active deals, active auctions, contract FAILs, OFAC) with no shared source. `morning-briefing.service` is **not a roll-up UI** — it saves an AI prose blob (`AdminBriefing`) that **no page renders**.

**The specific delta (building blocks already exist):**

- **Business-health band:** compose the existing `getAdmin{Buyer,Dealer,Affiliate}Kpis()` + `getFullDashboardReport()` (`admin-reports.service`). *All exist; never combined.*
- **System-health band:** `runHealthCheck()` + `checkSLAs()` + `checkDepositProviderEvidence().gaps` + `OperationsService.getHealth()` + the new rejected-webhook signal. **SLA breaches, reconciliation gaps and `payout-invariants` are computed cron-only and rendered nowhere** — an owner cannot currently see an invariant violation, including the live one. The health verdict must also be de-green-biased (A-HIGH-2).
- **Unified "REQUIRES YOUR DECISION" queue:** today the decision items sit on **six independent surfaces that are never unified** — exception queues (`getQueueCounts`), financing reviews (`listOpenReviewTasks`), prequal manual-reviews/OFAC, external pre-approvals, insurance requests, and action-intents (`listByStatus("APPROVAL_REQUIRED")`). No code sums or co-lists them. **Highest-value missing capability.**

**Honesty requirement (must hold, given the DB state):** the roll-up must render zero deals, empty settlement, dormant prospecting, and the live 4-deposit provider-event gap **as such**. Per-count rendering is already honest and empty-safe; the *aggregate verdict* is not, and dormant/flagged-off surfaces currently read as absent rather than "0 pending (surface off)."

This is a **compose-existing-services** job — a thin `admin-owner-rollup.service.ts` plus one page — **not a new admin app**. Building new is justified only for the joining/aggregation layer, which provably does not exist.

---

## PART E — Scoped batch plan (nothing implemented in this pass)

Dependency-ordered. Batch 1 of the prior plan (**admin authorization enforcement**) has since **shipped as PR #338** and is excluded.

### ▶ Batch 1 — Owner roll-up + unified decision queue + honest health verdict *(RECOMMENDED FIRST)*
- **Objective:** close the Part D gap and the P1 surfacing defects — one owner view composing existing KPIs/health/invariants, plus a single "REQUIRES YOUR DECISION" inbox unifying the six decision surfaces; and fix the green-biased verdict (include `providerEvidenceGaps`, degrade on P1, give Resend a real probe like Stripe/MicroBilt already have).
- **Files/services:** new `lib/services/admin/admin-owner-rollup.service.ts` (thin aggregator) + one page; reuse `getAdmin*Kpis`, `getFullDashboardReport`, `runHealthCheck`/`checkSLAs`/`checkDepositProviderEvidence`, `getQueueCounts`, `listOpenReviewTasks`, external-preapproval / insurance / manual-review queries, `webhook-delivery-log`; edit `health.service.ts` status logic.
- **Reuse vs new:** reuse every data method; **new = the aggregation layer only.** *Proof:* no code today joins these — each dashboard re-runs its own counts and the invariant/SLA outputs are rendered by nothing.
- **Risk tier:** MEDIUM (one shared health-status edit; the rest is additive read surface).
- **Owner-gated:** No.
- **Why first:** it is the owner's actual ask, it surfaces a **live** invariant breach that is currently invisible, and it depends on nothing else.

### Batch 2 — Close the residual consent gate + extend approval to the console
- **Objective:** (a) move `crm/suppression` DELETE onto `requirePermissionActorStrict` with the `comms.*` allow-list (A-HIGH-1); (b) decide and implement the Part C approval posture — at minimum route `payments/deposit/[id]/refund` through the existing `admin.trigger_deposit_refund` intent rather than around it, and rule on which remaining consequential actions need maker-checker.
- **Files/services:** `app/api/admin/crm/suppression/route.ts`, `lib/auth/permissions.ts` (allow-list only), `lib/services/ai/action-intent/*`, the deposit-refund route.
- **Reuse vs new:** pure reuse — the strict helper and the intent both already exist.
- **Risk tier:** MEDIUM. **Owner-gated:** **Yes** — extending approval to human console actions is a policy decision, and P6 activation (plus the missing `ai_action_intents` migration) is explicitly owner-gated.

### Batch 3 — P2 lifecycle-comms observability + P6 intent-queue UI
- **Objective:** admin read-views for the QStash lifecycle pipeline (scheduled / pending / failed deposit-reminder and pre-checkout state), and an admin UI rendering the pending-ActionIntent queue with approve/reject.
- **Files/services:** reuse `qstash/state`, `crm/lifecycle-scheduler`, `lifecycle-touch-drain.service`, the `action-intents` routes + `shapeIntentForAdmin`; new read pages.
- **Reuse vs new:** reuse services; new = read UI. The P6 UI must respect the dormant flag and show "surface off / N pending" honestly rather than rendering absence as zero.
- **Risk tier:** MEDIUM. **Owner-gated:** partial (P6 activation and its migration remain owner-gated).

### Batch 4 — Admin consolidation refactor
- **Objective:** A-HIGH-3 / A-HIGH-4 / A-MED-1 — extract `defineAdminActionRoute` (or `withAdmin` + `parseJson`) across 60–90 routes; parametrize `transitionActorStatus` / `setComplianceFlag` / `addActorNote` + `resolveComplianceState`; unify `getAdminFromRequest` ≡ `getAuthenticatedAdmin`; route all audit writes through `createAuditLog` (fixing the missing-IP inconsistency).
- **Reuse vs new:** pure refactor; per-route side-effects stay as callbacks.
- **Risk tier:** MEDIUM (touches many routes — run behind the full 26-suite matrix). **Owner-gated:** No. **Sequenced late** so it lands after auth is settled and the new surfaces stop churning it.

### Batch 5 — Dead/supersession cleanup *(LOW)*
- **Objective:** relabel the swapped Reports links; confirm-then-retire the ~23 candidate-orphan routes; resolve the supersession pairs (`ops-dashboard`↔`operations`, `requests`↔`vehicle-requests`).
- **Risk tier:** LOW; **gate every removal** on confirming no external/dynamic caller.

---

## What remains NOT VERIFIED

- **Orphaned routes & supersession (A-LOW-1, A-MED-2):** static analysis cannot see template-literal URLs or external/mobile/integration callers. These are **candidates**, not confirmed-dead — each needs a caller trace before removal.
- **Runtime `RBAC_ENFORCE` value:** confirmed unset by code default and by the module's own documentation; the actual production environment variable was not read (no env access). The remediated routes hard-enforce **regardless** of it, so the closed finding does not depend on this.
- **`checkDepositProviderEvidence` join semantics:** the DB grounding (4 real-PI PAID deposits, 0 provider events) is a strong invariant signal, but `payment_provider_events` links via JSON payload rather than a PI column; the precise per-deposit join lives in `health.service` and was not re-executed here.
- **Live rendering:** pages were read as source, not exercised in a browser; the green-bias findings derive from the status-computation code, not a screenshot.
- **P6 end-to-end:** `ai_action_intents` is absent from production, so the durable approve/reject flow could not be exercised against persisted intents.
- **Test suite:** `pnpm typecheck` passed at the prior baseline; the full `pnpm test:all` matrix was **not** run in this read-only pass (no code changed, so no gate applies).

---

*Read-only audit. No application code, route, migration, or configuration was modified. Deliverable is this document only.*
