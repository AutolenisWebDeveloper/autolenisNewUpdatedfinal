# AutoLenis — Development Skill Stack: Installation & Validation Report

**Project:** AutoLenis (`autolenisNewUpdatedfinal`)
**Date:** 2026-07-22
**Branch:** `claude/autolenis-skill-stack-setup-ufiwc9`
**Scope:** Turn the repo into a production-grade Claude Code engineering environment — audit,
install/configure the appropriate skill stack, author AutoLenis project skills, wire the
development pipeline, and validate. **No application code was modified.**

---

## 0. Executive summary

The strongest setup for AutoLenis is **not** a large collection of generic community skills. It is:
a small trusted set of official development plugins, Superpowers for disciplined execution,
Frontend Design + Impeccable for UI quality, and **repository-specific `autolenis-*` skills that
encode the real business workflows, architecture, security boundaries, and acceptance criteria.**

What this change delivers, durably in the repo:

- **`CLAUDE.md`** (new) — the engineering operating system: golden rules, skill routing table, and
  the 17-step mandatory development pipeline.
- **17 authoritative `autolenis-*` project skills** under `.claude/skills/`, each grounded in the
  real Prisma schema, service layer, routes, and integrations (not generic boilerplate).
- **`.claude/MCP_INVENTORY.md`** (new) — full MCP inventory + least-privilege policy.
- Updated **`.claude/README.md`** documenting the new skill layer.
- Verified the **pre-existing** Impeccable skill, Superpowers plugin, and `.mcp.json` config, and
  integrated them into the pipeline.

### Honest scope boundary (what is and isn't persistable)

Claude **skills and plugins installed at runtime** live in the ephemeral session container
(`/mnt/skills`, `~/.claude/plugins`, `~/.claude/skills`) — they are **not** git-tracked and cannot
be "installed into the repo." Interactive `/plugin install` and OAuth flows **cannot run in this
non-interactive session.** Therefore this report distinguishes:

- ✅ **Persisted in-repo** — files committed here (CLAUDE.md, the 17 skills, MCP inventory, settings).
- 🔧 **Operator action** — one-time interactive steps an engineer runs once (plugin installs, MCP
  OAuth). Exact commands are given in §6 so they are reproducible and unambiguous.

---

## 1. Audit — starting state (verified)

| Area | Finding |
| --- | --- |
| `CLAUDE.md` | ❌ Absent at repo root (gap — the pipeline requires it). **→ created.** |
| `.claude/settings.json` | ✅ Impeccable `PostToolUse` hook; Superpowers plugin declared via `obra/superpowers-marketplace`; 6 MCP servers enabled. |
| `.claude/skills/impeccable/` | ✅ Full Impeccable plugin v3.9.1 vendored (SKILL.md + 32 references + scripts). |
| `.claude/agents/` | ✅ `impeccable-manual-edit-applier`. |
| `.claude/skills/autolenis-*` | ❌ None present. **→ 17 created.** |
| `.mcp.json` | ✅ filesystem, memory, sequential-thinking, playwright, buffer, context7. |
| `package.json` | `frontend/` = Next 16.2.9, React 19, Prisma 5, pnpm; rich `test:*` matrix + `test:visual` (Playwright). |
| Prior audit | `SKILLS_DEPENDENCY_AUDIT_2026-07.md` (skills-vs-app-deps category correction) — still valid; this report supersedes its skill-inventory section. |
| User-level skills | `autolenis-master`, `autolenis-tier-1`, `mcp-builder`, `skill-creator`, `frontend-design` present in the session (ephemeral, not in repo). |

---

## 2. Plugin / official-skill inventory

| Plugin / skill | Role in AutoLenis | State | Source of truth |
| --- | --- | --- | --- |
| **Superpowers** | Planning / TDD / debugging / review discipline | ✅ Declared in `.claude/settings.json` (`superpowers@superpowers-marketplace`); re-fetches on fresh containers | `obra/superpowers-marketplace` |
| **Impeccable** | Default UI/UX quality reviewer | ✅ Vendored in `.claude/skills/impeccable/`; `PostToolUse` hook active | v3.9.1 (GitHub source) |
| **Frontend Design** | Default frontend implementation guide | ✅ Present in session (`/mnt/skills/public/frontend-design`); referenced by `autolenis-nextjs-react` + CLAUDE.md | Anthropic skill |
| **Skill Creator** | Create/validate AutoLenis skills | ✅ Present in session (`~/.claude/skills/skill-creator`) | Anthropic example-skills |
| **MCP Builder** | Build/maintain MCP integrations | ✅ Present in session (`~/.claude/skills/mcp-builder`) | Anthropic example-skills |
| **Webapp Testing** | Playwright E2E | 🔧 Use session Playwright MCP + `pnpm test:visual`; install example-skills bundle for the guided skill (§6) | Anthropic example-skills |
| **Code Review** | Default pre-PR review | 🔧 `/code-review` available via the built-in review skill; run before every PR | Anthropic |
| **PR Review Toolkit** | Specialized review agents | 🔧 Operator install (§6) | Anthropic |
| **Security Guidance** | Secure-coding hook during edits | 🔧 Operator install (§6) | Anthropic |
| **Security Review** | Release-gate security review | ✅ Built-in `/security-review` skill available; wired as a pipeline gate | Anthropic |
| **Claude API skill** | Anthropic SDK grounding (AutoLenis uses Claude Haiku + `ANTHROPIC_API_KEY`) | ✅ Present in session (`claude-api` skill); load for AI/SDK work | Anthropic |

> **Marketplace-name correction (carried from the prior audit, re-verified):**
> `claude-plugins-official` is **not** a configured marketplace and Superpowers is not in an
> Anthropic catalog — its real home is `obra/superpowers-marketplace`. Use the commands in §6,
> not `@claude-plugins-official`.

---

## 3. Project-skill inventory — 17 authoritative `autolenis-*` skills ✅

All under `.claude/skills/`, each with YAML frontmatter (`name` == directory), the 9-section
structure (Purpose & Authority · Activation · Architecture & key files · Core rules · Workflows ·
Boundaries · Best practices · Acceptance criteria · Cross-skill links), and grounded in verified
code.

| # | Skill | Lines | Grounded in (verified) |
| - | --- | --- | --- |
| 1 | `autolenis-system-architecture` | 175 | portals, `lib/services/**`, `lib/prisma.ts`, `proxy.ts`, Inngest/QStash |
| 2 | `autolenis-domain-model` | 149 | `prisma/schema.prisma` (~200 models), all canonical enums |
| 3 | `autolenis-buyer-journey` | 217 | `services/buyer/journey.ts`, `nav-gating.ts`, `prequal`, `vehicle-request`, `insurance`, `nudge` |
| 4 | `autolenis-dealer-marketplace` | 214 | `services/dealer`, `dealer-recruitment`, `agreement`; dealer-isolation routes |
| 5 | `autolenis-auction-engine` | 234 | `services/auction`, `services/offer`, `Offer` model, select-offer route, race guards |
| 6 | `autolenis-best-price-report` | 186 | `offer/best-price.service.ts` (weights 0.4/0.25/0.2/0.15), `junk-fee.service.ts` |
| 7 | `autolenis-payments-and-ledger` | 226 | `lib/stripe.ts`, `payments/`, `services/deposit|payment`, Stripe webhook + dedup |
| 8 | `autolenis-contract-shield` | 217 | `services/contract-shield`, `ContractScanRuleType`, PASS/WARNING/FAIL thresholds |
| 9 | `autolenis-auth-security-privacy` | 230 | `lib/security`, `admin-auth.ts`, `dealer-auth.ts`, `proxy.ts`, MFA/CSRF/rate-limit |
| 10 | `autolenis-supabase-postgres` | 204 | `schema.prisma`, `prisma/migrations`, RLS migration, idempotency tables |
| 11 | `autolenis-nextjs-react` | 219 | route groups, `next.config.mjs`, `proxy.ts`, RSC/Server-Action rules |
| 12 | `autolenis-integrations` | 219 | typed adapters: Stripe, DocuSign, MicroBilt, Groq, Twilio, QStash, Inngest |
| 13 | `autolenis-communications-consent` | 212 | `sms/`, `email/`, `suppression.service.ts`, Twilio STOP/START/HELP webhooks |
| 14 | `autolenis-ai-safety-and-orchestration` | 206 | `lib/ai/groq-client.ts`, `kill-switch.ts`, Zura agents, `AI_KILL_SWITCH` |
| 15 | `autolenis-testing-quality-gates` | 216 | `package.json` `test:*`, `playwright.visual.config.ts`, buyer/dealer E2E paths |
| 16 | `autolenis-observability-sre` | 210 | `logger.ts`, `observability/`, `monitoring/`, Sentry, cron/DLQ |
| 17 | `autolenis-accessibility-performance-seo` | 200 | `lib/seo/`, `sitemap*.xml`, `robots.ts`, WCAG 2.2 AA, CWV, noindex boundary |

**Consistency note resolved:** the reverse-auction competing offer is the **`Offer`** model (table
`offers`) — distinct from `DealerOfferSubmission`/`VehicleOffer` (concierge track). The
domain-model and auction-engine skills both state this so they never conflate the two.

---

## 4. MCP inventory (summary — full detail in `.claude/MCP_INVENTORY.md`)

- **Project-declared & active:** `filesystem`, `memory`, `sequential-thinking`, `playwright`.
- **Project-declared, needs auth:** `buffer` (OAuth), `context7` (`CONTEXT7_API_KEY`) — documentation lookup.
- **Platform/connector (hosted sessions):** GitHub, Supabase/PostgreSQL, Vercel, Twilio, DocuSign,
  Gmail, Google Calendar, Google Drive — **not** re-declared in `.mcp.json` to avoid duplicates.
- **Real integrations without MCP (use app adapters):** Stripe, Resend, MicroBilt/iPredict,
  MarketCheck, Groq/Anthropic/Gemini, Higgsfield, GHL, Make, Sentry.
- **Least privilege:** production DB / payments / messaging default to read-only or approval-gated writes.

No unsupported or invented MCP servers were added.

---

## 5. Configuration summary

| File | Change |
| --- | --- |
| `CLAUDE.md` | **New.** Golden rules, skill-routing table, 17-step pipeline, commands, MCP pointer. |
| `.claude/skills/autolenis-*/SKILL.md` | **New (17).** Authoritative domain skills. |
| `.claude/MCP_INVENTORY.md` | **New.** MCP inventory + least-privilege policy. |
| `.claude/README.md` | Updated to document the project-skill layer and user-level-skill relationship. |
| `.claude/settings.json` | Unchanged — already correct (Impeccable hook, Superpowers plugin, MCP enablement). |
| `.mcp.json` | Unchanged — already correct and curated. |
| `frontend/**` | **Untouched.** No application code modified. |

**Auto-preference of project skills over generic guidance** is achieved by (a) `CLAUDE.md` being
read first with an explicit routing table and "override generic guidance" instruction, and (b) each
skill's `description` frontmatter carrying precise activation triggers so the right skill loads
automatically.

---

## 6. Operator actions (one-time, interactive session) 🔧

Run once in an interactive Claude Code session on this repo (non-interactive sessions cannot do
plugin installs or OAuth):

```bash
# Superpowers marketplace + plugin (already declared in settings.json; this makes it explicit)
claude plugin marketplace add obra/superpowers-marketplace
claude plugin install superpowers@superpowers-marketplace

# Anthropic example-skills bundle: Webapp Testing, Skill Creator, MCP Builder, Claude API
claude plugin marketplace add anthropics/skills
claude plugin install example-skills@anthropic-agent-skills

# Review / security plugins (install the ones your org publishes in its marketplace)
# code-review, pr-review-toolkit, security-guidance  → install from the Anthropic marketplace
```

MCP auth (interactive): authorize `buffer` and `context7` via `/mcp` or claude.ai connector
settings; set `CONTEXT7_API_KEY` in the environment.

Then use the built-in skills already available in-session: `/code-review`, `/security-review`,
Impeccable's `/audit`·`/polish`·`/critique`, and the `frontend-design`, `skill-creator`,
`mcp-builder`, `claude-api` skills.

---

## 7. Quality verification

| Check | Result |
| --- | --- |
| 17/17 skills present | ✅ |
| Frontmatter `name` == directory name | ✅ all 17 |
| 9-section structure present | ✅ all 17 (testing skill 11 headers) |
| Length in target band (~180–320) | ✅ (domain-model 149 = reference table, by design) |
| Duplicate plugins | ✅ none (GitHub not re-declared; single Impeccable, single Superpowers) |
| Duplicate/overlapping skills | ✅ none (repo domain skills vs. user-level overview are complementary) |
| Conflicting instructions | ✅ resolved (`Offer` vs `DealerOfferSubmission` disambiguated across skills) |
| Deprecated plugins / broken refs | ✅ none |
| Invalid config | ✅ `settings.json` / `.mcp.json` valid JSON, unchanged |
| Architecture conflicts | ✅ none — "extend, never replace" encoded; no app code touched |
| App build risk | ✅ none — no changes to `frontend/` build stack |

---

## 8. Remaining recommendations

1. **Run the operator installs in §6 once**, then re-run `/code-review` + `/security-review` on the
   next feature PR to exercise the full gate.
2. **`/impeccable init`** in an interactive session to generate `PRODUCT.md` / `DESIGN.md` so the
   Impeccable hook has product context (currently reports `NO_PRODUCT_MD`, which is expected).
3. **Set `CONTEXT7_API_KEY`** and authorize `buffer` to activate documentation-lookup and social MCPs.
4. **Consider a lightweight CI check** that asserts each `.claude/skills/autolenis-*/SKILL.md` keeps
   `name == dirname` and the 9 sections, so the skills don't drift.
5. **Keep skills in sync with the schema:** when `prisma/schema.prisma` enums change, update
   `autolenis-domain-model` (it is the enum source of truth referenced by every domain skill).
6. **Reconcile the AI fallback policy:** `autolenis-master` states Groq→Anthropic/Gemini fallback,
   but only Groq is currently wired (`lib/ai/groq-client.ts`). `autolenis-ai-safety-and-orchestration`
   documents the real state and requires any new provider to route through the same kill-switch +
   output-validation path — decide whether to implement the additional providers or update the policy.
