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

## CRITICAL ENVIRONMENT BOUNDARY — read before anything else

**There is NO legitimate non-production authenticated environment.** Branch previews share the
**PRODUCTION** Supabase project and have no isolated branch database.

Therefore you MUST NOT:

- create accounts or seed test users;
- mutate production-backed records;
- run authenticated end-to-end tests that write;
- process payments or send real communications;
- use production credentials to manufacture a test environment.

The absence of an E2E environment is **not** permission to provision infrastructure, create a
database, or alter or weaken authentication. When authenticated browser verification cannot be done
legitimately, report the behavior as **NOT VERIFIED**. Fabricating a verification result is the
worst possible outcome here — worse than an unfinished batch, and worse than saying "I could not
check this."

## Working method — phased batches with a hard owner gate

Work arrives as batches:

**Phase 1** repository-first audit (`/investigate`) → **Phase 2** workflow/UX design (`/plan`) →
**HARD STOP for explicit owner approval** → **Phase 3** implement, review, verify (`/verify`,
`/review`).

**A request to improve a surface is NOT advance authorization to implement.** Owner approval of the
Phase 2 proposal is the implementation gate. Do not begin Phase 3 without it, and do not treat
silence, enthusiasm, or a follow-up question as approval. `/investigate`, `/plan` and `/review`
have `disallowed-tools: Edit, Write, NotebookEdit` in their frontmatter, so the gate is mechanical
for the turn that invokes them, not merely remembered.

This gate is in addition to, not instead of, the `autolenis-code-verification` loop below.

## Capability-preservation invariant

**Simplification is not feature removal.** A capability may be moved, regrouped, or made
progressive — it may never silently disappear.

Any batch that touches routes, controls, actions, or workflows must produce a **before → after
capability map** accounting for every one of them, each with a disposition: **KEPT · MOVED ·
REGROUPED · PROGRESSIVE · RENAMED · REMOVED**. `REMOVED` requires explicit owner sign-off. The
counts must reconcile; if they do not, the map is wrong.

## Information architecture (preserve it)

Established Content IA: Growth → `/admin/content` (primary rail destination),
`/admin/content/bulk` and `/admin/content/attribution` (related hubs), `/admin/content/[id]`
(detail drill-down). No competing navigation system, no second sidebar, no independent page chrome.

## Protected paths & forbidden actions

**Also enforced mechanically** — see `.claude/OPERATING_SYSTEM.md` for what each layer does and
what it cannot do.

- **Branch only.** No merging, deploying, production changes, migrations, or server-authorization
  changes without separate explicit authorization.
- **Never edit an existing file** in `frontend/prisma/migrations/**` or `frontend/migrations/**`
  (and `supabase/migrations/**` if one is ever added) — it may already be applied to production,
  and CI replays the whole chain against an empty database. Adding a **new** migration is normal
  work and is not blocked; applying one is not yours to do.
- **Never read or edit `.env*`.** Environment values are owner-managed in Vercel. The variable
  *names* the build needs are listed in `.github/workflows/ci.yml`.
- **Never run:** `rm -rf`, `drop database`, `git push --force`, `git reset --hard`, `git merge`,
  `supabase db push` / `db reset`, `prisma migrate deploy` / `reset` / `db push`, `vercel deploy`
  or anything `--prod`.
- Anything that looks obsolete, duplicated, unfinished, misleading, or dead gets **REPORTED for an
  owner decision — never deleted.**

## Known security finding — report, do not remediate here

`GET /api/admin/content/attribution/export`
(`frontend/app/api/admin/content/attribution/export/route.ts`) exports CSV containing **buyer
email** and is gated only by `requireAdmin()` — any authenticated admin role, with no dedicated
role gate on this route specifically. The UI discloses the exposure rather than preventing it
(`frontend/app/admin/content/attribution/page.tsx`).

Authorization changes there require a **separately authorized security batch**. Do not change its
server authorization, and do not silently hide or remove the capability. The PreToolUse path guard
blocks edits to that route file so it cannot be "fixed in passing"; a separately authorized batch
runs with `AUTOLENIS_GUARD=off` or removes that rule as part of the batch.

## Golden rules

1. **Extend the existing architecture — never build a parallel or duplicate system.** Read before write.
2. **Business logic lives in `frontend/lib/services/**`;** route handlers and components stay thin;
   no raw third-party SDK calls outside adapters.
3. **Server-side authorization always** — frontend role checks are UX only.
4. **Money is integer minor units; never trust client payment status; webhooks are verified + idempotent.**
5. **"TypeScript compiles" is never "done."** Ship only through the pipeline below.
6. **Claim only what you ran.** A check is "passed" only if it executed in this session and you saw
   the output. Say what you skipped and why. Finish with an explicit verdict
   (`autolenis-production-readiness`).
7. **Writing the code is not finishing the work.** Every material change runs the
   review → fix → test → independent re-review loop (`autolenis-code-verification`) — two distinct
   reviews, not one — before any completion language is written.

## Skill routing — load these before touching code

Always load `autolenis-system-architecture` first, then `autolenis-domain-model`, then the
domain skill(s) matching the task:

| If the work touches… | Load this project skill |
| --- | --- |
| Architecture, routing, services, jobs, config | `autolenis-system-architecture` |
| **Before creating anything new** (service/table/route/component/job) | `autolenis-system-architecture` → `reference/capability-index.md` |
| Entities, enums, status transitions, schema meaning | `autolenis-domain-model` |
| Buyer portal, prequal, vehicle request, deposit, insurance | `autolenis-buyer-journey` |
| Deal after offer acceptance: financing, fee, e-sign, pickup, delivery | `autolenis-deal-lifecycle` |
| Dealer portal, onboarding, vetting, isolation | `autolenis-dealer-marketplace` |
| Reverse auction, bids, offers, winner selection | `autolenis-auction-engine` |
| Best Price Report math & presentation | `autolenis-best-price-report` |
| Inventory feeds, VIN, dedup, lanes, staleness, vehicle matching | `autolenis-inventory-intelligence` |
| Stripe, deposits, fees, commissions, ledger | `autolenis-payments-and-ledger` |
| Contract review, discrepancy scan, escalation | `autolenis-contract-shield` |
| Auth, RLS, PII, admin, MFA, secrets, OWASP | `autolenis-auth-security-privacy` |
| Prisma/Supabase schema, migrations, RLS, rollback | `autolenis-supabase-postgres` |
| App Router / RSC / Server Actions conventions | `autolenis-nextjs-react` |
| Design tokens, brand palette, component kit, theming | `autolenis-ui-design-system` |
| Third-party adapters (Twilio, Resend, DocuSign, MicroBilt…) | `autolenis-integrations` |
| SMS/email consent, A2P 10DLC, STOP/HELP, templates | `autolenis-communications-consent` |
| AI actions, guardrails, prompt-injection, kill switch | `autolenis-ai-safety-and-orchestration` |
| Test matrix, E2E paths, quality gates | `autolenis-testing-quality-gates` |
| Anything broken, failing, flaky, stuck, or an incident | `autolenis-debugging` |
| **Finishing work** — the review → fix → retest → re-review loop | `autolenis-code-verification` (load last, always) |
| "Is this done / ready to ship?" — the completion gate | `autolenis-production-readiness` |
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

**UI work** additionally uses the **Impeccable** skill (`.claude/skills/impeccable/`, vendored and
version-controlled here) as the UI/UX quality reviewer, and `autolenis-ui-design-system` as the
token/component source of truth.

**Availability caveat — verify before you rely on it.** Skills outside `.claude/skills/` are
environment-provided and are **not guaranteed to be present in a given session**. The
`superpowers` plugin is now **vendored** into the repo as a local marketplace
(`.claude/plugins/superpowers-marketplace/`, see its `VENDORING.md`) and enabled in
`.claude/settings.json`. The hosted Claude Code runtime does **not** activate project-scoped
plugin marketplaces, so the plugin form loads only in a **local** (non-hosted) CLI; to make the
additive superpowers techniques usable in the **hosted** runtime they are also mirrored as plain
project skills under `.claude/skills/` (the `superpowers-*` skills — brainstorming, writing-plans,
executing-plans, using-git-worktrees, dispatching-parallel-agents, writing-skills,
finishing-a-development-branch). The superpowers skills that would duplicate AutoLenis architecture
skills (`systematic-debugging`, `test-driven-development`, `verification-before-completion`,
`requesting-`/`receiving-code-review`, `subagent-driven-development`, `using-superpowers`) are
deliberately **not** mirrored, per the "no duplicate architecture skills" rule. Never treat an
unavailable capability as a completed pipeline step — the repo-local `.claude/skills/autolenis-*`
skills are the only guaranteed-present guidance, and step 4 below stands on its own without any
plugin.

## Continuous skill observation (Task Observer)

At the start of any task-oriented session — any interaction where you will use tools and produce
deliverables — invoke the `task-observer` skill before beginning work. This ensures skill
improvement opportunities (user corrections, workflow gaps, new/improved-skill candidates) are
captured throughout the session into the observation log.

When loading any skill, check the observation log for OPEN observations relevant to it. Load
`task-observer` independently from configuration — never chain its activation through another
skill; a broken chain silences all observation activity. Task Observer logs and defers by default:
it does not modify existing skills automatically.

## Mandatory development pipeline

1. Read this file (`CLAUDE.md`).
2. Load `autolenis-system-architecture`.
3. Load `autolenis-domain-model` + the relevant domain skill(s) above.
4. **Plan before coding** on non-trivial work: run the reuse-before-create protocol
   (`autolenis-system-architecture` → `reference/capability-index.md`) and write down the owning
   service, models touched, state transitions affected, tests that will prove it, and the rollback.
5. Inspect the existing implementation (service, models, routes, tests) — **read before write**.
6. Confirm the plan extends (not replaces) existing systems; say what you searched for if you are
   adding something genuinely new.
7. Create or update tests first (`autolenis-testing-quality-gates`).
8. Implement inside the existing architecture.
9. `cd frontend && pnpm typecheck`
10. `pnpm lint`
11. `pnpm test:all` — the **full** matrix (26 suites). `pnpm test` alone covers ~a third of it.
12. Browser E2E / visual tests where UI changed (`pnpm test:visual`, Playwright).
13. Impeccable audit for UI work.
14. `/code-review`.
15. `/security-review` for auth / PII / payments / webhooks / migrations / AI-tool changes.
16. Validate migrations, RLS, and rollback safety (`autolenis-supabase-postgres`).
17. `autolenis-production-readiness` → explicit **PASS / PASS WITH CONDITIONS / BLOCKED**.
18. Open a **draft** Pull Request, attaching the verification report and verdict.

> Steps 12–17 are not a checklist you walk once. They run inside the loop below
> (`autolenis-code-verification`), which repeats them after every fix and adds a second,
> independent review of the final code.

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

**STEP 3 — RUN VERIFICATION.** Run every applicable executable check: `pnpm typecheck`, `pnpm lint`,
`pnpm test:coverage-check`, `pnpm test:all` (the full 26-suite matrix — `pnpm test` alone is ~a
third of it), plus browser/E2E, build, and accessibility where they apply.
**Never claim something works because the code looks correct.**

**STEP 4 — FIX ALL MATERIAL DEFECTS.** Follow `autolenis-debugging`: reproduce, trace the real
execution path, name the root cause, size the blast radius, fix at the cause, prove it with a
failing-first regression test, re-run the failed check and everything materially related. Never
weaken or bypass a test, suppress an error instead of fixing it, or remove validation or a security
control to make a workflow pass.

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

**STEP 8 — PRODUCTION-READINESS CHECK.** Hand off to `autolenis-production-readiness` — its six
review lenses and conditional check table are the gate. Verdict is evidence-based:
**PASS** · **PASS WITH CONDITIONS** · **BLOCKED**.

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

## Investigation-before-implementation contract

Before writing code:

1. Restate the objective in one sentence.
2. Trace the request end-to-end and name the exact files and functions involved.
3. Produce an **evidence table** for the material claims.
4. State what you will reuse vs create, and what must be preserved.

Evidence, proportional to consequence. Cite `file:line` for: architecture conclusions, security and
authorization boundaries, database and RLS behavior, API contracts, business-workflow behavior, and
existing functionality being changed. Routine narration needs no citation. **No material
implementation decision may rest on an unverified assumption about this repository.**

## Resolving ambiguity — do not over-ask

Resolve low-risk ambiguity from repository evidence and existing conventions; state the assumption
and proceed. Stop and ask when it materially changes business behavior, security, data integrity,
architecture, or scope. The Phase 2 owner gate is a separate, always-required stop — it is not an
ambiguity question, and answering an ambiguity question is not passing the gate.

## Control plane — you are not the final authority

You can inspect, test, review, and produce evidence. You do not decide whether you succeeded, and
you never decide that a batch is approved. Owner approval, CI, branch protection, and RLS are the
real controls.

## Definition of done — three-bucket verification

- The stated requirement is satisfied, the owner gate was respected, and no capability was silently
  removed.
- Typecheck / lint / tests / build clean, **with output shown**.
- Verification reported in three buckets:
  - **CODE-VERIFIED** — proven by tests, typecheck, lint, or build; output shown.
  - **BROWSER-VERIFIED** — proven in a browser; **read-only, unauthenticated/public paths only** on
    this repository.
  - **NOT VERIFIED** — stated plainly, with the reason and exactly what would be needed.

For authenticated write paths, **NOT VERIFIED is the correct and expected answer**, not a failure.

## Commands (run from `frontend/`)

The package manager is **pnpm 10.33.0**, pinned by `frontend/package.json` `packageManager` and
`frontend/pnpm-lock.yaml`. Do not substitute npm or yarn — a stale yarn-based
`frontend/.github/workflows/ci.yml` exists but is dead config (GitHub only reads the workflows at
the repository root).

```
pnpm dev                  # next dev --port 3000
pnpm typecheck            # tsc --noEmit
pnpm lint                 # eslint . --ext .ts,.tsx
pnpm test                 # core service unit tests — a SUBSET, not the gate
pnpm test:all             # FULL matrix — 65 test:* invocations; THIS is the gate
pnpm test:coverage-check  # fails if any *.test.ts is unreachable from a test:* script
pnpm test:payments        # payments suite (see package.json for all 72 test:* scripts)
pnpm test:security        # security suite
pnpm test:webhooks        # webhook suite
pnpm test:visual          # Playwright visual regression
pnpm test:e2e             # Playwright E2E
pnpm build                # prisma generate && next build
```

The unit harness is **`node:test` run through `tsx`** (`tsx --test`), with Playwright for
visual/E2E. There is no Jest and no Vitest in this repository — confirm the harness before writing
any test, and never invent one.

CI (`.github/workflows/ci.yml`) runs four jobs: **ci** (typecheck → lint → `test:coverage-check` →
`test:all` → build), **migrations** (the full Prisma chain plus the 15 numbered SQL files against
an empty Postgres, applied twice to prove idempotency, then a drift check), **E2E (dealer
outreach)** (Playwright against a real server and migrated database), and **dependency-audit**
(blocks on **critical** advisories, reports **high**).

## Slash commands — the working loop

| Command | Phase | Writes code? |
| --- | --- | --- |
| `/investigate <surface>` | 1 — read-only audit: evidence table + capability inventory | No — Edit/Write removed |
| `/plan <objective>` | 2 — proposal with the before → after capability map | No — stops at the owner gate |
| *(owner approves explicitly)* | the gate | — |
| `/verify` | 3 — run the gates, report in three buckets | Yes |
| `/review` | 3 — adversarial diff review from a fresh context | No — findings only |
| `/autolenis-verify` | the same executable gate, with the readiness verdict | Yes |
| `/prompt-for-claude-code` | turns a rough request into a complete implementation prompt | No |

`/review` dispatches the `adversarial-diff-reviewer` subagent so the diff is read by a clean
context rather than by the author's memory. The prompt template it fills lives at
`docs/claude/implementation-prompt-template.md`.

## MCP & tooling

Project MCP servers are declared in `.mcp.json` and enabled in `.claude/settings.json`
(filesystem, memory, sequential-thinking, playwright, buffer, context7). `buffer` and `context7`
need interactive OAuth / an API key and are **unavailable in non-interactive sessions** — treat
them as optional, never as a dependency of a workflow. Platform/connector MCPs available in hosted
sessions include GitHub, Supabase, Vercel, Twilio, DocuSign, Gmail, Google Calendar/Drive. See
`.claude/MCP_INVENTORY.md` for the full inventory, provenance, and least-privilege rules
(production DB / payments / messaging default to read-only or explicit approval).

## Source-of-truth hierarchy

When two artifacts disagree, the higher rank wins:

1. **Running code + the Prisma schema** — what the system actually does.
2. **`.claude/skills/autolenis-*`** — the curated interpretation of that code.
3. **This file** — the constitution and the routing table.
4. **`docs/**` specs** — intent, sometimes ahead of or behind the code.
5. **Root `*_AUDIT*.md` / `design_guidelines.json`** — point-in-time snapshots; may be stale.
   `design_guidelines.json` in particular describes an unimplemented dark theme and must not be
   followed (see `autolenis-ui-design-system`).

## Do not

- Add skill tooling to `frontend/package.json` — skills are Claude config, not app dependencies.
- Install unverified "mega skill packs," skills that auto-run shell commands or auto-install deps,
  or duplicate architecture skills.
- Expose environment variables or service-role keys to the client.
- Claim a command passed, a suite is green, or a capability exists without evidence from this
  session.
- Weaken a test, widen a `catch`, or disable a security control to reach green
  (`autolenis-debugging`).
- Treat the absence of a test environment as licence to provision one, seed users, or weaken
  authentication — report **NOT VERIFIED** instead.
- Begin implementation because a surface was criticised. Phase 2 approval is the gate.
- Edit an existing migration, read or edit `.env*`, or "fix in passing" the
  `content/attribution/export` authorization.
- Declare work complete, working, or production ready after a single review pass — the second,
  independent review is not optional (`autolenis-code-verification`).
