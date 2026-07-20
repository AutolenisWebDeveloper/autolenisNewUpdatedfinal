# `.claude/` — Claude Code project configuration

This directory configures Claude Code / Claude.ai skills and MCP servers for the
AutoLenis repository. See the full audit at
[`SKILLS_DEPENDENCY_AUDIT_2026-07.md`](../SKILLS_DEPENDENCY_AUDIT_2026-07.md) in the repo root.

## What lives here

| Path | Purpose |
| --- | --- |
| `settings.json` | Enables the project MCP servers declared in `../.mcp.json`. |
| `memory/` | Persistent knowledge-graph store for the Memory MCP server. |

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
