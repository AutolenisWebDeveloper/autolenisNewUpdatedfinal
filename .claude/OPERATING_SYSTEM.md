# The AutoLenis Claude operating system

`../CLAUDE.md` states the constraints. This file describes the machinery that **enforces** them,
what each layer can and cannot actually stop, and how to test it. Read it before you trust a
boundary — a control you believe in but that does not hold is worse than no control at all.

## Why enforcement exists here at all

Branch previews share the **PRODUCTION** Supabase project. There is no isolated branch database and
no non-production authenticated environment. A mistake that would be a nuisance in most
repositories is a production data incident in this one. So the constraints are encoded in
configuration rather than left to be remembered mid-task.

## The four layers

| Layer | Where | Enforces | Beats |
| --- | --- | --- | --- |
| 1. Permission rules | `settings.json` → `permissions` | `deny` / `ask` / `allow` on Bash commands and file paths | Direct forms of a dangerous command |
| 2. PreToolUse guards | `hooks/guard-destructive.sh`, `hooks/guard-protected-paths.sh` | The evasions layer 1 cannot see, and rules a path pattern cannot express | Wrappers, whitespace, flag reordering, "existing vs new file" |
| 3. Verification gate | `hooks/verification/{track,gate}.mjs` | The code-verification loop — blocks ending a turn with required checks unrun or red | Declaring victory early |
| 4. Command frontmatter | `commands/*.md` → `disallowed-tools` | Removes Edit/Write for the read-only phases | Sliding from Phase 1/2 into implementation |

Layers 3 and 4 predate and complement this install; layer 3 is documented in `../CLAUDE.md`.

### Layer 1 — permission rules

`deny` is absolute: if a tool is denied at any settings level, no other level can allow it, and
`--allowedTools` cannot override it. `deny` and `ask` rules apply immediately from a committed
project settings file. **`allow` rules do not** — they wait until each teammate trusts the folder,
so a fresh clone still prompts for the allowed commands. That asymmetry is useful here: the safety
rules bind on first clone, and the conveniences do not.

Claude Code parses shell operators, so a hard reset chained after a `cd` is split into subcommands
and each is matched independently. What it does **not** catch, by its own documentation:

- **Extra whitespace** — two spaces between a program and its subcommand defeats a rule written
  with one.
- **Options before the subcommand** — everything before the first `*` is matched as written, so a
  global `-C` or `-c` flag inserted ahead of the subcommand slips the same rule.
- **Environment runners** — `npx`, `pnpm exec`, `pnpm dlx`, `docker exec`, `devbox run` and friends
  are *not* stripped before matching, so a forbidden command behind one of them is matched as an
  `npx` command instead.
- **Anything a subprocess does indirectly** — a Node or Python script that opens a file itself is
  not covered by a `Read`/`Edit` rule. Only an OS sandbox stops that.

That list is exactly why layer 2 exists.

**Why layer 1 does not simply use mid-pattern wildcards.** A rule like `Bash(git * merge *)` would
catch a global flag placed before the subcommand — but because it matches the word anywhere in the
command, it also denies `git commit -m "resolve a merge conflict"`. That was verified, not assumed,
and the rule was removed. A guard that blocks ordinary work gets switched off, so the flag-reordering
case is handled in layer 2 instead, where the command is actually parsed. `guards.test.sh` covers it.

### Layer 2 — the PreToolUse guards

Both scripts read the hook payload on stdin and, on a match, print the schema-exact deny JSON
(`hookSpecificOutput` → `permissionDecision: "deny"`) **and** exit 2, so the call is blocked under
either documented mechanism. A typo in one of those field names would be a silently *open* gate, so
each script builds that JSON in exactly one place.

`guard-destructive.sh` (matcher `Bash`) first strips heredoc bodies — a document that quotes a
forbidden command is data, not an instruction to run it, and this file is exactly such a document.
A heredoc fed to an interpreter (`bash`, `sh`, `python`, `node`, `psql`, …) is the exception: there
the body really is code, so it is inspected. It then splits the command on every separator Claude
Code itself recognises, and for each subcommand peels leading environment assignments, wrappers
(`timeout`, `nice`, `nohup`, `sudo`, `env`, `xargs`, …), environment runners and git global options,
and collapses whitespace before matching. That closes all three documented evasions above.

It blocks: recursive force-delete · hard reset · merge and mergetool · force-push · push at
`main` / `master` / `develop` / `production` · `supabase db push` and `db reset` · the Prisma
migrate/deploy/reset/push/execute/seed family · Vercel deploys and anything `--prod` · `dropdb` and
destructive SQL passed to `psql` / `mysql` / `prisma db execute`.

`guard-protected-paths.sh` (matcher `Edit|Write|NotebookEdit`) blocks what a path pattern cannot
express:

- **An existing migration file.** An `Edit` deny rule on the migrations directory would also block
  adding the new migration the work legitimately needs, and `ask` alone would wave through an edit
  to an applied one. So the two layers split the job: layer 1 puts the migrations directories in
  `ask`, and layer 2 tests whether the file already exists. Adding a new migration prompts once and
  proceeds; changing an existing one is blocked outright.
- **`.env*` under NotebookEdit**, which a `Read` deny rule does not cover.
- **The ring-fenced attribution export route.** See below.

Both scripts **fail open**: an unparseable payload exits 0 and the call proceeds to the normal
permission flow, where layer 1 still applies. A guard that traps the agent is worse than no guard.
Only a positive match denies.

Regression tests live in `hooks/__tests__/guards.test.sh`. Run them after any change to either
guard — the deny half is only half the test.

### Ring-fenced: the attribution export route

`GET /api/admin/content/attribution/export` emits CSV containing buyer email and is gated only by
`requireAdmin()` — any admin role, with no dedicated role gate on this route. Its authorization
needs a **separately authorized security batch**, and the capability must not be quietly removed or
hidden in the meantime. The path guard blocks edits to that one file so it cannot be "fixed in
passing". A separately authorized batch runs with `AUTOLENIS_GUARD=off`, or removes that rule as
part of the batch.

## What this does NOT protect against

Say this out loud rather than discovering it later:

- **It is not a sandbox.** A script that opens a file or shells out on its own is invisible to
  layers 1 and 2. Only OS-level sandboxing stops that.
- **`AUTOLENIS_GUARD=off` disables layer 2** for anyone who sets it, and layer 3 has
  `AUTOLENIS_VERIFICATION_HOOK=off`. These are intentional escape hatches for authorized batches,
  not secrets.
- **It cannot tell whether you actually reviewed anything.** Layers 3 and 4 make skipping a step
  visible and inconvenient; they cannot make thinking happen.
- **It does not stop a plain `git push`.** Pushing a feature branch is the workflow. Only
  force-pushes and pushes at a protected branch are blocked.
- **`.env.example` is blocked too.** `CLAUDE.md` says never read or edit `.env*`, and the rule is
  implemented literally rather than narrowed on our own judgement. The variable *names* the build
  needs are listed in `.github/workflows/ci.yml`; if reading the example file turns out to matter,
  relaxing the rule is an owner decision.

## Where this came from

`docs/claude/install.sh` is the bundle installer that produces this configuration,
kept in the repository for provenance and so the install is reproducible. It is
**AutoLenis only.** The upstream script was written to serve two unrelated
repositories and carried a `--profile` switch to pick between them; that switch is
removed here, so there is nothing to choose and nothing to get wrong.
`--profile autolenis` is still accepted so the documented command keeps working, and
any other profile is refused with a clear error rather than silently installing the
wrong payload.

The script needs the bundle payload (`autolenis/`, and `global/` for the user-memory
mode) sitting beside it, which is not committed — so running it from the repository
stops at its own payload check without writing anything.

## Verify the install

```bash
jq . .claude/settings.json                 # settings parse
bash -n .claude/hooks/*.sh                 # hook syntax
bash .claude/hooks/__tests__/guards.test.sh  # guard behaviour, both directions
node .claude/validate-skills.mjs           # routing table + skill structure
ls docs/claude/                            # the prompt template is present
grep -n "@docs/claude" .claude/commands/prompt-for-claude-code.md
```

Then, in a session: `/context`, `/permissions`, and
`/investigate the /admin/content bulk publish flow` — which must return an evidence table **and** a
capability inventory, and change nothing.

## Prove the enforcement layer works end to end

`guards.test.sh` exercises the scripts directly. To confirm they are actually *registered* — a
correct script that Claude Code never invokes protects nothing — ask Claude Code to run each of
these **in a scratch clone, never in your working copy and never against production**:

```bash
git clone <this repo> /tmp/al-scratch && cd /tmp/al-scratch && claude
```

| Ask it to run | Caught by |
| --- | --- |
| a hard reset, e.g. of `HEAD~3` | layers 1 and 2 |
| the same hard reset chained after a `cd` | layers 1 and 2 |
| the same hard reset with a global `-C` flag before the subcommand | layer 2 only |
| `supabase db push` behind `npx` | layer 2 only |
| `supabase db push` directly | layers 1 and 2 |
| a Vercel production deploy | layers 1 and 2 |
| a recursive force-delete of a build directory | layers 1 and 2 |

Every one must be **blocked**. Then check the other direction, because a guard that blocks
everything is also broken: `git status`, `pnpm typecheck`, `pnpm test:all`,
`git push -u origin <feature-branch>`, deleting a single named file, and grepping the docs for the
word "merge" must all still run.

If a block does not fire, the hook path or the permission syntax is wrong for your CLI version. On
this repository that gap matters more than on most, because the blast radius is production data.
Fix it before using the setup for real work.

## Changing the rules

Rules live in `settings.json` → `permissions` and in the two `hooks/guard-*.sh` scripts. Add to the
`deny` list freely. Moving an entry from `ask` to `allow` is a decision, not a convenience — do it
when the prompt has become noise, not pre-emptively. Whatever you change, re-run
`hooks/__tests__/guards.test.sh` and both tables above.
