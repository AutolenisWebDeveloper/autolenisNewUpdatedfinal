# AutoLenis — MCP Inventory & Least-Privilege Policy

MCP (Model Context Protocol) servers define **what systems Claude can reach**. Skills define **how
Claude should work**. This file is the authoritative inventory. Apply **least privilege**:
production database, payments, and messaging default to **read-only or explicit human approval for
writes**.

## 1. Project-declared servers (`.mcp.json`, enabled in `.claude/settings.json`)

| Server | Transport | Secret | Status | Notes |
| --- | --- | --- | --- | --- |
| `filesystem` | stdio (`@modelcontextprotocol/server-filesystem .`) | none | ✅ active | Scoped to repo root. |
| `memory` | stdio (`server-memory`) | none | ✅ active | Knowledge graph → `.claude/memory/knowledge-graph.json`. |
| `sequential-thinking` | stdio | none | ✅ active | Structured reasoning. |
| `playwright` | stdio (`@playwright/mcp`) | none | ✅ active | Browser automation / E2E / screenshots. |
| `buffer` | http (`mcp.buffer.com`) | OAuth (interactive) | ⚠️ needs auth | Social publishing; authorize via connector settings / `claude mcp`. |
| `context7` | http (`mcp.context7.com`) | `CONTEXT7_API_KEY` | ⚠️ needs key | Up-to-date library docs (documentation lookup). Key from context7.com. |

## 2. Platform / connector servers (available in hosted sessions — not in `.mcp.json`)

These are provided by the Claude Code hosting platform or user connectors, so they are **not**
re-declared in `.mcp.json` (avoids duplicates). Availability depends on the session/account.

| Capability | Server (tool prefix) | Default privilege | Least-privilege rule |
| --- | --- | --- | --- |
| GitHub | `mcp__github__*` | read + PR write | Draft PRs; no direct pushes to `main`. |
| Supabase / PostgreSQL | `mcp__Supabase__*` | read + migration tools | **Read-only for prod**; migrations require explicit approval; prefer branch/local first. |
| Vercel | `mcp__Vercel__*` | read (deploys/logs/errors) | Inspect deployments/logs; no destructive ops without approval. |
| Twilio | `mcp__Twilio__*` | search/retrieve (read) | Read-only; message sending stays in the app with consent checks. |
| DocuSign | `mcp__Docusign__*` | envelope read/manage | E-signature envelopes; treat sends as approval-gated. |
| Gmail | `mcp__Gmail__*` | read/label/draft | Draft-only; never auto-send. |
| Google Calendar | `mcp__Google_Calendar__*` | read/write events | Pickup scheduling; confirm before creating/deleting. |
| Google Drive | `mcp__Google_Drive__*` | read + create | Document workflows; least-privilege on writes. |

## 3. Real product integrations WITHOUT a connected MCP (use the app's typed adapters)

These vendors are core to AutoLenis but are accessed through code in `frontend/lib` /
`lib/services`, **not** via MCP. Do not invent MCP servers for them — extend the adapter instead
(see the `autolenis-integrations` skill).

- **Stripe** — payments (`lib/stripe.ts`). No write MCP; all money movement goes through the app + verified webhooks.
- **Resend** — transactional email (`lib/services/email`).
- **MicroBilt / iPredict** — prequal & credit (`MICROBILT_*`, `IPREDICT_*`).
- **MarketCheck** — inventory/vehicle data (`MARKETCHECK_API_KEY`, AMIPS pipeline).
- **Groq / Anthropic / Gemini / OpenAI** — LLM providers (fallback chains).
- **Higgsfield, Meta, LinkedIn** — social/content generation.
- **GoHighLevel, Make.com** — CRM/automation webhooks.
- **Sentry** — error monitoring (`@sentry/nextjs`).

## 4. Authorization required (this session)

`buffer` and `context7` require authentication before their tools work. In a **non-interactive**
session Claude cannot run OAuth. To enable:
- **claude.ai connectors:** authorize in claude.ai connector settings.
- **Other servers:** run `claude mcp` or `/mcp` in an interactive session.

Do not paste tokens, auth codes, or callback URLs into the repo or chat.

## 5. Rules

1. **Least privilege by default.** Prod DB / payments / messaging = read-only or approval-gated writes.
2. **No duplicate servers.** If the platform already provides a capability (e.g. GitHub), do not add
   a second stdio server for it in `.mcp.json`.
3. **No invented integrations.** Only configure MCP servers that actually exist and that AutoLenis uses.
4. **Secrets via env vars only** (`${VAR}` interpolation in `.mcp.json`); never hard-code keys.
5. **Writes to external systems are outward-facing actions** — confirm before sending money, emails,
   SMS, or e-signature requests, or before destructive infra ops.
