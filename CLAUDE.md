# CLAUDE.md — AutoLenis engineering operating system

This file is read first in every Claude Code session on this repository. It routes you to the
authoritative **project skills** in `.claude/skills/` and defines the mandatory development
pipeline. **Project skills override generic guidance** whenever an AutoLenis business rule,
architecture decision, or security boundary is involved.

## What AutoLenis is

A premium **automotive reverse-auction concierge platform**. Buyers submit a vehicle request;
vetted dealers compete in a ~48-hour reverse auction; the buyer picks the best offer, pays a **$99
refundable deposit** (buyers pay AutoLenis; dealers also pay AutoLenis — never buyer↔dealer direct),
and AutoLenis shepherds the deal through financing, insurance, **Contract Shield** review,
e-signature, payment, and pickup. Roles: **buyer, dealer, affiliate, admin**.

**Stack:** Next.js 16 App Router · React 19 · TypeScript (strict) · Prisma 5 · Supabase PostgreSQL ·
Vercel · Stripe · Twilio/ElevenLabs · Resend · DocuSign · MicroBilt · Groq/Anthropic/Gemini ·
Inngest/QStash · Sentry. **App root: `frontend/`.**

## Golden rules

1. **Extend the existing architecture — never build a parallel or duplicate system.** Read before write.
2. **Business logic lives in `frontend/lib/services/**`;** route handlers and components stay thin;
   no raw third-party SDK calls outside adapters.
3. **Server-side authorization always** — frontend role checks are UX only.
4. **Money is integer minor units; never trust client payment status; webhooks are verified + idempotent.**
5. **"TypeScript compiles" is never "done."** Ship only through the pipeline below.
6. **Writing the code is not finishing the work.** Every material change runs the
   review → fix → test → independent re-review loop (`autolenis-code-verification`) and ends with
   an evidence-based verdict. Never claim something works without executable evidence.

## Skill routing — load these before touching code

Always load `autolenis-system-architecture` first, then `autolenis-domain-model`, then the
domain skill(s) matching the task:

| If the work touches… | Load this project skill |
| --- | --- |
| Architecture, routing, services, jobs, config | `autolenis-system-architecture` |
| Entities, enums, status transitions, schema meaning | `autolenis-domain-model` |
| Buyer portal, prequal, vehicle request, deposit, insurance | `autolenis-buyer-journey` |
| Dealer portal, onboarding, vetting, isolation | `autolenis-dealer-marketplace` |
| Reverse auction, bids, offers, winner selection | `autolenis-auction-engine` |
| Best Price Report math & presentation | `autolenis-best-price-report` |
| Stripe, deposits, fees, commissions, ledger | `autolenis-payments-and-ledger` |
| Contract review, discrepancy scan, escalation | `autolenis-contract-shield` |
| Auth, RLS, PII, admin, MFA, secrets, OWASP | `autolenis-auth-security-privacy` |
| Prisma/Supabase schema, migrations, RLS, rollback | `autolenis-supabase-postgres` |
| App Router / RSC / Server Actions conventions | `autolenis-nextjs-react` |
| Third-party adapters (Twilio, Resend, DocuSign, MicroBilt…) | `autolenis-integrations` |
| SMS/email consent, A2P 10DLC, STOP/HELP, templates | `autolenis-communications-consent` |
| AI actions, guardrails, prompt-injection, kill switch | `autolenis-ai-safety-and-orchestration` |
| Test matrix, E2E paths, quality gates | `autolenis-testing-quality-gates` |
| **Verifying finished work** — review, fix, retest, re-review, sign-off | `autolenis-code-verification` (load last, always) |
| Logging, metrics, alerts, cron/job monitoring, runbooks | `autolenis-observability-sre` |
| Accessibility, Core Web Vitals, SEO | `autolenis-accessibility-performance-seo` |
| **Social media** orchestration, calendar, publishing, approvals, attribution | `autolenis-social-media-command-center` (load first) |
| Social strategy / content pillars / measurement | `autolenis-social-content-strategy` |
| Social content creation (scripts, hooks, captions, carousels) | `autolenis-social-content-creator` |
| Social content calendar / scheduling state | `autolenis-social-content-calendar` |
| Social API/browser publishing, tokens, retries, kill switch | `autolenis-social-publishing-and-scheduling` |
| Social comments/DMs, sentiment, lead-intent, escalation | `autolenis-social-engagement-management` |
| Social analytics, UTM attribution, ROI | `autolenis-social-analytics-and-attribution` |
| Content repurposing / derivatives / lineage | `autolenis-social-content-repurposing` |
| **Dealer prospecting** discovery→enrichment→ingestion pipeline | `autolenis-dealer-prospecting-orchestrator` (load first) |
| Dealership discovery (Places/Maps/Search, filters) | `autolenis-dealership-discovery` |
| YouTube dealership channel research | `autolenis-youtube-dealer-research` |
| Dealer decision-maker / staff discovery | `autolenis-dealer-decision-maker-discovery` |
| Public business-contact enrichment (Apollo/verify adapters) | `autolenis-public-business-contact-enrichment` |
| Contact verification + status machine | `autolenis-contact-verification` |
| Dealer dedup / entity resolution | `autolenis-dealer-deduplication-and-entity-resolution` |
| Dealer lead scoring (transparent, non-discriminatory) | `autolenis-dealer-lead-scoring` |
| Writing dealer/contact records to production (only path) | `autolenis-dealer-database-ingestion` |
| Human review of uncertain dealer records | `autolenis-dealer-prospect-review-queue` |
| Dealer outreach eligibility + consent governance | `autolenis-dealer-outreach-governance` |

> **Social & dealer-intelligence skills govern the EXISTING systems** (`lib/social/*`,
> `lib/services/acquisition/*`, `lib/services/dealer-recruitment/*`, and the AMIPS models). They
> orchestrate third-party capability providers (Buffer/BlackTwist/Apollo/Firecrawl/Sales-Do) as
> subordinates — those providers never write production records directly, and publishing/outreach
> stay disabled by default until reviewed and explicitly enabled.

**UI work** additionally uses the **Impeccable** skill (`.claude/skills/impeccable/`) as the UI/UX
quality reviewer, and the **Frontend Design** skill as the default implementation guide.
**Superpowers** (installed via `obra/superpowers-marketplace`, declared in `.claude/settings.json`)
provides the disciplined planning/TDD/review workflow.

## Mandatory development pipeline

1. Read this file (`CLAUDE.md`).
2. Load `autolenis-system-architecture`.
3. Load `autolenis-domain-model` + the relevant domain skill(s) above.
4. Invoke Superpowers planning (`brainstorming` → `writing-plans`) for non-trivial work.
5. Inspect the existing implementation (service, models, routes, tests) — **read before write**.
6. Produce an execution plan; confirm it extends (not replaces) existing systems.
7. Create or update tests first (`autolenis-testing-quality-gates`).
8. Implement inside the existing architecture.
9. `cd frontend && pnpm typecheck`
10. `pnpm lint`
11. `pnpm test` (+ the relevant `pnpm test:*` suites for the domain).
12. Browser E2E / visual tests where UI changed (`pnpm test:visual`, Playwright / Webapp Testing).
13. **Run the mandatory verification loop below (`autolenis-code-verification`) — steps 1–9.**
14. Open a **draft** Pull Request, attaching the verification report and verdict.

## Mandatory code review → fix → test → re-review loop

`autolenis-code-verification` is the terminal authority on completion. Load it at the end of every
material change and before writing any completion language ("done", "works", "fixed", "ready",
"production ready"). **No material implementation is complete immediately after code is written.**

Applies to every significant implementation, modification, bug fix, refactor, workflow change,
database change, API change, AI change, integration change, or frontend change.

**STEP 1 — IMPLEMENT.** Build inside the existing architecture using the skills above. Do not stop
after implementation.

**STEP 2 — FIRST CODE REVIEW.** Review the changed code *and all materially affected surrounding
code* — trace callers, dependencies, consumers, database relationships, workflows, and downstream
effects. Inspect for incorrect logic, incomplete implementation, regressions, broken imports, bad
types, invalid assumptions, duplicated functionality, architectural inconsistency, race conditions,
concurrency and state-management defects, transaction/database/RLS problems, authorization
weaknesses, security vulnerabilities, validation gaps, weak error handling, silent failures, API
contract violations, integration failures, accessibility and responsive regressions, performance
regressions, dead code, placeholders, TODOs, and mocks/stubs left in production paths.

**STEP 3 — RUN VERIFICATION.** Run every applicable executable check: typecheck, lint, unit,
integration, API, database, RLS/security, component, browser/E2E, workflow, regression, build,
accessibility. **Never claim something works because the code looks correct.**

**STEP 4 — FIX ALL MATERIAL DEFECTS.** Root-cause it, size the blast radius, fix the cause, update
affected code, add regression coverage, re-run the failed check and everything materially related.
Never weaken or bypass a test, suppress an error instead of fixing it, or remove validation or a
security control to make a workflow pass.

**STEP 5 — TEST THE ACTUAL USER WORKFLOW.** Verify the complete path end-to-end (e.g. buyer request
→ persistence → acquisition intake → inventory discovery → normalization → scoring → dealer routing
→ outreach → dealer response → offer normalization → negotiation → recommendations → buyer results
→ selection → downstream transaction), covering happy path, failure path, empty state, invalid
input, duplicate request, retry, timeout, partial provider failure, stale data, authorization
failure, concurrency, and recovery.

**STEP 6 — INDEPENDENT SECOND REVIEW.** Re-read the final implementation as though another engineer
wrote it. Do not rely on the first review's conclusions — your own fixes are new, unreviewed code.
Ask whether it is actually correct, whether a fix introduced a defect, whether existing architecture
should have been reused, and whether state transitions, database writes, retry idempotency, authz
boundaries, PII protection, observability, recovery, and frontend/backend state agreement hold under
realistic production conditions. Fix what you find.

**STEP 7 — REGRESSION VERIFICATION.** Re-run the applicable suites *after* the final fix. A fix that
repairs the feature while breaking another part of AutoLenis is not complete — check neighboring
systems and shared dependencies.

**STEP 8 — PRODUCTION-READINESS CHECK.** Run the security, testing, architecture, data/RLS,
UI, and observability passes. Verdict is evidence-based: **PASS** · **PASS WITH CONDITIONS** ·
**BLOCKED**.

**STEP 9 — EVIDENCE-BASED COMPLETION.** Report files changed, root causes corrected, tests executed
/ passed / failed, failures corrected, E2E workflows verified, security checks performed,
second-review findings, regression checks, unresolved issues, and the final verdict. Never write
"Everything is working" without executable evidence. Anything blocked by missing credentials,
unavailable services, environment limits, or missing test infrastructure is reported as
**NOT VERIFIED**, naming exactly what is needed to verify it.

> The loop is iterative: PLAN → IMPLEMENT → REVIEW → TEST → FIND DEFECTS → FIX → RETEST →
> INDEPENDENT RE-REVIEW → FIND REMAINING DEFECTS → FIX → REGRESSION TEST → E2E VERIFY →
> SECURITY REVIEW → PRODUCTION-READINESS REVIEW → COMPLETE. Any material defect found late sends
> you back to the appropriate earlier stage. **The process ends when the implementation is
> verified — not when the code has been written.**

**This loop is enforced mechanically.** `.claude/hooks/verification/` tracks which material
`frontend/` files a session changed and which verification commands actually ran (with pass/fail
parsed from real output), and a `Stop` hook blocks the end of the turn while required checks are
unrun or red, or while the closing message lacks a verdict. It never blocks more than twice and
degrades to *allow* on any internal error; `AUTOLENIS_VERIFICATION_HOOK=off` disables it. The gate
is a floor — it cannot see whether you truly re-reviewed or tested the workflow, so satisfying the
hook is not satisfying the loop.

## Commands (run from `frontend/`)

```
pnpm dev            # local dev on :3000
pnpm typecheck      # tsc --noEmit
pnpm lint           # eslint
pnpm test           # core service unit tests
pnpm test:payments  # payments suite (see package.json for the full test:* matrix)
pnpm test:security  # security suite
pnpm test:webhooks  # webhook suite
pnpm test:visual    # Playwright visual/E2E
pnpm build          # prisma generate && next build
```

## MCP & tooling

Project MCP servers are declared in `.mcp.json` and enabled in `.claude/settings.json`
(filesystem, memory, sequential-thinking, playwright, buffer, context7). Platform/connector MCPs
available in hosted sessions include GitHub, Supabase, Vercel, Twilio, DocuSign, Gmail, Google
Calendar/Drive. See `.claude/MCP_INVENTORY.md` for the full inventory, provenance, and
least-privilege rules (production DB / payments / messaging default to read-only or explicit approval).

## Do not

- Add skill tooling to `frontend/package.json` — skills are Claude config, not app dependencies.
- Install unverified "mega skill packs," skills that auto-run shell commands or auto-install deps,
  or duplicate architecture skills.
- Expose environment variables or service-role keys to the client.
- Declare work complete, working, or production ready without executable evidence — or weaken a
  test, suppress an error, or remove a validation/security control to obtain a passing result.
