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
6. **Claim only what you ran.** A check is "passed" only if it executed in this session and you saw
   the output. Say what you skipped and why. Finish with an explicit verdict
   (`autolenis-production-readiness`).

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
`superpowers` plugin is declared in `.claude/settings.json` but resolves only where that
marketplace is installed; as of the 2026-08 audit it was **absent** in the hosted Claude Code
environment. Never treat an unavailable capability as a completed pipeline step — the repo-local
`.claude/skills/autolenis-*` skills are the only guaranteed-present guidance, and step 4 below
stands on its own without any plugin.

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
11. `pnpm test:all` — the **full** matrix (18 suites). `pnpm test` alone covers ~a third of it.
12. Browser E2E / visual tests where UI changed (`pnpm test:visual`, Playwright).
13. Impeccable audit for UI work.
14. `/code-review`.
15. `/security-review` for auth / PII / payments / webhooks / migrations / AI-tool changes.
16. Validate migrations, RLS, and rollback safety (`autolenis-supabase-postgres`).
17. `autolenis-production-readiness` → explicit **PASS / PASS WITH CONDITIONS / BLOCKED**.
18. Open a **draft** Pull Request.

## Commands (run from `frontend/`)

```
pnpm dev                  # local dev on :3000
pnpm typecheck            # tsc --noEmit
pnpm lint                 # eslint
pnpm test                 # core service unit tests (subset)
pnpm test:all             # FULL matrix — all 18 test:* suites; this is the gate
pnpm test:coverage-check  # fails if any *.test.ts is unreachable from a test:* script
pnpm test:payments        # payments suite (see package.json for the full test:* matrix)
pnpm test:security        # security suite
pnpm test:webhooks        # webhook suite
pnpm test:visual          # Playwright visual/E2E
pnpm build                # prisma generate && next build
```

CI (`.github/workflows/ci.yml`) runs typecheck → lint → `test:coverage-check` → `test:all` →
build, plus a dependency-audit job that blocks on **critical** advisories and reports **high** ones.

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
