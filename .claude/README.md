# `.claude/` — Claude Code project configuration

This directory configures Claude Code / Claude.ai skills, commands, and MCP servers for the
AutoLenis repository. `../CLAUDE.md` is the constitution and the routing table; the skills here are
the domain authorities it routes to.

Latest audit: [`AUTOLENIS_SKILL_SYSTEM_AUDIT_2026-08.md`](../AUTOLENIS_SKILL_SYSTEM_AUDIT_2026-08.md).
Prior: [`SKILLS_DEPENDENCY_AUDIT_2026-07.md`](../SKILLS_DEPENDENCY_AUDIT_2026-07.md),
[`AUTOLENIS_SKILL_STACK_SOCIAL_DEALER_AUDIT_2026-07.md`](../AUTOLENIS_SKILL_STACK_SOCIAL_DEALER_AUDIT_2026-07.md).

## What lives here

| Path | Purpose |
| --- | --- |
| `settings.json` | Enables the project MCP servers from `../.mcp.json` and the Impeccable `PostToolUse` hook. |
| `skills/` | **42 project skills**: 41 authoritative `autolenis-*` skills + the vendored `impeccable/` plugin. |
| `commands/` | Slash commands (`/autolenis-verify` — the full quality gate + verdict). |
| `agents/` | Sub-agents (`impeccable-manual-edit-applier`). |
| `memory/` | Persistent knowledge-graph store for the Memory MCP server. |
| `validate-skills.mjs` | **Executable guard** for this directory — run `node .claude/validate-skills.mjs`. |
| `MCP_INVENTORY.md` | MCP server inventory, provenance, and least-privilege rules. |

## Validating the skill system

```bash
node .claude/validate-skills.mjs
```

Checks structure (frontmatter, `name` matches directory, description length), routing (every
skill is reachable from `CLAUDE.md`, every `CLAUDE.md` reference resolves), cross-skill link
integrity, description overlap between skills, and 10 representative trigger scenarios. It
validates the *configuration*, not the quality of the guidance.

## Project skills (`skills/autolenis-*`)

Repo-local, version-controlled, and **authoritative** for their domains — they override generic
advice. Load `autolenis-system-architecture` first, then `autolenis-domain-model`, then the
matching domain skill(s). `CLAUDE.md` holds the full routing table.

**Core platform (22).** `autolenis-system-architecture` (+ `reference/capability-index.md`, the
reuse-before-create lookup) · `autolenis-domain-model` · `autolenis-buyer-journey` ·
`autolenis-deal-lifecycle` · `autolenis-dealer-marketplace` · `autolenis-auction-engine` ·
`autolenis-best-price-report` · `autolenis-inventory-intelligence` ·
`autolenis-payments-and-ledger` · `autolenis-contract-shield` ·
`autolenis-auth-security-privacy` · `autolenis-supabase-postgres` · `autolenis-nextjs-react` ·
`autolenis-ui-design-system` · `autolenis-integrations` · `autolenis-communications-consent` ·
`autolenis-ai-safety-and-orchestration` · `autolenis-testing-quality-gates` ·
`autolenis-debugging` · `autolenis-production-readiness` · `autolenis-observability-sre` ·
`autolenis-accessibility-performance-seo`.

**Social operating skills (8).** Govern the **existing Social Engine** (`frontend/lib/social/*`,
`app/api/admin/social/*`, `app/api/cron/social-*`) — they orchestrate third-party providers
(Buffer/BlackTwist), never duplicate them. Load `autolenis-social-media-command-center` first:
`-content-strategy` · `-content-creator` · `-content-calendar` · `-publishing-and-scheduling` ·
`-engagement-management` · `-analytics-and-attribution` · `-content-repurposing`.

**Dealer-intelligence skills (11).** Govern the **existing AMIPS + dealer-recruitment platform**
(`lib/services/acquisition/*`, `lib/services/dealer-recruitment/*`, and the `DealerProspect` /
`DealerDiscovery` / `DealerIntelligence` / `DealerOutreachLog` models). Third-party prospecting
providers (Apollo/Firecrawl/Sales-Do) are capability providers only and never write production
records — every write goes through `autolenis-dealer-database-ingestion`. Load
`autolenis-dealer-prospecting-orchestrator` first: `-dealership-discovery` ·
`-youtube-dealer-research` · `-dealer-decision-maker-discovery` ·
`-public-business-contact-enrichment` · `-contact-verification` ·
`-dealer-deduplication-and-entity-resolution` · `-dealer-lead-scoring` ·
`-dealer-database-ingestion` · `-dealer-prospect-review-queue` · `-dealer-outreach-governance`.

> **Publishing and dealer outreach stay disabled by default** until reviewed and explicitly enabled.

## Availability caveats — verify, don't assume

Only `.claude/skills/**` is guaranteed present. Everything else is environment-provided:

- **Superpowers** was previously declared in `settings.json` via the `obra/superpowers-marketplace`
  marketplace, but resolved only where that marketplace was installed. It was **absent** in the
  hosted Claude Code environment during the 2026-08 audit (`~/.claude/plugins/installed_plugins.json`
  was empty), so the declaration was removed. `CLAUDE.md`'s pipeline does not depend on it.
- **`buffer` and `context7` MCP servers** need interactive OAuth / `CONTEXT7_API_KEY` and are
  unavailable in non-interactive sessions.
- **Impeccable** is vendored into this repo, so it is always available — including its
  `PostToolUse` hook (`skills/impeccable/scripts/hook.mjs`), verified working.

## Important distinction — skills vs. app dependencies

Skills are Claude configuration (markdown + helper scripts loaded into context), **not** npm/pnpm
packages of the Next.js app in `../frontend`. Never add skill tooling to `frontend/package.json`.

Note the one deliberate exception: `frontend/scripts/check-test-coverage.ts` is *app* tooling
(a `pnpm test:coverage-check` gate), not a skill — it belongs in the app and runs in CI.

## MCP servers configured in `../.mcp.json`

| Server | Transport | Secret required | Notes |
| --- | --- | --- | --- |
| `buffer` | http | OAuth (interactive) | AutoLenis social integration. Unavailable headless. |
| `filesystem` | stdio (npx) | none | Scoped to the repo root. |
| `sequential-thinking` | stdio (npx) | none | Structured reasoning. |
| `memory` | stdio (npx) | none | Writes to `.claude/memory/knowledge-graph.json`. |
| `playwright` | stdio (npx) | none | Browser automation / screenshots. |
| `context7` | http | `CONTEXT7_API_KEY` | Up-to-date library docs. Unavailable without a key. |

GitHub MCP is **already provided by the hosting platform** (`mcp__github__*`), so no duplicate
GitHub stdio server is declared here.
