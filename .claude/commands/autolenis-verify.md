---
description: Run the full AutoLenis quality gate and issue an evidence-based PASS / PASS WITH CONDITIONS / BLOCKED verdict.
argument-hint: "[optional scope note, e.g. 'payments change']"
---

Run the AutoLenis production-readiness gate for the current working tree.

Load the `autolenis-production-readiness` skill and follow it. Scope note from
the user (may be empty): $ARGUMENTS

## 1. Establish what changed

```bash
cd frontend && git --no-pager diff --stat HEAD && git --no-pager status --short
```

Use the changed paths to decide which conditional checks apply.

## 2. Self-review the actual diff

Apply all six lenses from the skill — principal engineer, architect, security
engineer, QA engineer, UX/product, production operations. Read the diff; do not
review from memory of what you intended to write.

## 3. Run the checks (from `frontend/`)

Always:

```bash
pnpm typecheck
pnpm lint
pnpm test:coverage-check
pnpm test:all
```

`pnpm build` needs Prisma/Supabase env values; run it if they are available,
otherwise record it as NOT RUN with the reason (CI runs it on every PR).

Conditionally, per the skill's table: `pnpm test:visual` + the `impeccable`
audit for UI; `/security-review` for auth/PII/payments/webhooks/migrations/AI;
migration + RLS + rollback review for schema changes; cron registration in
`vercel.json` for a new cron.

## 4. Report

Quote each command with its **observed** result. Never report a check you did
not run — a check that could not run is a condition, not a pass.

End with exactly one verdict line and its evidence:

```
VERDICT: PASS | PASS WITH CONDITIONS | BLOCKED
  <check>  <PASS|FAIL|NOT RUN>  <observed evidence>
  ...
  Condition/Blocker: <what, why, who resolves it>
```
