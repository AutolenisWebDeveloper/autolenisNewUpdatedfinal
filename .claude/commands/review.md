---
description: Adversarial review of the current diff in a fresh context, before you accept anything. Reviews only — it does not fix.
argument-hint: "[optional focus, e.g. 'authorization']"
disallowed-tools: Edit, Write, NotebookEdit
---

Adversarially review the current diff. Optional focus (may be empty): $ARGUMENTS

Read the **actual current diff**. Do not review from memory of what was intended, and
do not restate findings from an earlier pass — the fixes made since then are themselves
new, unreviewed code. The Edit/Write tools are removed for this turn: this command
produces findings, and fixing them is a separate, deliberate step.

## 1. Get the diff

```bash
git --no-pager diff origin/main...HEAD --stat
git --no-pager diff origin/main...HEAD
git --no-pager status --short
```

## 2. Delegate the fresh read

Dispatch the `adversarial-diff-reviewer` subagent. A subagent starts with a clean
context, so it reads the code as written rather than as remembered — which is the entire
point of this step. Give it the branch, the changed paths, and the focus. Hooks fire
inside subagents, so the repository's guards still apply there.

While it works, do your own pass on the same diff. Compare at the end; where you
disagree, re-read the code rather than splitting the difference.

## 3. What to attack

Read the changed code **and the code around it** — callers, dependencies, consumers,
database relationships, workflows, downstream effects.

- **Correctness**: wrong logic, incomplete implementation, invalid assumptions, off-by-one,
  unhandled `null`, broken imports, weakened types, dead code, TODOs, placeholders, and
  mocks or stubs left in a production path.
- **Architecture**: duplicated functionality, a parallel system where one already existed,
  business logic leaking out of `lib/services/**` into a route handler or component, a raw
  third-party SDK call outside its adapter.
- **Security & authorization**: server-side enforcement on every entry point (frontend role
  checks are UX only), dealer isolation, tenant/RLS scoping, buyer PII in logs or exports,
  webhook signature verification, input validation.
- **Data & state**: transaction boundaries, race conditions, concurrency, retry idempotency,
  duplicate submission, state transitions that skip a guard, migrations that edit an applied
  file.
- **Money**: integer minor units, never trusting client-reported payment status, idempotency
  keys, ledger consistency.
- **Failure handling**: silent failures, a widened `catch`, a suppressed error, an error path
  that leaves state half-written, missing observability.
- **Frontend**: accessibility and responsive regressions, loading/empty/error states,
  destructive actions without confirmation, frontend and backend state disagreeing.
- **Capability delta**: does anything the diff touches remove a route, control, action, or
  workflow that the approved capability map did not mark REMOVED?

## 4. Report

| # | Severity | Finding | Evidence (`file:line`) | Why it matters | Suggested fix |
|---|---|---|---|---|---|

Severity is **BLOCKER** · **MAJOR** · **MINOR** · **NIT**. Every finding needs a
`file:line` and a concrete failure scenario — inputs or state, and the wrong result.
A finding you cannot make concrete is a question, not a finding; list it separately.

Do not manufacture findings to look thorough. **"No material findings" is a valid
result** — say it plainly when it is true.

End with: `REVIEW COMPLETE — B blockers, M major, N minor. Fixes not applied.`
