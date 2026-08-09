---
name: autolenis-code-verification
description: >-
  The mandatory review → fix → test → independent re-review loop that decides when AutoLenis
  work is actually finished. Owns first-pass code review of changed and materially affected code,
  executable verification (typecheck, lint, unit/integration/API/security/webhook/visual suites,
  build), root-cause remediation, full-workflow E2E verification, a from-scratch second review
  performed as if another engineer wrote the code, regression verification, the production-readiness
  verdict (PASS / PASS WITH CONDITIONS / BLOCKED), and the evidence-based completion report.
  Use this skill at the end of EVERY material implementation, modification, bug fix, refactor,
  workflow change, schema/migration change, API change, AI change, integration change, or frontend
  change — and whenever you are about to tell the user something works, is done, or is production
  ready. It overrides any impulse to declare completion after writing code, a single review, or one
  green build.
---

# AutoLenis — Code Verification Loop

## Purpose & Authority

This skill defines **when AutoLenis work is finished**. It is the terminal authority on completion
claims and it overrides every other skill's sense of "done."

The failure mode it exists to prevent is specific and recurring: *scan the code, make a few edits,
run one build, declare "production ready."* AutoLenis moves real money, invites real dealers into
legally-binding reverse auctions, and pushes real buyers through contract and e-signature flows.
A defect that survives to production is a mis-priced offer, a double charge, a leaked buyer PII
record, a stuck deal, or a compliance miss — not a cosmetic bug.

The governing principle:

> Claude writes the code → Claude attempts to **prove the code is wrong** → fixes what it finds →
> tests it → reviews it again from scratch → regression-tests the final state → **only then** may
> it declare completion.

**No material implementation is complete immediately after code is written.** Writing code ends
Step 1 of nine.

## When this skill activates

- After **any** material change: implementation, modification, bug fix, refactor, workflow change,
  database/schema/migration change, API change, AI/agent change, integration change, frontend change.
- Before writing *any* completion language: "done", "works", "fixed", "ready", "production ready",
  "everything is working", "verified".
- Before opening or updating a pull request.
- When a user reports that something previously declared finished is broken — re-enter at Step 2.
- Keywords: verify, review, double-check, is this working, production ready, ship it, sign off.

**Exempt** (Step 1 + Step 3 typecheck/lint only): pure documentation, comments, or non-executed
config text with no behavioral surface. When in doubt, run the loop.

## The loop

```
PLAN → IMPLEMENT → REVIEW → TEST → FIND DEFECTS → FIX → RETEST
     → INDEPENDENT RE-REVIEW → FIND REMAINING DEFECTS → FIX
     → REGRESSION TEST → E2E VERIFY → SECURITY REVIEW
     → PRODUCTION-READINESS REVIEW → COMPLETE
```

If a material defect surfaces at any late stage, **return to the appropriate earlier stage** and
run forward again. The process ends when the implementation is *verified*, not when it is written.

### STEP 1 — IMPLEMENT

Complete the work using the applicable architecture, domain, security, and testing skills
(`autolenis-system-architecture` → `autolenis-domain-model` → domain skill(s) →
`autolenis-testing-quality-gates`). **Do not stop here.**

### STEP 2 — FIRST CODE REVIEW

Review the actual changed code **and all materially affected surrounding code**. Do not limit the
review to modified files — trace callers, dependencies, consumers, database relationships,
workflows, and downstream effects (`git diff` names the entry points, not the blast radius).

Inspect for: incorrect logic · incomplete implementation · regressions · broken imports ·
incorrect types · invalid assumptions · duplicated functionality · architectural inconsistency ·
race conditions · concurrency issues · state-management defects · transaction problems · database
issues · RLS gaps · authorization weaknesses · security vulnerabilities · validation gaps ·
error-handling weaknesses · silent failures · API contract violations · integration failures ·
accessibility problems · responsive regressions · performance regressions · dead code ·
placeholders · TODOs · mocks or stubs left in production paths.

Use the `/code-review` capability for line-level review; use `autolenis-system-architecture` to
catch architectural damage introduced by the change itself.

### STEP 3 — RUN VERIFICATION

Run every applicable executable check in the repository. **Code that looks correct is not
evidence.** From `frontend/`:

| Check | Command | When |
| --- | --- | --- |
| Types | `pnpm typecheck` | always |
| Lint | `pnpm lint` | always |
| Core services | `pnpm test` | always |
| Payments / money | `pnpm test:payments` | deposits, fees, refunds, ledger |
| Security / authz | `pnpm test:security` | auth, roles, CSRF, rate limits, PII |
| Webhooks | `pnpm test:webhooks` | any `app/api/webhooks/*` change |
| Buyer journey | `pnpm test:buyer-journey`, `pnpm test:buyer-nav` | buyer stage/gating changes |
| Buyer APIs | `pnpm test:buyer-insurance`, `pnpm test:buyer-plan` | those routes |
| Content / admin content | `pnpm test:content`, `pnpm test:admin-content` | content pipeline |
| CRM | `pnpm test:crm`, `pnpm test:crm-audit` | CRM + audit surfaces |
| SEO | `pnpm test:seo` | metadata, JSON-LD, sitemap, canonicals |
| API client / format | `pnpm test:api-client`, `pnpm test:format` | those utilities |
| Visual / browser E2E | `pnpm test:visual` | any public UI change |
| Build | `pnpm build` | schema changes, config changes, pre-PR |

Browser/E2E work uses the **Playwright MCP** to actually exercise workflows. `pnpm build` and
`prisma generate` prove compilation, never behavior.

### STEP 4 — FIX ALL MATERIAL DEFECTS

For each finding: **(1)** identify the root cause — not the symptom; **(2)** determine the blast
radius; **(3)** correct the root cause; **(4)** update affected implementation; **(5)** add or
improve regression coverage; **(6)** re-run the failed verification; **(7)** re-run materially
related verification.

Never bypass or weaken a test to obtain a pass. Never suppress an error instead of fixing it.
Never remove validation, authorization, or a security control to make a workflow succeed.

### STEP 5 — TEST THE ACTUAL USER WORKFLOW

Where the change affects user-facing or operational behavior, verify the **complete workflow**, not
isolated functions. The vehicle-acquisition path, mapped to the real modules:

```
buyer submits request        lib/services/vehicle-request/vehicle-request.service.ts
→ request persists           VehicleRequestStatus SUBMITTED → INTAKE → ACTIVE_SOURCING
→ acquisition intake         lib/services/acquisition/unified-buyer-intake.service.ts
→ inventory discovery        lib/services/inventory/orchestrator.ts (+ adapters/)
→ matches normalized         inventory-match / inventory-dedup / inventory-quality
→ vehicles scored            lib/services/acquisition/scoring.service.ts
→ dealer routing + outreach  lib/services/acquisition/post-intake-outreach.service.ts,
                             lib/services/dealer/, lib/services/auction/ (invitations)
→ dealer response → offer    lib/services/offer/offer.service.ts + offer-validation.service.ts
→ negotiation / revision     lib/services/offer/offer-revision.service.ts, junk-fee.service.ts
→ recommendations            lib/services/offer/best-price.service.ts,
                             lib/services/shortlist/shortlist.service.ts
→ buyer sees correct results buyer portal surfaces
→ buyer selection persists   Offer ACCEPTED
→ downstream transaction     lib/services/deal/ → DEAL_CREATED → …
```

Exercise, as applicable: happy path · failure path · empty state · invalid input · duplicate
request · retry · timeout · partial provider failure · stale data · authorization failure ·
concurrent processing · recovery/resumption. The buyer and dealer critical paths in
`autolenis-testing-quality-gates` must stay green.

### STEP 6 — INDEPENDENT SECOND REVIEW

After all known defects are fixed and tests pass, review the **final** implementation again as
though another engineer wrote it. **Do not rely on the first review's conclusions** — re-read the
code as it now stands, including your own fixes (a fix is new, unreviewed code).

Ask: Is the implementation actually correct? Did a fix introduce another defect? Is there existing
architecture that should have been reused instead? What edge cases are hidden? Are state
transitions valid against the real enums? Are database writes safe and transactional? Are retries
idempotent? Are authorization boundaries correct? Is sensitive data protected? Are failures
observable? Can the system recover? Does the frontend represent backend state truthfully? Does
this hold under realistic production load and concurrency?

Fix any newly discovered material issue — then return to Step 7.

### STEP 7 — REGRESSION VERIFICATION

Re-run the applicable verification suite after the second review. **A fix is not complete if it
repairs the requested feature while breaking another part of AutoLenis.** Explicitly verify
neighboring systems and shared dependencies (shared services, shared Prisma models, shared
components, shared adapters).

### STEP 8 — PRODUCTION-READINESS CHECK

Run the applicable governance passes before declaring completion:

- **Security** — `autolenis-auth-security-privacy` + the `security-review` capability for auth,
  PII, payments, webhooks, migrations, or AI-tool changes.
- **Architecture** — `autolenis-system-architecture`: no parallel system, no duplicated service,
  layering respected.
- **Testing** — `autolenis-testing-quality-gates`: the change's required matrix is met.
- **Data** — `autolenis-supabase-postgres`: migration, RLS, and rollback safety.
- **UI** — `impeccable` audit + `autolenis-accessibility-performance-seo` for frontend work.
- **Operations** — `autolenis-observability-sre`: failures are logged, alertable, recoverable.

The verdict is **evidence-based**. Allowed verdicts: **PASS** · **PASS WITH CONDITIONS** ·
**BLOCKED**.

### STEP 9 — EVIDENCE-BASED COMPLETION

Report only what verification actually supports. The completion report states:

- files changed
- root causes corrected
- tests executed / passed / failed
- failures corrected
- E2E workflows verified
- security checks performed
- second-review findings
- regression checks performed
- unresolved issues
- final production-readiness verdict

Anything not executable in this environment — missing credentials, unavailable external service,
no test infrastructure, environment limitation — is reported as **NOT VERIFIED**, naming exactly
what remains necessary to verify it. Silence is not a pass.

## Boundaries — do / never

**Do**
- Treat writing code as Step 1 of 9, and every fix as new unreviewed code.
- Review beyond the diff — callers, consumers, shared models, downstream workflows.
- Run the real commands and quote the real results.
- Fix root causes and add regression coverage that would have caught the defect.
- Re-review from scratch after fixing, then regression-test the final state.
- Say **NOT VERIFIED** and name the blocker when verification is impossible here.

**Never**
- Declare "done", "works", or "production ready" without executable evidence.
- Write "Everything is working" unless sufficient executable evidence supports it.
- Weaken, skip, delete, or `.skip()` a test to obtain a green result.
- Suppress, swallow, or `try/catch`-hide an error instead of fixing it.
- Remove validation, authorization, or a security control to make a flow pass.
- Blindly `--update-snapshots` to clear a visual failure.
- Stop at the first review, or trust the first review's conclusions in the second.
- Substitute reading the code for running the code.
- Report a suite as passing that you did not run.

## Best practices & examples

**Completion report skeleton**

```md
### Verification report
Files changed: <paths>
Root causes corrected: <cause → fix>
Executed: pnpm typecheck ✅ · pnpm lint ✅ · pnpm test ✅ (42/42) ·
          pnpm test:payments ❌→✅ (cents rounding, fixed) · pnpm test:visual ✅
E2E verified: buyer request → auction → offer → best price → deal (happy + declined + duplicate)
Security: authz tests on /api/buyer/*, webhook signature + replay verified
Second-review findings: 1 (unhandled null dealerId in ranking) — fixed, regression test added
Regression: pnpm test, pnpm test:security re-run green after fix
Unresolved / NOT VERIFIED: DocuSign sandbox unreachable (no DOCUSIGN_* creds) —
  needs a sandbox run of the e-sign callback before release
Verdict: PASS WITH CONDITIONS
```

**Root cause, not symptom**

```ts
// ✗ symptom patch — hides the defect, ships the bug
const otd = offer.otdCents ?? 0;            // NaN was crashing the ranking

// ✓ root cause — the adapter never normalized a missing fee block
const otd = normalizeOtdCents(offer);       // returns null; caller excludes + logs
if (otd === null) { logger.warn({ offerId: offer.id }, "offer missing OTD"); continue; }
```

## Acceptance criteria

- [ ] Two distinct reviews ran — the second re-read the final code, including the fixes.
- [ ] Every applicable command in the Step 3 matrix ran; results are quoted, not assumed.
- [ ] Every material defect was root-caused, fixed, and covered by a regression test.
- [ ] The affected user workflow was exercised end-to-end, including failure paths.
- [ ] Regression verification ran *after* the final fix and neighboring systems are green.
- [ ] No test, validation, authorization, or security control was weakened to obtain a pass.
- [ ] The report lists executed/passed/failed checks and an explicit verdict.
- [ ] Everything unverifiable here is labeled **NOT VERIFIED** with what it needs.

## Mechanical enforcement (this loop is not advisory)

The loop is enforced by hooks in `.claude/hooks/verification/`, wired in
`.claude/settings.json`. Prompts persuade; these block.

- **`track.mjs`** (PostToolUse on `Edit|Write|MultiEdit|NotebookEdit|Bash`) records every material
  `frontend/` file you touch and every verification command you run, classifying each run
  **pass / fail / unknown** from its real output. An interrupted run counts as a failure. Silence
  is never a pass.
- **`gate.mjs`** (Stop) blocks the end of the turn when material code changed and any required
  check is unrun or red, when your closing message claims completion while checks are missing or
  failing, or when there is no verdict (`PASS` / `PASS WITH CONDITIONS` / `BLOCKED` /
  `NOT VERIFIED`) in it. The block message names the exact commands still owed.
- State lives in `.claude/.verification-state/<session>.json` (gitignored).

**Safety rails** — a gate that traps the agent is worse than no gate: it never blocks when
`stop_hook_active` is set, never blocks more than `AUTOLENIS_VERIFICATION_MAX_BLOCKS` times
(default 2), and any internal error or unwritable state directory degrades to *allow*.
`AUTOLENIS_VERIFICATION_HOOK=off` disables it entirely; `AUTOLENIS_VERIFICATION_DEBUG=1` traces it.

The gate is a floor, not the loop. It can confirm that commands ran and a verdict exists; it
cannot confirm that you reviewed the surrounding code (Step 2), fixed root causes rather than
symptoms (Step 4), exercised the real workflow (Step 5), or genuinely re-reviewed from scratch
(Step 6). **Satisfying the hook is not satisfying this skill.** Never route around it by writing a
verdict you have not earned — that is the exact behavior this skill exists to prevent.

Tests: `node --test .claude/hooks/verification/__tests__/lib.test.mjs`.

## Cross-skill links

- `autolenis-system-architecture` — architectural damage check (Step 2, Step 8).
- `autolenis-testing-quality-gates` — the test matrix, critical paths, and merge gate (Step 3, 5).
- `autolenis-auth-security-privacy` + `security-review` — security review (Step 8).
- `autolenis-supabase-postgres` — migration / RLS / rollback validation (Step 8).
- `autolenis-observability-sre` — failure observability and recovery (Step 6, Step 8).
- `impeccable` + `autolenis-accessibility-performance-seo` — UI audit (Step 8).
- `/code-review` capability — line-level review (Step 2, Step 6).
- Playwright MCP — real browser/workflow execution (Step 3, Step 5).

> **Naming note.** Debugging, test-engineering, security-audit, self-review, production-readiness,
> and architecture-governance are *responsibilities of this loop plus the skills above*, not
> separate skills in this repo. Root-cause debugging is Step 4; test engineering is
> `autolenis-testing-quality-gates`; security audit is `autolenis-auth-security-privacy` +
> `security-review`; self-review is Step 6; production readiness is Step 8; architecture governance
> is `autolenis-system-architecture`. Do not create duplicate skills under those names.
