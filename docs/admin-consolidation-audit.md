# AutoLenis — Admin Consolidation & Program-Integration Audit

**Type:** Read-only discovery audit. No application code was changed, no migration applied, no route edited.
**Baseline:** `main` @ `aa8c16f3d100598cf47bd078058b840ecde65797` (merge of PR #337; verified equal to `origin/main` at audit time).
**Working dir:** `frontend/`.
**Method:** static inspection of `app/admin/**` + `app/api/admin/**` + `lib/services/admin/**` + `lib/auth/**` + `lib/services/ai/action-intent/**`, plus read-only Supabase queries against project `aieybibvewmvrubcpthm` (physical schema `public`, snake_case) to confirm real production state. `pnpm typecheck` executed (passed).

> **Governing principle applied:** inspect → reuse → consolidate → repair → enhance → create-only-if-absent. A 139-page admin has intentional variation; only genuine defects, real duplication, actual authorization gaps, and true missing capabilities are reported below. "Different from how I'd write it" is not a finding.

---

## Admin inventory (measured, not estimated)

| Metric | Count |
| --- | --- |
| Admin pages (`app/admin/**/page.tsx`) | **139** |
| Admin API routes (`app/api/admin/**/route.ts`) | **307** |
| Top-level admin page domains | 53 |
| Top-level admin API domains | 46 |
| Per-actor command-center services | 3 (`admin-{buyer,dealer,affiliate}-command-center.service.ts`) |
| `getAdminFromRequest` call sites | 469 across 215 route files |
| Routes gated by hard role check (`getAdminWithRole`) | 30 |
| Routes gated by shadow RBAC (`requirePermission`/`Actor`) | 51 |
| Routes with inline role-array checks | 38 |

> ⚠️ **Correction to the brief's stated context.** The brief cites "~55 pages / ~150 API routes." The real surface is **139 pages / 307 routes** — roughly 2× larger on both axes. Every consolidation estimate below is scaled to the true surface.

**Production-state grounding (read-only Supabase, audit time):**

| Signal | Value | Meaning |
| --- | --- | --- |
| deals (total / active) | **0 / 0** | No deal has ever completed; P4 has no live data |
| offers | **0** | No dealer offer ever submitted |
| auctions (total / active) | 6 / 0 | A handful created, none live |
| deposits (PAID) | 7 (6 PAID) — 3 real Stripe PI, 3 admin/`pi_admin_`/null | Mostly manual/override |
| `payment_provider_events` / `webhook_events` | **0 / 0** | **3 PAID deposits with real PIs but zero provider/webhook events → live P1 reconciliation gap** |
| commissions / affiliate_payouts | **0 / 0** | Settlement store is empty |
| dealer_prospects | **1,532** | Prospect list loaded |
| dealer_outreach_log / dealer_discoveries | **0 / 0** | **Prospecting pipeline has never run in prod** |
| health_check_logs / cron_job_logs | 2,017 / 43,316 | Infra monitoring runs heavily |
| `ai_action_intents` table | **absent** | ActionIntent durable store not migrated (dormant by design — see P6) |

The business is effectively **pre-launch on the transaction side** (zero deals/offers/commissions, dormant prospecting) while infra crons run. Any owner-facing roll-up **must render this truthfully** — empty/dormant/violated, never green-by-default.

---

## PART A — Admin internal audit (ranked; CRITICAL security first)

### 🔴 A-CRIT-1 — Money-moving & high-privilege admin routes enforce role authorization in SHADOW mode only → currently executable by *any* authenticated admin role

**Severity: CRITICAL** (documented, not fixed, per audit boundary).

`lib/auth/permissions.ts` is the RBAC role layer. Its own header states it is **SHADOW ONLY**: `requirePermission()` **never blocks** — on a would-be denial it writes an `RBAC_SHADOW_DENY` audit row and **returns the admin anyway**. Real enforcement requires `RBAC_ENFORCE=true`, which the file explicitly says is an unset "T4 operator action" gated on owner review (`permissions.ts:86-88`, `:104-130`).

Some consequential routes belt-and-suspender the shadow gate with an **inline hard role check** (safe). Others rely on the shadow gate **with no inline check** — so with `RBAC_ENFORCE` unset (the production default), they are gated only to "any authenticated admin with MFA," regardless of role. The owner ruling encoded in the same file says SUPPORT_ADMIN is read-only and money mutation is FINANCE/SUPER only — yet these routes do not enforce it:

| Route | Permission (shadow) | Inline hard check? | Consequence |
| --- | --- | --- | --- |
| `buyers/[buyerId]/deposit/override` | `finance.deposit.override` | **none** | Mints a **PAID deposit** (money-equivalent; unblocks auction) |
| `affiliates/commissions/[commissionId]/approve` | `finance.commissions.settle` | **none** | Approves commission for payout |
| `affiliates/commissions/[commissionId]/mark-paid` | `finance.commissions.settle` | **none** | Marks commission **PAID** |
| `affiliates/commissions/[commissionId]/reject` | `finance.commissions.settle` | **none** | Rejects commission |
| `deals/[dealId]/esign/void` | `deals.esign.void` | **none** | Voids a signing envelope (contractual) |
| `deals/[dealId]/esign/evidence` | `deals.esign.void` | **none** | Exports **raw forensic evidence** (signer IP, user-agent, consent snapshot) |
| `operations/dlq/[id]/retry` | `ops.replay` | **none** | Replays a failed job — re-fires arbitrary inherited side effects (permissions.ts:69 itself flags this as "highest-privilege op in the surface, SUPER only") |

**The proof this is an oversight, not a design choice:** sibling routes in the *same families* DO hard-enforce role, inline, independent of the shadow layer:

- `payments/deposit/[depositId]/refund` and `.../mark-paid` → `getAdminWithRole(["SUPER_ADMIN","FINANCE_ADMIN"])`
- `affiliates/commissions/[commissionId]/reverse` and `.../clawback` → `requirePermission` **+** inline `if (!ALLOWED_ROLES.has(admin.role)) 403`
- `dealers/[dealerId]/terminate` → inline `if (admin.role !== "SUPER_ADMIN") 403`
- `support/impersonate` (+ `.../end`) → inline role check
- `referral-milestones/[id]/pay`, `payments/concierge-fee/[dealId]/{refund,mark-paid}` → `getAdminWithRole([SUPER,FINANCE])`

So `deposit/override` (mints money) is any-admin while its twin `deposit/mark-paid` requires FINANCE/SUPER; `commissions/approve|mark-paid` are any-admin while their twins `reverse|clawback` require FINANCE/SUPER. The divergence is internal to each family — a clear authorization-consistency defect.

**Threat model (precise):** not anonymous/external — requires an authenticated admin session (credentials + MFA). The exposure is a **lower-tier admin insider** (SUPPORT_ADMIN, COMPLIANCE_ADMIN) performing money movement, commission settlement, contract voids, raw-forensic export, and job replay that the owner's own role policy forbids them. Authentication, MFA, and audit logging are present on every one of these routes; what is missing is **runtime role segregation**.

**Fix is built but disabled.** The enforcement machinery (`PERMISSION_ROLES` map + `RBAC_ENFORCE`) already exists. Closing this is either (a) flipping `RBAC_ENFORCE=true` after the owner's shadow-denial bucketing review, and/or (b) adding the same inline hard check the sibling routes already use. **Not performed in this pass.** (See Batch 1.)

> Lower-consequence shadow-only routes also exist (CRM reads/writes, outbound comms `crm/campaigns/bulk-send`, `crm/contacts/[id]/send-sms|email`, `crm/copilot/approve`). These are mostly reversible and/or backed by the separate comms-consent layer; they are **MEDIUM** (see A-MED-4), not part of this critical cluster — but they share the same shadow-gate root cause.

---

### 🟠 A-HIGH-1 — Owner-facing health verdict is structurally green-biased (reads "healthy" while payments/invariants are broken)

**Severity: HIGH.** Three compounding defects make the automation-health surface untrustworthy:

1. **P1 alerts do not degrade status.** `health.service.ts:115` computes `status = !dbOk ? "down" : alerts.some(a => a.startsWith("P0")) ? "degraded" : "healthy"`. Stripe unreachable, MicroBilt missing, inventory-health below threshold, and unresolved contract FAILs are all pushed as `P1:` (`:109-113`) — so they **leave the headline reading "healthy."** Only a DB failure or an OFAC (P0) alert moves the needle.
2. **Integration "health" is env-var presence, not reachability.** `checkResend()` / `checkMicroBilt()` return `!!process.env.*` (`health.service.ts:72-78`). A present-but-revoked key reports healthy. Only Stripe does a live probe (`balance.retrieve`).
3. **The PAID-deposit invariant is excluded from the headline.** `checkDepositProviderEvidence()` (`health.service.ts:272-311`) — the exact "PAID deposit + real `pi_` intent with no `payment_provider_events` row" check — is computed by `checkSLAs()` (cron `sla-check`) but is **not** part of `runHealthCheck()`, so `/admin/system-health` can show "all systems nominal" while the invariant is breached. **The DB grounding shows this invariant is live right now (3 such deposits, 0 provider events).**

Additional cosmetic-green chrome: `app/admin/dashboard/page.tsx:43,233-235` renders a hardcoded "Live Platform" pulse dot and "Session active · MFA verified" green footer unconnected to any live health signal.

---

### 🟠 A-HIGH-2 — Large, genuine route-handler duplication (60–90 routes share one boilerplate)

**Severity: HIGH consolidation value** (not a correctness bug; real maintenance/΅drift risk).

The dominant admin-route shape is ~30 identical lines: `await params → getAdminFromRequest → 401 → [findUnique 404] → parse JSON (adminError "Invalid JSON") → schema.safeParse → service() → adminSuccess / catch adminError("ACTION_FAILED")`. Measured incidence: **215** routes repeat the auth+401 line; **93** contain the literal `adminError("VALIDATION_ERROR","Invalid JSON",400)`; **61** declare a `reason: z.string().min(...)` schema. Near-identical families: buyer account (`suspend`/`unsuspend`/`disable`/`reactivate`/`archive`/`restore`), per-actor `approve|suspend|reactivate|terminate`, all `compliance/flag|resolve`, all `note`, and the commission family. A `defineAdminActionRoute({auth,schema,load,run,audit})` factory (or `withAdmin()`+`parseJson()` wrappers) collapses 60–90 routes to a few lines each — keeping genuine per-route side-effects (Supabase session revocation, suspension email) as `run` callbacks. **Largest single LOC win in the admin layer.**

---

### 🟠 A-HIGH-3 — Per-actor command-center service triplication

**Severity: HIGH consolidation value.** The three command-center services re-implement the same primitives once per actor, differing only in Prisma model + audit `action` string + `entityType`:

- **Status transitions** — `find → status guard → update({status}) → audit({previousStatus})`: dealer `admin-dealer-…:626-755`, affiliate `admin-affiliate-…:570-725`, buyer `admin-buyer-…:1014-1081`. (~18 functions.)
- **Compliance flag+resolve** — near byte-identical: `admin-dealer-…:824-876`, `admin-affiliate-…:790-842`, `admin-buyer-…:798-836`.
- **Admin note** — `addDealerAdminNote` / `addAffiliateAdminNote` identical; buyer's is inlined in its route.
- **"Latest flagged-vs-resolved" compliance derivation** re-coded in **~9 places** (KPI/list/detail/action-availability across all three services) with subtle divergence (distinct-sets vs findFirst-pairs vs ordered-maps) — the divergence is itself a correctness/drift risk.

Consolidate to `transitionActorStatus(model, entityType, {guard, action})`, `setComplianceFlag(...)`, `addActorNote(...)`, and one `resolveComplianceState(entityType, ids)`. Per-actor **guards** and **detail-loaders** legitimately differ and must stay parameterized/separate.

---

### 🟡 A-MED-1 — Three broken internal admin links (verified 404)

All in `app/admin/buyers/[buyerId]/AdminBuyerCommandCenter.tsx`:

| Line | Broken `href` | Correct/likely target |
| --- | --- | --- |
| 1744 | `/admin/audit-logs` | `/admin/audit-log` (singular — the real page) |
| 1444 | `/admin/payments/concierge-fees` | No such page (`payments/` has deposits/refunds/reconciliation) |
| 1352 | `/admin/queues/OFAC_ALERT` | `/admin/queues` has no `[type]` dynamic segment; likely `/admin/compliance/ofac` or a query param |

Low blast radius (dead links, not data loss) but real, and trivially fixable.

### 🟡 A-MED-2 — Duplicate primary auth primitive + bypassed audit helper

- `getAdminFromRequest(request)` (`lib/auth/admin-api.ts:15-28`) and `getAuthenticatedAdmin()` (`lib/auth/admin-session.ts:9-25`) are byte-for-byte the same logic; `getAdminFromRequest` even takes a `request` arg it never uses (it calls `cookies()`). The two-file split is the sole reason the codebase reads as having "parallel admin-auth helpers." (The rest — `getAdminWithRole`, `requireAdminRole`, `requireContentCapability`, `getAdminActor` — are a legitimate layered RBAC hierarchy, not copies.) `requirePermission` and `requirePermissionActor` also duplicate their entire ~25-line shadow-deny body.
- `admin-api.ts` already exports `createAuditLog(admin, request, …)` (auto-captures client IP), but **11 routes** hand-inline `x-forwarded-for` IP extraction + `adminAuditLog.create`, and all 3 command-center services hand-roll ~30 `adminAuditLog.create` calls **with no IP capture** — a real inconsistency: service-written audit rows silently lack `ipAddress`.

### 🟡 A-MED-3 — Suspected supersession / redundant surfaces (all currently reachable — NEEDS CONFIRMATION)

| Pair | Evidence | Likely canonical |
| --- | --- | --- |
| `/admin/ops-dashboard` (196 L) vs `/admin/operations` (505 L) | Both ops/health surfaces; `operations` is richer (queue failures, workflow exits, audit log) and lives in the newer CRM shell | `/admin/operations` |
| `/admin/requests` ("Request a Car Queue 4C") vs `/admin/vehicle-requests` ("Public Vehicle Requests") | Both query `prisma.vehicleRequest`; `vehicle-requests` header says it replaced a stale-Notification impl | `/admin/requests` is fuller; confirm intent |
| `/admin/reports/affiliate` vs `/admin/reports/affiliates` | Both in Reports nav with **confusingly swapped labels**; one is per-affiliate list, one is aggregate KPI | Complementary but merge-worthy; relabel |

(`/admin/offers` vs `/admin/vehicle-offers` and `offers` vs `vehicle-offers` models are **distinct features**, not supersession.)

### 🟡 A-MED-4 — Outbound-comms mutations gated shadow-only

`crm/campaigns/bulk-send`, `crm/contacts/[id]/send-sms`, `crm/contacts/[id]/send-email`, `crm/copilot/approve`, `crm/automations/[id]/trigger` run under the shadow gate with no inline check. Consequential (mass send / TCPA-A2P surface) but backed by the separate suppression/consent layer; still worth hard-gating `comms.bulk_send` to OPS when RBAC enforcement lands.

### ⚪ A-LOW-1 — ~23 candidate-orphan API routes & unused scaffold (NEEDS CONFIRMATION)

**No hard-orphan pages** — all 139 pages are reachable via nav or a parent hub link. But ~23 routes have **no in-repo caller** (static grep; dynamic/template-literal and external/integration callers cannot be ruled out): a set of GET routes shadowed by their own Server Component page reading Prisma directly (`activity`, `analytics`, `buyers/source-stats`, `reports/funnel`, `reports/risk`, `seo/keywords[+/[id]]`, `affiliates/onboarding`, `inventory/upload/history`, `crm/coverage`, `dealer-outreach/stats`, `offers[+/[offerId]]`, `content/jobs[+/[id]]`, `faith/*`), and a set of POST/action routes with no trigger (`dealer-outreach/send-batch`, `inventory/bootstrap`, `content/articles/generate`, `crm/automations/prebuilt`, `dealers/invitations[+/[invId]/cancel|resend]`, `payments/fee-check`, and the `action-intents` trio — see P6). `components/admin/crm/PhaseStub.tsx` ("Coming in {phase}") is imported by no page. **Confirm against external consumers before removing anything.**

**`pnpm typecheck` passed (exit 0)** — no stale imports, no references to removed services, no broken types. That rules out a whole class of "broken surface" defects.

---

## PART B — Program ↔ Admin coverage matrix

| Program | Verdict | Canonical service reused | Admin surface | Specific gap |
| --- | --- | --- | --- | --- |
| **P1 Reliability/Recovery** | **PARTIAL** | `health.service` (`runHealthCheck`, `checkSLAs`, `checkDepositProviderEvidence`), `dead-cron.service` | `/admin/system-health`, `/admin/operations`, `/admin/queues` (System Alerts) | No **consolidated** automation-health view (health/cron/invariants split across 3 pages); headline status is green-biased (A-HIGH-1) and **excludes** the PAID-deposit invariant; `payout-invariants.ts` and `pickup-sla.service` are surfaced **nowhere** (payout-invariants is imported only by its own test) |
| **P2 Lifecycle Comms** | **NOT SURFACED** | `crm/lifecycle-scheduler`, `qstash/state`, `lifecycle-touch-drain.service` | `/admin/comms` is **send-only** (compose forms) | The QStash-scheduled pipeline (deposit-reminder, pre-checkout resume, lifecycle touches) has **no admin observability** — no scheduled/pending/QStash-vs-internal state, no per-buyer comms timeline; only hard failures leak into the generic DLQ panel. No `app/api/admin/comms/*` read route exists |
| **P3 Buyer→Dealer→Auction** | **SURFACED (honestly dormant)** | `dealer-auction-eligibility.service`, `auction/*`, `amips/executive-intelligence` | `/admin/auctions`, `/admin/dealer-outreach`, `/admin/amips`, buyer command center `launch-auction` | **Honesty verified:** with the never-run pipeline, `dealer-outreach` stat cards render real `groupBy` counts → all **0**, and AMIPS National Health Index → **"Initializing"**, not fake-green. Matches DB (1,532 prospects, 0 outreach/discoveries). Minor: dealer-outreach reads models directly rather than via `dealer-recruitment/*`, but the state shown is real |
| **P4 Deal Completion / e-sign** | **SURFACED** (design correct) | `esign/esign-dto` (`toAdminEvidencePackage`), `esign.service`, Deal state machine | `/admin/esign`, `/admin/deals`, `deals/[dealId]/esign/evidence` | Envelope status, append-only history, and executed-artifact status are surfaced; raw forensics are isolated to the single evidence route, DTO-shaped, and audit-logged (`ESIGN_EVIDENCE_EXPORTED`). **Caveat:** that route's role isolation is enforced via the **shadow-only** `deals.esign.void` permission — correct *by design*, not *at runtime* until RBAC enforcement lands (see A-CRIT-1). No forensic **over-exposure** in the payload itself |
| **P5 Affiliate Settlement** | **SURFACED (complete)** | `admin-affiliate-command-center.service` + `commissions/*` routes | `/admin/affiliates` | Full commission lifecycle (PENDING/APPROVED/PAID/REVERSED), payout state, and clawback/reverse/mark-paid controls all present. **No material gap** — only the A-CRIT-1 authz inconsistency on `approve`/`mark-paid`/`reject` |
| **P6 ActionIntent Layer** | **NOT SURFACED (API-only)** | `lib/services/ai/action-intent/*` + `action-intents/[id]/approve\|reject` | **No admin page** (grep of `app/admin/**` for `action-intent`/`ActionIntent`/pending-approval → 0 hits) | No console UI to review/approve/reject pending intents; the list endpoint has no page consuming it. The layer ships **DORMANT by design** — in-memory store, `ai_action_intents` table intentionally unmigrated as the single owner-gated activation step (`store.ts:8-14`), activation resolver returns 404 unless `ACTION_INTENT_EXECUTION_ENABLED=true` |

**Top three owner flags from Part B:** (1) **P6** has approve/reject logic with **no console UI at all**; (2) **P2**'s entire QStash lifecycle-comms program is unobservable in admin; (3) **P1**'s `/admin/system-health` can read "all systems nominal" while the PAID-deposit-without-provider-event invariant is breached.

---

## PART C — Linking-rule violations (ungoverned consequential actions only)

**Correct model:** admin READS each program through its canonical services (largely true — command centers, health.service, esign-dto, amips all reuse canonical services), and admin ACTIONS use existing deterministic commands, **but any materially consequential / irreversible / money-moving action that Program 6 classifies as approval-required must pass the Program 6 authorization+approval boundary rather than executing through an ungoverned path.**

**Established reality of the Program 6 boundary:**
- The ActionIntent engine is imported **only** by the four AI concierge agents (`admin/buyer/dealer/affiliate-concierge.agent.ts`) and the three `action-intents` management routes. **No human admin-console route creates or routes through an ActionIntent.**
- It is **dormant** (in-memory store; durable table intentionally unmigrated; execution flag off) and its policy catalog covers a **handful** of intent types (`admin.advance_deal_status`, `admin.extend_auction`, `admin.trigger_deposit_refund`, plus buyer/dealer/affiliate self-service).

**Genuine violations — materially consequential admin-console actions that execute outside any approval boundary AND (this subset) without enforced role authorization.** These are the highest-priority findings because they are the ungoverned, under-authorized path around the controls Program 6 established:

| Console action | Money/irreversible? | Program 6 has a matching intent? | Current governance |
| --- | --- | --- | --- |
| `buyers/[buyerId]/deposit/override` | Money-equivalent (mints PAID deposit) | No direct intent; adjacent to `admin.trigger_deposit_refund` | **Shadow-only role gate → any admin**; audit-logged; no approval |
| `affiliates/commissions/[id]/approve` \| `mark-paid` \| `reject` | Money movement (settlement) | No intent registered | **Shadow-only role gate → any admin**; audit-logged; no approval |
| `payments/deposit/[id]/refund` | Money (Stripe refund) | **Yes** — `admin.trigger_deposit_refund` exists in the catalog/policy | Direct execution, **bypassing** the defined intent; hard role-gated (FINANCE/SUPER); no second-approver |
| `deals/[dealId]/esign/void` + `.../evidence` | Contractual / raw-PII export | No intent | **Shadow-only role gate → any admin**; audit-logged |
| `operations/dlq/[id]/retry` | Irreversible side-effect replay | No intent | **Shadow-only role gate → any admin**; audit-logged |
| `buyers/[buyerId]/launch-auction`, `journey/complete-all` | Consequential (launches auction / force-completes journey, seeds deposits) | No intent | Direct; **hard role-gated** (SUPER/OPS); no approval |

**Two distinct problems are stacked here:**
1. **No approval boundary on the console at all.** Every consequential admin action executes directly. There is **no maker-checker / second-approver** control anywhere in the console, and the intent types Program 6 *does* define (notably `admin.trigger_deposit_refund`) have direct console equivalents that bypass them. Because Program 6 is dormant and AI-scoped, this is best read as *"the approval boundary was never extended to the human console,"* not *"a live break of an active control"* — but it is exactly the ungoverned surface Part C targets.
2. **The shadow-only subset is also under-authorized** (A-CRIT-1) — so those rows are *both* unapproved *and* callable by roles the owner policy forbids.

**Not flagged (correctly reversible / not approval-class):** the large body of routine admin operations — notes, reminders, status reads, assignment, workflow move/pause/resume, list/detail fetches — execute directly and should. They are not padded into this list.

---

## PART D — Owner roll-up gap

**Does a unified owner "how is the business doing + what needs my decision" view exist? — No.** It is fragmented across ≥5 disconnected surfaces, none aggregating the others:

| Surface | Shows | Source |
| --- | --- | --- |
| `/admin/dashboard` | 5 raw counts + activity feed + quick-links | inline `prisma.count` |
| `/admin/ops-dashboard` | 12 funnel/pipeline counts + in-progress deals | `admin-ops.service` |
| `/admin/operations` | Infra only: dependency health, DLQ, failed enrollments, cron, audit | `OperationsService` (different design tokens) |
| `/admin/queues` | 8 exception queues with inline resolve | `admin-queue.service` |
| `/admin/system-health` | DB/inventory/OFAC/contract + integration flags | `health.service` |
| AMIPS Executive Intelligence | Executive roll-up **scoped only to dealer-acquisition/market** | `amips/intelligence` |

`dashboard`, `ops-dashboard`, `system-health`, and the AI briefing agent each **independently re-run the same four counts** (active deals, active auctions, contract FAILs, OFAC) with no shared source. `morning-briefing.service` is **not a roll-up UI** — it saves an AI prose blob (`AdminBriefing`) that **no page renders**.

**The specific delta — what must be built (the building blocks already exist):**

- **Business-health band:** compose the three existing `getAdmin{Buyer,Dealer,Affiliate}Kpis()` + `getFullDashboardReport()` (`admin-reports.service:7`). *All exist; never combined.*
- **System-health band:** `runHealthCheck()` + `checkSLAs()` + `checkDepositProviderEvidence().gaps` + `OperationsService.getHealth()`. **SLA / deposit-reconciliation gaps / `payout-invariants` are computed cron-only and rendered nowhere** — an owner cannot currently see an invariant violation. And the health verdict itself must be de-green-biased (A-HIGH-1).
- **Unified "REQUIRES YOUR DECISION" queue:** today the decision items are scattered across **six independent surfaces never unified** — exception queues (`getQueueCounts`), financing reviews (`listOpenReviewTasks`), prequal manual-reviews/OFAC, external pre-approvals, insurance requests, and action-intents (`listByStatus("APPROVAL_REQUIRED")`). No code sums or co-lists them. This is the single highest-value missing capability.

**Honesty requirement (must-hold, given the DB state):** the roll-up must render zero deals, empty settlement, dormant prospecting, and the live 3-deposit provider-event gap **as such**. Existing per-count rendering is honest and empty-safe; the *aggregate health verdict* is not (A-HIGH-1), and dormant/flagged-off surfaces currently read as absent rather than "0 pending (surface off)."

This is a **compose-existing-services** job — a thin `admin-owner-rollup.service.ts` + one page — **not** a new admin app. Building new is justified only for the *joining/aggregation* layer, which provably does not exist today.

---

## PART E — Scoped batch plan (dependency-ordered; nothing implemented in this pass)

Fewest coherent batches that consolidate + close verified gaps without rewriting the surface.

### ▶ Batch 1 — Authorization consistency & enforcement *(RECOMMENDED FIRST)*
- **Objective:** eliminate A-CRIT-1 — make role authorization on money-moving / high-privilege routes actually enforced and consistent with their already-hard-gated siblings.
- **Files/services:** the shadow-only consequential routes (`buyers/[buyerId]/deposit/override`, `affiliates/commissions/[id]/{approve,mark-paid,reject}`, `deals/[dealId]/esign/{void,evidence}`, `operations/dlq/[id]/retry`, and the outbound-comms set); `lib/auth/permissions.ts`.
- **Reuse vs new:** 100% reuse — either add the same inline hard role check the sibling routes already use, and/or complete the owner's shadow-denial bucketing review and flip `RBAC_ENFORCE=true`. **No new system.**
- **Risk tier:** HIGH security value / LOW code-risk (surgical, tested pattern already in-repo).
- **Owner-gated:** **Yes** — flipping `RBAC_ENFORCE` is the documented T4 operator action requiring owner review of the shadow-denial report.
- **Why first:** highest severity, smallest blast radius, and it makes every downstream governance claim (Batches 2–3) trustworthy.

### Batch 2 — Owner roll-up + unified decision queue + honest health verdict
- **Objective:** close Part D and the P1/P6 surfacing gaps: one owner view composing existing KPIs/health/invariants + a single "REQUIRES YOUR DECISION" inbox unifying the six decision surfaces; fix the green-biased health verdict (include `providerEvidenceGaps`, degrade on P1, make integration checks real probes).
- **Files/services:** new `lib/services/admin/admin-owner-rollup.service.ts` (thin aggregator) + one page; reuse `getAdmin*Kpis`, `getFullDashboardReport`, `runHealthCheck`/`checkSLAs`/`checkDepositProviderEvidence`, `getQueueCounts`, `listOpenReviewTasks`, external-preapproval/insurance/manual-review queries, action-intents `listByStatus`; edit `health.service.ts` status logic.
- **Reuse vs new:** reuse all data methods; **new = the aggregation/composition layer only** (proof: no code joins these today).
- **Risk tier:** MEDIUM. **Owner-gated:** No (read surface), high owner value.

### Batch 3 — P2 lifecycle-comms observability + P6 intent-queue UI
- **Objective:** admin read-views for the QStash lifecycle pipeline (scheduled/pending/failed deposit-reminder & pre-checkout state) and an admin UI rendering the pending-ActionIntent queue with approve/reject.
- **Files/services:** reuse `qstash/state`, `crm/lifecycle-scheduler`, `lifecycle-touch-drain.service`, `action-intents` routes + `shapeIntentForAdmin`; new read pages/routes.
- **Reuse vs new:** reuse services; new = read UI. P6 UI must respect the dormant activation flag (show "surface off / N pending" honestly).
- **Risk tier:** MEDIUM. **Owner-gated:** partial (P6 activation remains owner-gated).

### Batch 4 — Admin consolidation refactor (duplication)
- **Objective:** A-HIGH-2/A-HIGH-3/A-MED-2 — extract the `defineAdminActionRoute`/`withAdmin`+`parseJson` factory (60–90 routes), parametrized `transitionActorStatus`/`setComplianceFlag`/`addActorNote` + `resolveComplianceState`, unify `getAdminFromRequest`≡`getAuthenticatedAdmin`, and route all audit writes through `createAuditLog` (fixing the missing-IP inconsistency).
- **Reuse vs new:** pure reuse/refactor; keep per-route side-effects as callbacks.
- **Risk tier:** MEDIUM (touches many routes — do behind the full test matrix). **Owner-gated:** No. **Sequenced late** so the refactor lands after auth is trustworthy and after the new surfaces stop churning it.

### Batch 5 — Dead/supersession cleanup + broken-link fixes *(LOW)*
- **Objective:** fix the 3 broken links (A-MED-1); relabel the swapped Reports links; confirm-then-retire the ~23 candidate-orphan routes and resolve the supersession pairs (ops-dashboard↔operations, requests↔vehicle-requests).
- **Reuse vs new:** cleanup only. **Risk tier:** LOW; **gate every removal** on confirming no external/dynamic caller.

---

## What remains NOT VERIFIED

- **Orphaned routes & supersession (A-LOW-1, A-MED-3):** static analysis cannot see template-literal/dynamic URLs or external/mobile/integration callers. The ~23 routes and the supersession pairs are **candidates**, not confirmed-dead — each needs a caller-trace before removal.
- **Runtime behavior of the shadow gate:** confirmed `RBAC_ENFORCE` is unset by code default and by the file's own documentation; the *actual* production env value was not read (no env access). If it were somehow `true`, A-CRIT-1's exposure would be closed by enforcement (the inconsistency would still stand as defense-in-depth debt).
- **`checkDepositProviderEvidence` exact match logic:** the DB grounding shows 3 PAID deposits with real PIs and 0 provider/webhook events (a strong invariant signal), but `payment_provider_events` links via JSON payload, not a PI column — the precise per-deposit join is done in `health.service`, not re-executed here.
- **Live rendering:** pages were read as source, not run in a browser; the "green-biased verdict" findings are from the status-computation code, not a live screenshot.
- **P6 activation path end-to-end:** the durable `ai_action_intents` table is absent (dormant by design), so the approve/reject flow could not be exercised against real persisted intents.

---

*Read-only audit. No application code, route, migration, or configuration was modified. Deliverable is this document only.*
