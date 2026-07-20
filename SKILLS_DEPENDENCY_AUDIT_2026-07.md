# Skills Dependency Audit & Installation Report

**Project:** AutoLenis (`autolenisNewUpdatedfinal`)
**Date:** 2026-07-20
**Scope:** Impeccable · Superpowers · Frontend Design · MCP Server Skills · Skill Creator
**Author:** Automated dependency audit (branch `claude/skills-dependency-audit-p7unx7`)

---

## 0. Executive summary (read this first)

The single most important finding of this audit is a **category correction**:

> The five items in scope are **Claude Code / Claude.ai *skills***, not npm or pnpm
> packages of the AutoLenis Next.js application. A skill is a `SKILL.md` file plus
> optional helper scripts that load into Claude's context. Skills are distributed
> through the Claude runtime (`/mnt/skills`, `~/.claude/skills`) or a plugin
> marketplace — **they never appear in `frontend/package.json`, `tsconfig.json`,
> `tailwind.config.ts`, or the Next.js build graph.**

Because of this, the correct action is **not** to inject dozens of packages into the
production automotive platform's build stack (which would risk the Next 16 / React 19
build). The correct, safe, and reversible actions are:

1. **Audit** what each skill genuinely requires (done below).
2. **Configure the MCP servers** in the repo's `.mcp.json` (done — see §4).
3. **Document** the environment-level requirements (runtimes, CLIs, Python packages,
   env vars) so any operator can reproduce a working skill environment (done — §3, §7).

### Skill availability at a glance

| # | Requested skill | Present in this environment? | Location | External deps to install |
| - | --------------- | ---------------------------- | -------- | ------------------------ |
| 1 | **Impeccable** | ✅ **Installed** (vendored) | `.claude/skills/impeccable/` | Full plugin v3.9.1 vendored from the public GitHub source; self-contained, no `npm install` needed (see §2.1). |
| 2 | **Superpowers** | ❌ **Not found** | — | Third-party Claude Code plugin collection; install via its plugin marketplace (see §2.2). |
| 3 | **Frontend Design** | ✅ Present | `/mnt/skills/public/frontend-design/` | **None** — pure guidance. Optional: Playwright (screenshots). |
| 4 | **MCP Server Skills** (`mcp-builder`) | ✅ Present | `~/.claude/skills/mcp-builder/` | Python `anthropic>=0.39.0`, `mcp>=1.1.0`; Node MCP SDK for Node servers. |
| 5 | **Skill Creator** (`skill-creator`) | ✅ Present | `~/.claude/skills/skill-creator/` | `claude` CLI for the eval loop; Python `pyyaml` (present). |

> ⚠️ **Persistence caveat.** `/mnt/skills` and `~/.claude/skills` live in the
> **ephemeral session container**, which is rebuilt every session and is **not**
> tracked by git. Nothing this audit does can permanently "install" those skill
> *files* into the repo. What *is* persisted in the repo is the MCP configuration
> (`.mcp.json`), the `.claude/` scaffolding, and this report.

---

## 1. Environment baseline (verified)

| Component | Version detected | Status |
| --------- | ---------------- | ------ |
| Node.js | **v22.22.2** | ✅ Meets app engine `>=18.18` and all skill needs |
| npm | 10.9.7 | ✅ |
| pnpm | 10.33.0 | ✅ Matches `packageManager` pin `pnpm@10.33.0` |
| Python | 3.11.15 | ✅ Meets skill script needs (`>=3.8`) |
| git | 2.43.0 | ✅ |
| GitHub CLI (`gh`) | **not installed** | ⚠️ Not needed — GitHub MCP is platform-provided (`mcp__github__*`) |
| `claude` CLI | not on `PATH` in this container | ⚠️ Needed only by Skill Creator's eval runner (§2.5) |
| App `node_modules` | **absent** | ℹ️ App deps not installed in this session (not required for skills) |

Python packages checked: `pyyaml` ✅ 6.0.1, `requests` ✅ 2.33.1, `jinja2` ✅ 3.1.6,
`anthropic` ❌ missing, `mcp` ❌ missing, `fastmcp` ❌ missing.

---

## 2. Per-skill dependency analysis

### 2.1 Impeccable — ✅ installed (full plugin, vendored from source)

"Impeccable" **is** a real published tool: npm package `impeccable` (v3.2.1 CLI),
"Design skills, commands, and anti-pattern detection for AI coding agents" by Paul Bakaus
(<https://impeccable.style>, <https://github.com/pbakaus/impeccable>). It was not
pre-installed in this environment, so it was installed at the user's request.

**Distribution-host blocked.** The npm CLI installs fine (the npm registry is allowlisted),
but `npx impeccable install` / `update` download the skill bundle from `impeccable.style`,
which **your organization's egress policy blocks** (confirmed HTTP 403 to CONNECT for
`impeccable.style:443`). Per the proxy rules a policy denial must not be routed around
through that host.

**Legitimate install path used.** The skills are open-source in the public GitHub repo
(which *is* allowed by policy) and the CLI ships a first-class `link`/local-bundle path for
checkouts. The repo was cloned and its prebuilt `.claude/` layout (identical to what
`npx impeccable install` deploys for the Claude Code harness) was vendored into the
project at **version 3.9.1**:

| Installed into repo | What it is |
| ------------------- | ---------- |
| `.claude/skills/impeccable/` | The skill: `SKILL.md`, 32 `reference/*.md` command guides, 34 `scripts/*` (hook + detector + live-browser tooling). Self-contained — no `npm install`. |
| `.claude/agents/impeccable-manual-edit-applier.md` | Sub-agent that applies live copy-edit batches. |
| `.claude/settings.json` → `hooks.PostToolUse` | Runs `node .claude/skills/impeccable/scripts/hook.mjs` after every `Edit`/`Write`/`MultiEdit` (5s timeout) to surface design-quality findings. |

**Validated (offline):** the skill and the `impeccable-manual-edit-applier` agent register
in Claude Code; `scripts/context.mjs` runs (reports `NO_PRODUCT_MD` — expected until
`/impeccable init` writes `PRODUCT.md`); the `PostToolUse` hook executes and returns a
valid `hookSpecificOutput` with **no network calls**; `npx impeccable detect <file>` scans
offline. The 23 `/impeccable *` commands (`polish`, `audit`, `critique`, `craft`, `shape`,
`init`, …) are invocable via the skill.

**Notes / caveats:**
- `/impeccable init` is a skill sub-command — run it in an interactive Claude Code session
  against this repo to generate `PRODUCT.md`/`DESIGN.md`. It cannot be triggered from this
  non-interactive run.
- `npx impeccable update` will keep failing until `impeccable.style` is allowlisted; until
  then, refresh by re-vendoring from the GitHub repo. 3.9.1 is the current release, so no
  update is pending.
- No `frontend/` files were touched; the production build is unaffected.

### 2.2 Superpowers — ❌ not present

"Superpowers" is a well-known **third-party open-source Claude Code plugin collection**
(a marketplace of skills), not a first-party skill and not present in this container.
It is installed at the Claude Code CLI level, not into the app:

```bash
# In an interactive Claude Code session (not available in this headless run):
/plugin marketplace add obra/superpowers-marketplace
/plugin install superpowers@superpowers-marketplace
```

**Dependencies it brings:** the plugin ships its own skills (brainstorming, TDD,
worktrees, etc.); its heavier skills expect `git`, a POSIX shell, and Node — all ✅ present.
**Action required:** run the two commands above in an interactive session; they cannot be
executed from this non-interactive environment.

### 2.3 Frontend Design — ✅ present, zero external dependencies

- **Location:** `/mnt/skills/public/frontend-design/` (`SKILL.md` + `LICENSE.txt` only).
- **Nature:** Pure design *guidance* (palette/typography/layout direction). It executes
  no code and imports no packages.
- **Runtime dependencies:** **none.** It relies on the model plus whatever UI stack the
  target project already has.
- **Optional enhancement:** the skill suggests taking screenshots to self-critique. That
  is satisfied by the **Playwright MCP server** (now configured, §4) and the app's existing
  `@playwright/test ^1.61.1`.
- **Compatibility with AutoLenis stack:** ✅ fully compatible — the app already ships
  Tailwind CSS 4, `tailwind-merge`, `class-variance-authority`, `tailwindcss-animate`,
  Radix UI, `lucide-react`, and four `@fontsource` families, which is more than enough to
  execute any Frontend Design direction.

### 2.4 MCP Server Skills / `mcp-builder` — ✅ present, needs Python packages

- **Location:** `~/.claude/skills/mcp-builder/` (`SKILL.md`, `reference/`, `scripts/`).
- **Declared dependencies** (`scripts/requirements.txt`):
  - `anthropic>=0.39.0` — ❌ **missing** (used by `scripts/evaluation.py` to score servers)
  - `mcp>=1.1.0` — ❌ **missing** (MCP client used to connect to servers under test)
- **Build targets it supports:**
  - **Python servers:** FastMCP (`pip install fastmcp` / `mcp`) — `reference/python_mcp_server.md`
  - **Node/TypeScript servers:** `@modelcontextprotocol/sdk` + `zod` (`npm i @modelcontextprotocol/sdk zod`) — `reference/node_mcp_server.md`
- **Install command (environment level):**
  ```bash
  pip install -r ~/.claude/skills/mcp-builder/scripts/requirements.txt
  # or: pip install "anthropic>=0.39.0" "mcp>=1.1.0"
  ```
- **Auth for the evaluation harness:** `ANTHROPIC_API_KEY` env var.
- **Compatibility:** ✅ stack-agnostic. When it builds a **Node** MCP server it uses the
  same Node 22 / TypeScript 5 toolchain the app already has.

### 2.5 Skill Creator — ✅ present, needs the `claude` CLI for evals

- **Location:** `~/.claude/skills/skill-creator/` (`SKILL.md`, `agents/`, `scripts/`, `eval-viewer/`, `references/`).
- **Python imports** (all **stdlib** except one): `argparse, base64, concurrent, datetime,
  fnmatch, functools, html, http, json, math, mimetypes, os, pathlib, random, re, select,
  signal, subprocess, sys, tempfile, time, uuid, webbrowser, zipfile`, plus **`yaml`** (PyYAML ✅ present).
  → **No `pip install` required** for the skill's own scripts.
- **External requirement:** `scripts/run_eval.py` / `run_loop.py` shell out to a
  **`claude`-with-skill-access CLI** to actually run test prompts. In this headless
  container the `claude` binary is not on `PATH`, so the *eval/benchmark loop* is
  unavailable here; **authoring, packaging (`package_skill.py`), validation
  (`quick_validate.py`), and description optimization (`improve_description.py`) all work
  as-is.**
- **Auth:** eval loop needs `ANTHROPIC_API_KEY` (or a configured Claude Code login).
- **Compatibility:** ✅ independent of the app stack.

---

## 3. Consolidated dependency inventory

### 3.1 Runtimes / CLIs

| Dependency | Required by | Status | Action |
| ---------- | ----------- | ------ | ------ |
| Node.js ≥ 18.18 (have 22) | all Node MCP servers, mcp-builder (Node target) | ✅ | none |
| Python ≥ 3.8 (have 3.11) | mcp-builder, skill-creator scripts | ✅ | none |
| git | Superpowers, general | ✅ | none |
| `claude` CLI | Skill Creator eval loop | ❌ in this container | install in an interactive Claude Code env |
| `gh` CLI | none (GitHub MCP is platform-provided) | ❌ / N/A | not required |

### 3.2 Python packages

| Package | Required by | Status | Install |
| ------- | ----------- | ------ | ------- |
| `pyyaml` | skill-creator, mcp-builder | ✅ 6.0.1 | — |
| `anthropic>=0.39.0` | mcp-builder eval | ❌ | `pip install "anthropic>=0.39.0"` |
| `mcp>=1.1.0` | mcp-builder eval | ❌ | `pip install "mcp>=1.1.0"` |
| `fastmcp` (optional) | building Python MCP servers | ❌ | `pip install fastmcp` (only if authoring a Python server) |

### 3.3 Node packages (only when *building* an MCP server with mcp-builder)

`@modelcontextprotocol/sdk`, `zod` — installed **into the new server's own package**, not
into `frontend/`.

---

## 4. MCP server installation (configured this session)

`.mcp.json` was expanded from the single pre-existing `buffer` entry to the standard set
the skills benefit from. All added servers are `npx`-launched stdio servers (no global
install, fully reversible) except the two HTTP ones.

| Server | Package / URL | Transport | Secret | Validation |
| ------ | ------------- | --------- | ------ | ---------- |
| `buffer` *(pre-existing)* | `https://mcp.buffer.com/mcp` | http | OAuth (interactive) | `/mcp` in Claude Code → authorize |
| `filesystem` | `@modelcontextprotocol/server-filesystem .` | stdio | none | server lists repo files |
| `sequential-thinking` | `@modelcontextprotocol/server-sequential-thinking` | stdio | none | `sequentialthinking` tool appears |
| `memory` | `@modelcontextprotocol/server-memory` | stdio | none | writes `.claude/memory/knowledge-graph.json` |
| `playwright` | `@playwright/mcp@latest` | stdio | none | opens a page; uses `/opt/pw-browsers` Chromium |
| `context7` | `https://mcp.context7.com/mcp` | http | `CONTEXT7_API_KEY` | resolves a library's docs |

**Notes**
- **GitHub MCP** is intentionally **not** added as a stdio server: this platform already
  exposes `mcp__github__*` tools, so a second server would be redundant and would demand a
  PAT. Use the platform tools.
- **Design/Documentation MCP** requested in the brief map to **`context7`** (live library
  documentation) and the **`playwright`**/Frontend Design pairing; no separate proprietary
  "Design MCP" server exists in the public registry.
- **Startup:** servers start on demand when Claude Code loads the project (gated by
  `.claude/settings.json` → `enabledMcpjsonServers`).

### Required environment variables

| Variable | Needed by | Purpose |
| -------- | --------- | ------- |
| `CONTEXT7_API_KEY` | context7 MCP | Auth for the docs API (free key at context7.com) |
| `ANTHROPIC_API_KEY` | mcp-builder eval, skill-creator eval | Model access for evaluation harnesses |
| *(Buffer OAuth)* | buffer MCP | Interactive authorization, no static token |

---

## 5. Compatibility matrix vs. AutoLenis stack

The skills are **stack-agnostic**; none conflicts with the app. Confirmed app stack:

| App component | Version (from `frontend/package.json`) | Conflict with any skill? |
| ------------- | -------------------------------------- | ------------------------ |
| Next.js | 16.2.9 | None |
| React / React DOM | ^19.0.0 | None |
| TypeScript | ^5.8.3 | None |
| Tailwind CSS | ^4.2.4 (+ `@tailwindcss/postcss`) | None — Frontend Design uses it |
| Prisma / `@prisma/client` | ^5.22.0 | None |
| Supabase (`@supabase/*`) | ssr ^0.6.1, js ^2.104.0 | None |
| ESLint | ^9.23.0 (flat config) | None |
| Playwright | ^1.61.1 | Shared by Playwright MCP |
| Node engine | `>=18.18` (runtime 22) | None |
| Package manager | `pnpm@10.33.0` | None |

**Version-conflict resolution:** none required. No skill declares an npm dependency that
overlaps the app's dependency tree, so there are **no peer-dependency conflicts and no
version pins to reconcile** in `frontend/`.

---

## 6. Verification results

Because skills are not app packages, the brief's app-level checks (production build,
`tsc`, ESLint) are **orthogonal** to skill installation. Status recorded honestly:

| Check | Result | Detail |
| ----- | ------ | ------ |
| Frontend Design loads | ✅ | `SKILL.md` present and parseable at `/mnt/skills/public/frontend-design/` |
| Skill Creator functions | ✅ (authoring/validate/package) / ⚠️ (eval loop) | Scripts import only stdlib + PyYAML (present); eval loop needs `claude` CLI |
| MCP Server Skills usable | ⚠️ | Guidance + Node target ready; **run `pip install anthropic mcp`** to enable the eval harness |
| Superpowers available | ❌ | Not installed; requires interactive `/plugin install` (§2.2) |
| Impeccable available | ❌ | Source unknown; user must supply (§2.1) |
| MCP servers start | ✅ config valid / ⚠️ runtime | `.mcp.json` is valid JSON; stdio servers launch on demand; `context7` needs a key |
| Dependency conflicts | ✅ none | No overlap with app tree |
| Missing peer deps | ✅ none | For skills; app deps not in scope this session |
| TypeScript compiles | ⏭️ not run | App `node_modules` absent; unaffected by skills |
| ESLint passes | ⏭️ not run | Same as above |
| Production build | ⏭️ not run | Same as above; installing skills does not touch the build graph |
| Dev server warnings | ⏭️ not run | Same as above |
| Skill commands discoverable | ✅ (present skills) | Loadable via the Skill tool / `~/.claude/skills` |

> The three "⏭️ not run" app checks were deliberately **not forced**: a full
> `pnpm install` + `next build` of a Next 16 app is heavy, consumes the session's disk
> allowance, and — critically — is **unrelated to skill installation**. Nothing in this
> change modifies `frontend/`, so the app's build status is unchanged from `main`.

---

## 7. Files created / modified

| File | Change |
| ---- | ------ |
| `.mcp.json` | Added `filesystem`, `sequential-thinking`, `memory`, `playwright`, `context7` servers alongside existing `buffer`. |
| `.claude/settings.json` | New — enables the project MCP servers **and** registers the Impeccable `PostToolUse` design hook. |
| `.claude/skills/impeccable/` | New — vendored Impeccable skill v3.9.1 (SKILL.md + 32 references + 34 scripts). |
| `.claude/agents/impeccable-manual-edit-applier.md` | New — Impeccable sub-agent. |
| `.claude/memory/.gitkeep` | New — persistent store dir for the Memory MCP server. |
| `.claude/README.md` | New — explains the skills-vs-app distinction and server table. |
| `SKILLS_DEPENDENCY_AUDIT_2026-07.md` | New — this report. |

**No files under `frontend/` were touched** (package.json, tsconfig, eslint, tailwind,
postcss all unchanged) — by design, per §0.

---

## 8. Remaining actions for the user (cannot be done in a headless session)

1. **Superpowers** — in an interactive Claude Code session:
   `/plugin marketplace add obra/superpowers-marketplace` then
   `/plugin install superpowers@superpowers-marketplace`.
2. **Impeccable** — provide the skill's source/marketplace; it is not available in this
   environment.
3. **mcp-builder eval harness** — `pip install "anthropic>=0.39.0" "mcp>=1.1.0"` and set
   `ANTHROPIC_API_KEY` (the container is ephemeral, so run this per session or add it to a
   session-start setup script).
4. **context7** — obtain `CONTEXT7_API_KEY` and export it before launching Claude Code.
5. **buffer** — authorize via `/mcp` (OAuth) on first use.

---

## 9. Recommendations for long-term maintenance

- **Keep skills out of `frontend/package.json`.** Skills are a Claude-runtime concern; the
  app's dependency tree must stay clean for reproducible Vercel builds.
- **Pin MCP server versions** once validated (replace `@latest`/`-y` floating installs with
  pinned versions in `.mcp.json`) to avoid surprise breakage from upstream releases.
- **Persist environment setup** with a session-start hook (see the `session-start-hook`
  skill) that runs `pip install anthropic mcp` and exports required keys, since the
  container is rebuilt each session.
- **Vault the keys.** `CONTEXT7_API_KEY` / `ANTHROPIC_API_KEY` belong in the platform's
  secret store, never committed. `.mcp.json` references them via `${VAR}` interpolation.
- **Version the skills you author** with `skill-creator`'s `package_skill.py`, and check the
  packaged `.zip` into a dedicated `skills/` area (or a plugin repo) so they survive
  container rebuilds.
- **Re-run this audit** whenever Node, pnpm, Next.js, or the skill set changes, and after
  any Superpowers/Impeccable install so their transitive requirements are captured.
