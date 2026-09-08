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

<<<<<<< HEAD
**`ask` is the per-run gate.** On 2026-09-07 the owner moved three production-database operations
from `deny` to `ask` (`../CLAUDE.md` → *Production database access*): `prisma migrate deploy`,
`prisma migrate resolve --applied|--rolled-back`, and read-only verification (`prisma migrate
status`, `psql` in a read-only transaction). An `ask` prompt is answered for that one run; the
"don't ask again" answer defeats the protocol and is never chosen. Because a layer-1 rule matches
the command *as written*, `pnpm exec prisma migrate deploy` and `PGOPTIONS=… psql` are matched as
`pnpm` and `PGOPTIONS=…` commands and would otherwise fall through to the default flow — so the
guard below emits the same `ask` decision itself, carrying the protocol in the prompt text.

Layer 1 also covers the **MCP tools** that would write to production without any shell command:
the Supabase connector's `execute_sql`, `apply_migration`, `deploy_edge_function` and branch /
project lifecycle tools, and the Vercel connector's `deploy_to_vercel` / `pause_project`. A
permission rule is the only layer that sees an MCP call — no hook here inspects one — so these are
deliberately in `deny`, not `ask`.

=======
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
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

<<<<<<< HEAD
Both scripts read the hook payload on stdin and, on a match, print the schema-exact decision JSON
(`hookSpecificOutput` → `permissionDecision`). A **deny** is printed **and** exits 2, so the call is
blocked under either documented mechanism; an **ask** is printed and exits 0, so Claude Code shows
the owner a prompt carrying the reason. A typo in one of those field names would be a silently
*open* gate, so each script builds that JSON in exactly one place. Within one compound command a
deny always wins over an ask: asks are collected and emitted only after every segment was scanned.
=======
Both scripts read the hook payload on stdin and, on a match, print the schema-exact deny JSON
(`hookSpecificOutput` → `permissionDecision: "deny"`) **and** exit 2, so the call is blocked under
either documented mechanism. A typo in one of those field names would be a silently *open* gate, so
each script builds that JSON in exactly one place.
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)

`guard-destructive.sh` (matcher `Bash`) first strips heredoc bodies — a document that quotes a
forbidden command is data, not an instruction to run it, and this file is exactly such a document.
A heredoc fed to an interpreter (`bash`, `sh`, `python`, `node`, `psql`, …) is the exception: there
<<<<<<< HEAD
the body really is code, so it is inspected — a `psql` body for writing SQL, a `node`/`python` body
for a credential read. It then walks the command line by line and each line segment by segment
(every separator Claude Code itself recognises), and for each segment peels leading environment
assignments, wrappers (`timeout`, `nice`, `nohup`, `sudo`, `env`, `xargs`, …), environment runners,
binary path prefixes (`./node_modules/.bin/prisma`) and git global options, and collapses whitespace
before matching. That closes all documented evasions above. A `psql` line is additionally
shell-tokenised as a whole, so a `;` inside a quoted `-c` argument cannot hide the statement that
follows it.

It **blocks**: recursive force-delete · hard reset · merge and mergetool · force-push · push at
`main` / `master` / `develop` / `production` · `supabase db push` / `db reset` / `migration up` /
`migration repair` / `db dump` · `prisma migrate reset` / `migrate dev` / `db push` / `db execute` /
`db seed` · `prisma migrate resolve` in any form other than `--applied <name>` /
`--rolled-back <name>` · Vercel deploys and anything `--prod` · `dropdb` and destructive SQL passed
to `psql` / `mysql` / `prisma db execute`.

It **asks** (the 2026-09-07 protocol): `prisma migrate deploy` · `prisma migrate resolve --applied
<name>` / `--rolled-back <name>` · `prisma migrate status` and a `prisma migrate diff` that
connects · `psql` against any target that is not positively loopback, **provided** it is in the
read-only shape. Each prompt restates the four conditions the owner set (approval of this run in
chat, `pnpm db:report-target` resolving to `aieybibvewmvrubcpthm`, `preflight.sql` shown with no
`BLOCK` row, both verification halves afterwards).

For **`psql` against a non-loopback target** it additionally **blocks**: any `UPDATE` / `INSERT` /
`DELETE` / DDL in a `-c` argument, in a `-f` / `<` file that exists locally (read with `--`
comments stripped, so `preflight.sql`'s "never repair with an UPDATE" comment is fine), or in a
heredoc body · the file / shell meta-commands (`\copy`, `\!`, `\i`, `\o`, `\w`) · `pg_dump` ·
and — the load-bearing rule — any invocation **without a server-enforced read-only transaction**
(`--single-transaction -c "SET TRANSACTION READ ONLY"`, or `default_transaction_read_only=on` as a
startup option). The keyword scan is a courtesy that fails early with a clear message; the read-only
transaction is the control, because a `SELECT` can call a writing function and the server will
refuse it with `25006` either way. A target is "loopback" only when the command names
`127.0.0.1` / `localhost` / `::1` outright; a DSN held in a variable names nothing and is treated as
production — the same allowlist reasoning as `frontend/lib/testing/isolated-database.ts`.

It **blocks every credential-disclosure form it can see**: `echo` / `printf` of `$DATABASE_URL`,
`$DIRECT_URL`, `$PROD_READONLY_URL`, `$SUPABASE_SERVICE_ROLE_KEY`, `$SUPABASE_DB_PASSWORD`,
`$PGPASSWORD` · `printenv`, bare `env`, bare `set`, `export -p`, `declare -x`, `/proc/*/environ` ·
`node -e` / `python -c` / interpreter heredocs that read those variables · a password-bearing DSN
or a literal secret typed into a database-client or interpreter command line. Two things are
sanctioned and stay allowed: `[ -n "$DATABASE_URL" ]` (presence) and `pnpm db:report-target <VAR>`
(host, database, project ref, classification — never the value). `grep` for those names stays
allowed too; investigation is never the thing being blocked.

**Quoted text is text; quoted commands handed to a shell are commands.** The segment split does
not parse quotes (Claude Code's own matcher does not either), so a `grep -E "a|printenv|b"` yields a
segment that reads as `printenv`. Every rule added in 2026-09 that can match a short prefix is
therefore gated on the segment *beginning outside an open quote* — computed from the byte offset of
the segment in its line, with escaped characters dropped so `\"` does not flip the parity. The
legacy multi-word destructive rules (`git reset --hard`, `rm -rf`, `supabase db push`, …) stay
literal on purpose: over-matching a quoted phrase costs a false positive, missing one costs a
branch. And when a quoted string *is* a command — `bash -c "…"`, `sh -c`, `eval` (wrappers such as
`timeout` and `xargs` peeled first) — the guard shell-tokenises the segment and re-runs itself on
the inner string: the inner deny is the outer deny, the inner ask the outer ask. Bounded to three
levels.

**A deploy session locks everything else.** If `DATABASE_URL`, `DIRECT_URL` or `PROD_READONLY_URL`
is present in the hook's process environment and does not name a loopback host, the session can
reach production from any script — nineteen files under `frontend/scripts/` instantiate a database
client, and `pnpm test:all` would run with the credential. In that state the guard **denies**
`node` / `tsx` / `bun` / `deno`, `python` / `perl` / `ruby` / `php`, every `pnpm` / `npm` / `npx` /
`yarn` invocation, shells running scripts (`bash file.sh`, `source`, `eval`), `curl` / `wget`, and
the Supabase / Vercel CLIs — and **allows** only `pnpm db:report-target`, `pnpm typecheck` /
`lint` / `install`, `prisma generate` / `validate` / `format`, the four `prisma migrate` operations
(which then ask or deny on their own rules), `psql` (same), `node .claude/validate-skills.mjs`,
this test suite, `git`, and read-only file tools. The variable's value is compared against three
loopback patterns and never printed. A loopback DSN (the disposable `autolenis_e2e` database) is not
a deploy session, so local test runs are untouched.

**Two more holes closed on review.** `--schema` on any `prisma migrate` command must name
`frontend/prisma/schema.prisma` — pointing it at another directory would apply someone else's
migrations to production with a valid-looking command. And inside a read-only `psql` run nothing may
loosen the transaction: `SET TRANSACTION READ WRITE` is legal before the first query, so it,
`transaction_read_only`, `SET SESSION CHARACTERISTICS`, `SET ROLE`, `SESSION AUTHORIZATION`,
`RESET ALL` and `set_config` are denied in `-c` text, files and heredoc bodies alike.
=======
the body really is code, so it is inspected. It then splits the command on every separator Claude
Code itself recognises, and for each subcommand peels leading environment assignments, wrappers
(`timeout`, `nice`, `nohup`, `sudo`, `env`, `xargs`, …), environment runners and git global options,
and collapses whitespace before matching. That closes all three documented evasions above.

It blocks: recursive force-delete · hard reset · merge and mergetool · force-push · push at
`main` / `master` / `develop` / `production` · `supabase db push` and `db reset` · the Prisma
migrate/deploy/reset/push/execute/seed family · Vercel deploys and anything `--prod` · `dropdb` and
destructive SQL passed to `psql` / `mysql` / `prisma db execute`.
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)

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
<<<<<<< HEAD
Only a positive match denies or asks.

Regression tests live in `hooks/__tests__/guards.test.sh`. Run them after any change to either
guard — the deny cases are only a third of the test: every deny has allow cases around it, and the
three authorized production operations must come back as `ask`, never `allow` and never `deny`.
=======
Only a positive match denies.

Regression tests live in `hooks/__tests__/guards.test.sh`. Run them after any change to either
guard — the deny half is only half the test.
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)

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
<<<<<<< HEAD
- **The production protocol's target check reasons about the DSN, not the far end.**
  `pnpm db:report-target` classifies the connection string in-process; a tunnel or proxy that
  forwards elsewhere would not be detected. It also cannot see a credential that never passes
  through the shell — a script that reads `process.env.DATABASE_URL` from a *file* is invisible to
  the guard (the inline `-e` / `-c` / heredoc forms are caught). The read-only transaction the
  server enforces, and the owner reading the sanitized target in chat before approving, are the
  controls that hold regardless.
- **The `psql` keyword scan is a denylist.** It catches statement-leading write verbs; it does not
  parse SQL. That is why it is paired with the server-enforced read-only transaction, which is an
  allowlist by construction: nothing writes, whatever the verb.
- **`ask` can be answered wrongly.** "Don't ask again for this session" would carry one approval to
  every later run, exactly what the protocol forbids. The guard cannot prevent that answer; the
  protocol names it so nobody gives it by reflex.
- **MCP write tools are denied by permission rule only.** No hook inspects an MCP call, and a
  connector that adds a new write tool tomorrow is not covered until it is added to `deny`.
  `.claude/MCP_INVENTORY.md` is the place that list is maintained.
- **Deploy-session detection reads the process environment only.** A credential that reaches
  Prisma through a `.env` file it auto-loads, or a script that reads one from disk, does not flip
  the mode — which is one more reason `.env*` is denied to read and edit, and why the
  `pnpm db:report-target` step (which reads `process.env`) refusing on `UNUSABLE` is what stops a
  deploy whose credential the guard cannot see.
- **Recursion follows `bash -c`, `sh -c` and `eval`, not every program that executes a string.**
  `ssh host "…"`, `node -e "execSync(…)"`, `find -exec` and the like are not unwrapped. In a deploy
  session those programs are denied outright; outside one there is no credential for them to use.
=======
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)

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
<<<<<<< HEAD
| `psql "$DATABASE_URL" -c "update vehicle_requests set status = 'CANCELLED'"` | layer 2 only (DML) |
| `psql "$DATABASE_URL" -c "select 1"` — no read-only transaction | layer 2 only |
| `echo $DATABASE_URL` · `printenv` · `node -e "console.log(process.env.DIRECT_URL)"` | layer 2 only |
| `pnpm exec prisma migrate resolve` with neither `--applied` nor `--rolled-back` | layer 2 only |

Every one must be **blocked**. Then the three authorized operations must **prompt**, never run
silently and never be refused: `pnpm exec prisma migrate deploy`, `pnpm exec prisma migrate resolve
--applied <name>`, and `psql "$DIRECT_URL" -X -v ON_ERROR_STOP=1 --single-transaction -c "SET
TRANSACTION READ ONLY" -f docs/transaction-flow/phase-1-proof/preflight.sql` — each must show a
prompt whose text restates the protocol. (In the scratch clone with no `DIRECT_URL` set, decline
the prompt; the point is that it appeared.) Then check the other direction, because a guard that
blocks everything is also broken: `git status`, `pnpm typecheck`, `pnpm test:all`,
`git push -u origin <feature-branch>`, deleting a single named file, grepping the docs for the word
"merge", `[ -n "$DATABASE_URL" ] && echo set`, and `pnpm db:report-target DATABASE_URL` must all
still run.
=======

Every one must be **blocked**. Then check the other direction, because a guard that blocks
everything is also broken: `git status`, `pnpm typecheck`, `pnpm test:all`,
`git push -u origin <feature-branch>`, deleting a single named file, and grepping the docs for the
word "merge" must all still run.
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)

If a block does not fire, the hook path or the permission syntax is wrong for your CLI version. On
this repository that gap matters more than on most, because the blast radius is production data.
Fix it before using the setup for real work.

## Changing the rules

Rules live in `settings.json` → `permissions` and in the two `hooks/guard-*.sh` scripts. Add to the
`deny` list freely. Moving an entry from `ask` to `allow` is a decision, not a convenience — do it
<<<<<<< HEAD
when the prompt has become noise, not pre-emptively. Moving anything that reaches production from
`deny` to `ask` is an **owner ruling recorded in `../CLAUDE.md`**, as the 2026-09-07 protocol was;
nothing that reaches production ever moves to `allow`. Whatever you change, re-run
=======
when the prompt has become noise, not pre-emptively. Whatever you change, re-run
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
`hooks/__tests__/guards.test.sh` and both tables above.
