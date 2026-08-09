---
name: autolenis-production-readiness
description: >-
  The evidence-based completion gate for AutoLenis — the multi-perspective
  self-review and the executable checks that must actually run and pass before
  any substantial change is called done, ending in an explicit PASS / PASS WITH
  CONDITIONS / BLOCKED verdict. Use this skill when finishing a feature, fix, or
  refactor; when asked "is this ready", "is this production-ready", "can we
  ship", or for a pre-merge/pre-deploy review; and before opening a PR. It
  overrides any claim that a green typecheck, a successful build, or "the code
  looks right" means done.
---

## Purpose & Authority

"TypeScript compiles" is never "done" — that is Golden Rule 5 in `CLAUDE.md`,
and this skill is how it is enforced. AutoLenis handles deposits, concierge
fees, affiliate payouts, credit data, and e-signed contracts; the cost of a
confident-but-unverified "ready" is a real financial or compliance incident.

Two non-negotiables govern every verdict:

- **No fabricated validation.** A check is "passed" only if it was executed in
  this session and its output was observed. Never report a command's result you
  did not run. If it could not run, say so and why — that is a *condition*, not
  a pass.
- **The verdict is explicit.** End with `PASS`, `PASS WITH CONDITIONS`, or
  `BLOCKED`. "Looks good" is not a verdict.

## When this skill activates

- Completing a feature, bug fix, refactor, or migration.
- "Is this done / ready / shippable?"; pre-merge or pre-deploy review.
- Before opening a draft PR (pipeline step 17 in `CLAUDE.md`).
- After a `autolenis-debugging` fix, before closing the incident.

## Part 1 — Multi-perspective self-review

Re-read your own diff from each lens before running anything. Each lens has one
job; do not merge them into a single vague pass.

| Lens | Looks for |
| --- | --- |
| **Principal engineer** | Incorrect assumptions, incomplete implementation, dead code, TODOs, placeholders, mocks left on a production path, inconsistent state. |
| **Architect** | Duplicated capability, a parallel system, logic leaked into `app/**`, a raw SDK call outside an adapter, a second write path. |
| **Security engineer** | Missing server-side authz, ownership scoping, unvalidated input, secret exposure, unverified webhook, PII in logs, disabled control. |
| **QA engineer** | Untested branches, off-path/terminal transitions, error paths, idempotent replay, concurrency, boundary values. |
| **UX / product engineer** | Missing loading/empty/error states, unexplained blocked states, inaccessible controls, inconsistent tokens, avoidable friction. |
| **Production operations** | Observability of the new path, retry/DLQ behaviour, cron registration, rollback story, config/env requirements. |

Specifically hunt for: silent failures, race conditions, missing validation,
swallowed errors, N+1 queries, un-indexed hot filters, and any state a user can
reach with no way out.

## Part 2 — Executable checks

Run what applies. Record the **command and its observed result** — not an
expectation.

**Always (from `frontend/`):**

```bash
pnpm typecheck            # tsc --noEmit
pnpm lint                 # eslint (0 errors required; warnings noted)
pnpm test:all             # every test:* suite — the full matrix
pnpm build                # prisma generate && next build
```

`pnpm test:all` is the aggregate gate; running only `pnpm test` covers roughly a
third of the suites and is not sufficient for a readiness verdict.

**Conditionally:**

| If the change touched… | Also run / verify |
| --- | --- |
| Public UI | `pnpm test:visual`; `impeccable` audit |
| Payments / deposits / fees | `pnpm test:payments`, `pnpm test:webhooks` |
| Auth, roles, rate limits, CSRF | `pnpm test:security`; `/security-review` |
| Prisma schema | Migration reviewed for backward compatibility, RLS, indexes, and a stated rollback (`autolenis-supabase-postgres`) |
| A new cron route | Registered in `vercel.json` (or an explicit non-cron caller documented) and wrapped in `startCronRun`/`failCronRun` |
| A new background job | Idempotent, retry-bounded, DLQ-backed |
| An external provider | Timeout, retry/backoff, sandbox/degraded path, secret isolation |
| AI output influencing money/contracts | Structured-output validation + `AI_KILL_SWITCH` disabled-path fallback |
| Consent / messaging | Suppression + quiet-hours + STOP handling checked |

## Part 3 — The verdict

**PASS** — every applicable check ran and passed; self-review found nothing
material outstanding; no unexplained TODOs, placeholders, or mocks on a
production path.

**PASS WITH CONDITIONS** — the change is correct and shippable, but something
verifiable remains outside it. Each condition must name: what is unresolved,
why it is not a blocker, and who/what resolves it. A check that *could not be
run in this environment* is a condition, never a pass.

**BLOCKED** — any of:
- A required check fails, or could not run and the change depends on it.
- A security control is weakened, or authz/ownership scoping is missing.
- A money path lacks idempotency or integer-cents handling.
- A state-machine guard was widened without a failing-first test.
- A migration has no rollback story or breaks backward compatibility.
- A mock, placeholder, or hardcoded fixture remains on a production path.
- The change duplicates an existing system instead of extending it.

Report the verdict with the evidence inline:

```
VERDICT: PASS WITH CONDITIONS
  typecheck   PASS   tsc --noEmit, 0 errors
  lint        PASS   0 errors, 76 pre-existing warnings
  test:all    PASS   15 suites, 295 assertions, 0 failures
  build       NOT RUN — no Supabase credentials in this environment
  Condition: `pnpm build` must pass in CI before merge (CI runs it on every PR).
```

## Boundaries — do / never

**Do**
- Run the checks; quote the observed output.
- State the verdict explicitly, with conditions enumerated.
- List what you deliberately did **not** do, and why.
- Downgrade the verdict when evidence is missing.

**Never**
- Report a check as passing that you did not run.
- Call something ready because it compiles, builds, or "looks right".
- Bury a known failure in prose, or omit a skipped scope.
- Let a condition stand in for a blocker to avoid saying BLOCKED.
- Weaken a test or control to reach PASS.

## Acceptance criteria

- [ ] All six review lenses applied to the actual diff.
- [ ] Applicable executable checks run, with observed results recorded.
- [ ] `pnpm test:all` used, not just `pnpm test`.
- [ ] No TODOs, placeholders, or mocks left on a production path.
- [ ] Explicit `PASS` / `PASS WITH CONDITIONS` / `BLOCKED` verdict issued.
- [ ] Conditions and blockers named with evidence, not adjectives.

## Cross-skill links

- `autolenis-testing-quality-gates` — what "tested" means and the test matrix.
- `autolenis-auth-security-privacy` — the security lens; `/security-review`.
- `autolenis-supabase-postgres` — migration safety, RLS, rollback.
- `autolenis-observability-sre` — operability, crons, DLQ, rollback.
- `autolenis-debugging` — the loop that must precede a fix reaching this gate.
- `impeccable` — the UI quality audit feeding the UX lens.
