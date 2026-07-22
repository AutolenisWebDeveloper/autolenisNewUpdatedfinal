# `.claude/` — Claude Code project configuration

This directory configures Claude Code / Claude.ai skills and MCP servers for the
AutoLenis repository. See the full audit at
[`SKILLS_DEPENDENCY_AUDIT_2026-07.md`](../SKILLS_DEPENDENCY_AUDIT_2026-07.md) in the repo root.

## What lives here

| Path | Purpose |
| --- | --- |
| `settings.json` | Enables the project MCP servers declared in `../.mcp.json`, the Impeccable `PostToolUse` hook, and the Superpowers plugin. |
| `skills/` | **Project skills** (see below): the vendored `impeccable/` plugin plus the 17 authoritative `autolenis-*` domain skills. |
| `agents/` | Sub-agents (`impeccable-manual-edit-applier`). |
| `memory/` | Persistent knowledge-graph store for the Memory MCP server. |
| `MCP_INVENTORY.md` | Full MCP server inventory, provenance, and least-privilege policy. |

## Project skills (`skills/autolenis-*`)

`../CLAUDE.md` routes Claude to these repo-local, version-controlled skills, which are the
**authoritative** guidance for their domains and override generic advice. Load
`autolenis-system-architecture` first, then `autolenis-domain-model`, then the matching domain skill:

`autolenis-system-architecture` · `autolenis-domain-model` · `autolenis-buyer-journey` ·
`autolenis-dealer-marketplace` · `autolenis-auction-engine` · `autolenis-best-price-report` ·
`autolenis-payments-and-ledger` · `autolenis-contract-shield` · `autolenis-auth-security-privacy` ·
`autolenis-supabase-postgres` · `autolenis-nextjs-react` · `autolenis-integrations` ·
`autolenis-communications-consent` · `autolenis-ai-safety-and-orchestration` ·
`autolenis-testing-quality-gates` · `autolenis-observability-sre` ·
`autolenis-accessibility-performance-seo`.

> The user-level skills `autolenis-master` / `autolenis-tier-1` (in `~/.claude/skills`, ephemeral)
> are a high-level overview + revenue-phase playbook. The repo `autolenis-*` skills above are the
> durable, domain-scoped source of truth and do not duplicate them.

## Important distinction — skills vs. app dependencies

The five requested skills (**Impeccable, Superpowers, Frontend Design, MCP Server
Skills / `mcp-builder`, Skill Creator**) are **Claude skills**, not npm/pnpm packages
of the Next.js app in `../frontend`. Skills are markdown + helper scripts that load
into Claude's context; they are distributed through the Claude environment
(`/mnt/skills`, `~/.claude/skills`) or a plugin marketplace — **not** through
`frontend/package.json`. Do not add skill tooling to the app's build stack.

## MCP servers configured in `../.mcp.json`

| Server | Transport | Secret required | Notes |
| --- | --- | --- | --- |
| `buffer` | http | OAuth (interactive) | Pre-existing; AutoLenis social integration. |
| `filesystem` | stdio (npx) | none | Scoped to the repo root. |
| `sequential-thinking` | stdio (npx) | none | Structured reasoning. |
| `memory` | stdio (npx) | none | Writes to `.claude/memory/knowledge-graph.json`. |
| `playwright` | stdio (npx) | none | Browser automation / screenshots for Frontend Design. |
| `context7` | http | `CONTEXT7_API_KEY` | Up-to-date library docs. Get a key at context7.com. |

GitHub MCP is **already provided by the hosting platform** (`mcp__github__*` tools),
so no additional GitHub stdio server is declared here to avoid a duplicate/conflict.
