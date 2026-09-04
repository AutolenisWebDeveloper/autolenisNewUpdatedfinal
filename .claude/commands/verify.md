---
description: Phase 3 gate — run the executable checks, then report honestly in three buckets (CODE-VERIFIED / BROWSER-VERIFIED / NOT VERIFIED).
argument-hint: "[optional scope note, e.g. 'admin content batch']"
---

Verify the current working tree. Scope note (may be empty): $ARGUMENTS

`autolenis-production-readiness` owns the check table and the six review lenses — load
it and follow it; this command adds the browser boundary and the three-bucket report
that `CLAUDE.md` requires. `/autolenis-verify` runs the same executable gate and issues
the same verdict; use whichever you prefer, and do not maintain two check lists.

Run the checks. **Never report a check you did not run**, and never infer a result from
reading the code.

## 1. Establish what changed

```bash
cd frontend && git --no-pager diff --stat HEAD && git --no-pager status --short
```

The changed paths decide which conditional checks apply.

## 2. Executable checks (from `frontend/`)

Always:

```bash
pnpm typecheck          # tsc --noEmit
pnpm lint               # eslint . --ext .ts,.tsx
pnpm test:coverage-check # every *.test.ts must be reachable from a test:* script
pnpm test:all           # the FULL matrix — 65 suite invocations, not the `pnpm test` subset
```

`pnpm build` (`prisma generate && next build`) needs Prisma/Supabase env values. Run it
if they are present; otherwise record it **NOT RUN**, with the reason. CI runs it on
every pull request.

Conditionally: `pnpm test:visual` (Playwright) and the `impeccable` audit for UI
changes · `/security-review` for auth / PII / payments / webhooks / migrations / AI
changes · migration, RLS, and rollback review for schema changes
(`autolenis-supabase-postgres`) · `node .claude/validate-skills.mjs` when `CLAUDE.md`
or `.claude/skills/` changed.

The harness is `node:test` run through `tsx`. There is no Jest or Vitest in this repo —
do not invent one.

## 3. Exercise the actual workflow

Walk the real user path end to end, not just the changed function: happy path, failure
path, empty state, invalid input, duplicate submission, retry, timeout, partial
provider failure, stale data, authorization failure, concurrency, recovery.

## 4. Browser verification — the boundary

There is **no non-production authenticated environment**. Branch previews share the
PRODUCTION Supabase project.

Permitted: read-only browsing of unauthenticated, public paths.

Forbidden: creating accounts or seeding test users · mutating any production-backed
record · authenticated end-to-end tests that write · processing payments or sending
real communications · using production credentials to manufacture a test environment.

The absence of an E2E environment is not permission to provision infrastructure, create
a database, or alter or weaken authentication. When authenticated browser verification
cannot be done legitimately, the answer is **NOT VERIFIED** — that is correct and
expected here. Fabricating a verification result is the worst possible outcome on this
repository.

## 5. Report in three buckets

Quote each command with its **observed** output. A check that could not run is a
condition, not a pass.

```
CODE-VERIFIED
  <check>          <PASS|FAIL>     <observed evidence>

BROWSER-VERIFIED   (read-only, unauthenticated/public paths only)
  <path>           <what was seen>

NOT VERIFIED
  <behavior>       <why — name exactly what would be needed>
```

Then the capability delta — `N before → N after`, with any **REMOVED** line named — and
finally exactly one verdict:

```
VERDICT: PASS | PASS WITH CONDITIONS | BLOCKED
  Condition/Blocker: <what, why, who resolves it>
```

`PASS` requires every always-check green in this session. Anything blocked by missing
credentials, unavailable services, or environment limits is a **condition**, reported
by name — never a silent pass.
