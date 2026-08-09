---
name: autolenis-debugging
description: >-
  Root-cause debugging discipline for AutoLenis — reproduce, gather evidence,
  trace the actual execution path, name the root cause, size the blast radius,
  fix at the cause, prove it with a failing-first regression test, then re-verify
  the neighbouring workflows. Use this skill whenever something is broken,
  failing, flaky, stuck, or behaving unexpectedly — a red test, a production
  incident, a stuck deal or auction, a record that was submitted but never
  appeared, a missing or duplicated row, a wrong amount, a webhook that did not
  land, a cron that did not run, a notification that never arrived, or a "works
  locally, fails on Vercel" report. Load it alongside the owning domain skill:
  that skill says how the system should behave, this one says how to find out
  why it did not. It overrides the instinct to patch the symptom, widen a
  try/catch, add a sleep, or relax an assertion to get green.
---

## Purpose & Authority

AutoLenis moves real money and produces legally-binding documents through
multi-stage state machines driven by ~47 crons and several webhook providers.
In that environment the cheapest-looking fix is usually the most expensive one:
a swallowed exception hides a stuck deal, a loosened assertion hides a
double-charge, an added `await sleep()` hides a race that will resurface under
load.

This skill is the authority on **how a defect is investigated and closed**. It
outranks any impulse to make the symptom disappear.

## When this skill activates

- A test is red, flaky, or was recently "fixed" by changing the assertion.
- A production report: stuck deal/auction, missing notification, unpaid
  commission, duplicate charge, unreceived webhook, silent cron.
- An error in Sentry, or an unexplained `CronJobLog` / `WebhookEvent` row.
- Any bug report, regression, or "this used to work".
- Keywords: bug, broken, failing, flaky, stuck, hang, race, intermittent,
  regression, incident, not firing, didn't send, wrong amount.

## The loop — do not skip steps

```
Reproduce → Gather evidence → Trace execution → Name the root cause
  → Size the blast radius → Fix at the cause → Failing-first regression test
  → Re-verify neighbouring workflows
```

**1. Reproduce.** Get a deterministic repro before touching code — a failing
test, a script, or an exact request. "I think it's X" is a hypothesis, not a
repro. If it only reproduces in production, reproduce the *inputs* locally
(fixture from the real payload, with PII scrubbed).

**2. Gather evidence.** Read, don't guess:
- `logger` output (`lib/logger.ts`) — structured JSON; error level is forwarded
  to Sentry.
- `CronJobLog` (`cronName`, `status`, `duration`, `error`) for anything a cron
  should have advanced.
- `WebhookEvent` for provider deliveries; `PaymentProviderEvent` for Stripe dedup.
- The relevant timeline: `getDealTimeline(dealId)`, auction extension logs,
  `AuditLog`.
- `HealthCheckLog` for degraded-window correlation.

**3. Trace the real path.** Follow the call chain from the entry point
(route handler → service → adapter → provider) rather than the one you assume.
Check which layer owns the behaviour: `app/**` should be thin, so a bug in
business logic is almost always in `lib/services/**`.

**4. Name the root cause in one sentence.** If you cannot state it as
"X happens because Y, under condition Z", you have not found it yet. Common
AutoLenis shapes worth ruling in or out:
- **State-machine guard**: a transition was attempted that `canTransition`
  rejects, and the caller ignored the result.
- **Idempotency**: a replayed webhook or re-run cron applied an effect twice —
  or a dedup key was too broad and suppressed a legitimate second event.
- **Ownership scoping**: a query missing `buyerId`/`dealerId` returned another
  tenant's row.
- **Server/Client boundary**: a value that only exists on the server was read in
  a Client Component, or a `use client` module pulled in `server-only` code.
- **Cron auth / schedule drift**: the route exists but is absent from
  `vercel.json`, or the `CRON_SECRET` header check rejects silently.
- **Money units**: dollars leaked into an integer-cents field, or vice versa.
- **Provider degradation**: the adapter fell back and the fallback path was
  never exercised.

**5. Size the blast radius.** Before fixing, ask what else shares the cause:
the same service, the same enum, the same webhook handler, the same missing
index. Search for the pattern; a one-line fix that leaves four siblings broken
is not a fix.

**6. Fix at the cause.** Inside the owning service, in the existing
architecture. If the correct fix is large, say so and scope it — do not
substitute a smaller wrong fix.

**7. Prove it.** Write the regression test **first** so you see it fail, at the
seam that owns the logic. Then fix, then see it pass
(`autolenis-testing-quality-gates`).

**8. Re-verify neighbours.** Re-run the affected `pnpm test*` suites plus
`typecheck` and `lint`. For a state-machine or money fix, re-check the
off-path transitions too.

## Core rules & invariants

1. **Never weaken a test to get green.** Changing an assertion, adding `.skip`,
   or loosening a matcher to pass is a defect being hidden. If a test is wrong,
   say why in the PR and change it deliberately.
2. **Never swallow an exception.** No empty `catch {}`, no `catch { return null }`
   on a money, auth, or state-transition path. Log via `logger` and let the
   caller decide.
3. **Never disable validation, authz, RLS, or a rate limit to make something
   work.** That converts a bug into a vulnerability.
4. **No unexplained sleeps or retries.** A `setTimeout` that makes a race "go
   away" is a race you now cannot see. Fix the ordering or take the lock.
5. **No `console.*`.** Use `logger` so the signal reaches Sentry and stays
   queryable.
6. **Don't hand-edit production rows as a fix.** Fix the code path; if data
   repair is genuinely needed, do it through a scripted, logged, reversible
   backfill.
7. **One root cause per change** where possible — a fix bundled with unrelated
   refactors is unreviewable and un-revertable.
8. **Reproduce before and verify after.** A fix you never saw fail is a guess.

## Flaky-test protocol

A flaky test is a real defect until proven otherwise — usually unmocked time,
randomness, network, or shared state. Mock the clock and the provider
(`autolenis-testing-quality-gates` rule 7). Quarantine only with a written
justification and a linked follow-up; never silently.

## Boundaries — do / never

**Do**
- Reproduce first; read logs and DB evidence before theorising.
- State the root cause in one sentence before writing the fix.
- Search for sibling occurrences of the same cause.
- Write the failing regression test first.
- Report honestly what still fails.

**Never**
- Patch the symptom, widen a `catch`, or relax an assertion.
- Add a sleep, a blind retry, or a `?.` chain to silence an error.
- Turn off a security control to unblock yourself.
- Claim a fix works without running the test that proves it.

## Acceptance criteria

- [ ] Deterministic reproduction existed before the fix.
- [ ] Root cause stated in one sentence; symptom-only fixes rejected.
- [ ] Blast radius searched; sibling occurrences fixed or listed.
- [ ] Regression test written failing-first, now passing.
- [ ] No weakened assertion, swallowed error, disabled control, or added sleep.
- [ ] Affected `pnpm test*` suites + `typecheck` + `lint` green.
- [ ] Anything still broken is stated plainly, not omitted.

## Cross-skill links

- `autolenis-observability-sre` — logs, Sentry, `CronJobLog`, DLQ, runbooks.
- `autolenis-testing-quality-gates` — the failing-first regression test.
- `autolenis-deal-lifecycle` / `autolenis-auction-engine` — stuck-state triage.
- `autolenis-payments-and-ledger` — money discrepancies and webhook replay.
- `autolenis-auth-security-privacy` — before disabling anything, read this.
- `autolenis-production-readiness` — the gate the fix must pass to ship.
