---
name: autolenis-testing-quality-gates
description: >-
  Owns the AutoLenis test strategy and merge-blocking quality gates — the
  node:test (tsx) unit/integration suites, the Playwright visual suite, the
  required buyer and dealer E2E paths, and the rule that "TypeScript compiles"
  is never sufficient to ship. Use this skill when adding or changing tests,
  wiring package.json test scripts, deciding what coverage a change needs, or
  gating a merge; when touching any __tests__ directory, playwright.visual.config.ts,
  or CI; or when a task mentions test matrix, E2E, visual regression, coverage,
  or "how do I verify this".
---

## Purpose & Authority

This skill defines what "tested" means in AutoLenis and what must pass before a
change ships. It overrides any assumption that a green typecheck, a successful
build, or a manual click-through is enough. AutoLenis moves real money and drives
legally-binding contracts through multi-stage state machines; the cost of an
untested regression is a mis-priced offer, a stuck deal, a double charge, or a
compliance miss. Every behavioral change comes with tests that would fail without
it, and the required buyer/dealer critical paths stay green.

## When this skill activates

- Any `__tests__/` directory (unit/integration) or `*.test.ts` file.
- `frontend/package.json` `test*` scripts; `frontend/playwright.visual.config.ts`.
- Deciding the test matrix for a change (services, API routes, webhooks, UI).
- Keywords: test, unit test, integration test, E2E, visual regression,
  Playwright, coverage, quality gate, CI, `tsx --test`, snapshot.
- Reviewing/merging: verifying a change is adequately tested.

## Architecture & key files

Runner: **`node:test` via `tsx`** (not Jest/Vitest). Visual: **Playwright**
(`playwright.visual.config.ts`, `test:visual`). Scripts in
`frontend/package.json`:

- `test` — core suite: `tsx --test` over
  `lib/services/prequal/__tests__`, `lib/services/dealer-recruitment/__tests__`,
  `lib/services/deal/__tests__`, `lib/services/auction/__tests__`,
  `lib/services/affiliate/__tests__`, `lib/social/__tests__`,
  `components/admin/crm/__tests__`.
- `test:content`, `test:admin-content`, `test:buyer-insurance`,
  `test:buyer-plan`, `test:security`, `test:webhooks`, `test:payments`,
  `test:format`, `test:api-client`, `test:buyer-journey`, `test:buyer-nav`,
  `test:crm-audit`, `test:seo`, `test:crm`, `test:dealer`, `test:amips`,
  `test:admin-deals` — targeted suites (several use
  `--experimental-test-module-mocks` for module mocking).
- **`test:all` — the aggregate gate.** Runs all 26 suites (315 assertions as of
  2026-08). `pnpm test` alone is roughly a third of the matrix; a readiness
  claim based on it is incomplete.
- **`test:coverage-check`** — `scripts/check-test-coverage.ts`. Fails if any
  `*.test.ts(x)` in the tree is unreachable from every `test*` script. This
  guard exists because the 2026-08 audit found three orphaned suites (20
  passing assertions that no script invoked). **A test nothing runs is not
  coverage.**
- `test:visual` / `test:visual:update` — Playwright visual regression.
- `typecheck` (`tsc --noEmit`) and `lint` (`eslint`) — necessary, not sufficient.

**CI** (`.github/workflows/ci.yml`) runs typecheck → lint → `test:coverage-check`
→ `test:all` → build, plus a `dependency-audit` job that blocks on **critical**
advisories and reports **high** ones. Before 2026-08, CI ran only `pnpm test`,
so 14 of 15 suites were written but never enforced on a PR.

Existing `__tests__` directories (extend the nearest one; do not invent a new
harness): `lib/services/{prequal,dealer-recruitment,deal,auction,affiliate,
dealer,admin,content,buyer}/__tests__`, `lib/{__tests__,api/__tests__,
content/__tests__,seo/__tests__,payments/__tests__,social/__tests__,
security/__tests__,crm/__tests__}`, `lib/amips/intelligence/__tests__`,
`app/api/{admin/deals,admin/content,buyer/insurance,buyer/plan,webhooks}/__tests__`,
`components/admin/crm/__tests__`.

**Adding a test file to a new location also means adding/extending a `test:*`
script and adding it to `test:all`** — otherwise `test:coverage-check` fails the
build, by design.

## Core rules & invariants

1. **Compiling is not testing.** `tsc --noEmit` passing proves types, not
   behavior. Every behavioral change needs a test that fails before the change
   and passes after.
2. **Test at the seam that owns the logic** — service functions in
   `lib/services/<domain>/`, not the React page that calls them. Push business
   assertions into unit/integration tests.
3. **State-machine transitions must be tested** against the exact enum values
   (`VehicleRequestStatus`, `AuctionStatus`, `OfferStatus`, `DealStatus`,
   `DepositStatus`, `ESignStatus`, `PickupStatus`, `PreQualDecision`,
   `InsuranceStatus`, `TradeInStatus`, `DealerStatus`, `FinancingStatus`).
   Cover both the happy path and the off-path/terminal transitions
   (CANCELLED, EXPIRED, DECLINED, REFUNDED, FAILED, VOIDED).
4. **Money paths are non-negotiable.** Deposit/payment/refund logic and Stripe
   webhook handling (`test:payments`, `test:webhooks`) must assert integer-cents
   math, idempotency (no double-charge on webhook replay), and signature
   verification. Never trust client-supplied amounts/status in a test fixture.
5. **Security/auth paths are tested** (`test:security`): role gating, CSRF, rate
   limits, cron/webhook auth. A route that reads/mutates buyer/dealer/admin data
   has an authz test.
6. **AI paths are tested** for output validation and the kill-switch-disabled
   fallback (see `autolenis-ai-safety-and-orchestration`) — never assert against
   a live model; mock the provider.
7. **Deterministic tests.** Mock time, randomness, network, Stripe/DocuSign/
   MicroBilt/Twilio/Resend, and Prisma/Supabase. Use
   `--experimental-test-module-mocks` where module mocking is needed (see the
   existing `test:*` scripts). No live external calls in tests.

   **A `mock.module` allowlist fails OPEN on additions — adding an export to a
   mocked module is a change to every mock of it.** `namedExports` replaces the
   whole module, so a symbol you newly export and import in production code
   resolves to `undefined` in every suite that mocks it: typecheck stays green
   (the real module *does* have the export) and the defect surfaces only as a
   runtime `TypeError`, in whichever suite happens to reach that line. When you
   add an export that production code imports, grep for every `mock.module` of
   that module and extend its `namedExports` in the same change. **Prefer
   importing the REAL symbol into the double over restating it** — a hand-written
   stand-in (`isProviderErrorReason: (r) => !!r`) silently drifts from the
   implementation and then proves nothing.
8. **UI changes on public pages** get a Playwright visual check
   (`test:visual`); update snapshots deliberately (`test:visual:update`), never
   blindly.
9. **A change to a covered area re-runs and keeps that suite green** — don't ship
   with a known-red suite; fix or explicitly quarantine with justification.

## Minimum test matrix (by change type)

- **Service logic** (`lib/services/<domain>/`): unit tests for each new/changed
  function incl. error branches; state-transition tests for any status change.
- **API route / Server Action**: authz (allowed + forbidden role), input
  validation/rejection, success + failure response shape.
- **Webhook** (`app/api/webhooks/*`): signature verification, idempotent replay,
  and event → state effect (`test:webhooks`).
- **Payments/deposit**: cents math, refund path, double-charge prevention
  (`test:payments`).
- **Prequal**: `PreQualDecision` branches incl. `MANUAL_REVIEW`,
  `OFAC_ESCALATED`, `OFAC_REVIEW`.
- **SEO/content**: `test:seo`, `test:content` for metadata/link/body generators.
- **AI/agent**: output-schema validation + disabled-`AI_KILL_SWITCH` fallback.
- **Public UI**: Playwright visual snapshot.

## Required E2E / critical paths (must stay green)

**Buyer critical path** (from prequal to signing):
1. Buyer prequal → `PreQualDecision` (APPROVED / MANUAL_REVIEW / OFAC gate).
2. Vehicle request `SUBMITTED → INTAKE → ACTIVE_SOURCING`.
3. `$99` refundable deposit `PENDING → PAID` (buyer pays AutoLenis).
4. Auction `PENDING → ACTIVE → CLOSED`; best offer surfaced.
5. Offer `SUBMITTED → ACCEPTED`; `Deal` created (`DEAL_CREATED`).
6. Deal advances through `FINANCING_PENDING → FEE_PENDING → FEE_PAID →
   INSURANCE_PENDING → CONTRACT_PENDING → … → SIGNING_PENDING → SIGNED`.
7. Contract-shield scan runs before signing; e-sign `PENDING → … → COMPLETED`.
8. `PickupStatus NOT_SCHEDULED → SCHEDULED → COMPLETED`; deal `COMPLETED`.

**Dealer critical path**:
1. Recruitment → `DealerApplication` → `DealerVerification`.
2. `DealerStatus PENDING → ACTIVE`; account claim + onboarding + agreement sign.
3. Dealer submits offer `DRAFT → SUBMITTED`; isolation holds — a dealer never
   sees another dealer's bid or buyer PII.
4. Offer `ACCEPTED/DECLINED/WITHDRAWN/EXPIRED`; scorecard/tier updates.

## Workflows

**Add a feature**
1. Identify the owning service seam; write a failing unit/integration test there.
2. Add authz + validation tests for the exposed route/Server Action.
3. Add state-transition tests for any status change (happy + off-path).
4. Implement; run the relevant `test:*` script(s) + `typecheck` + `lint`.
5. Public UI change → run `test:visual`.

**Fix a bug**
1. Write a regression test that reproduces it (fails first). 2. Fix. 3. Confirm
   the test passes and the surrounding suite stays green.

**Before merge (gate)**
`pnpm typecheck` && `pnpm lint` && `pnpm test:coverage-check` && `pnpm test:all`
green && (`pnpm test:visual` for public UI) && required buyer/dealer paths
green. Then issue the verdict via `autolenis-production-readiness`.

## Boundaries — do / never

**Do**
- Add a test that fails without the change; test at the owning service seam.
- Mock all external services, time, randomness, and the DB.
- Cover off-path/terminal state transitions and money/authz/webhook paths.
- Extend the nearest existing `__tests__` dir and matching `test:*` script.
- Update visual snapshots deliberately with review.

**Never**
- Add a test file without a `test:*` script that runs it (`test:coverage-check`
  will fail the build).
- Treat `tsc --noEmit`/build success or manual clicking as sufficient.
- Make live external calls or hit a real DB/model in tests.
- Assert only the happy path on a state machine or money flow.
- Blindly `--update-snapshots` to make visual tests pass.
- Introduce a second test runner/framework (stay on `node:test` + `tsx`,
  Playwright for visual).

## Best practices & examples

Failing-first, deterministic service test:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { acceptOffer } from "@/lib/services/deal/...";

test("accepting an offer creates a deal and moves it to DEAL_CREATED", async () => {
  const deal = await acceptOffer(fixtureOfferId, fixtureBuyerId); // Prisma mocked
  assert.equal(deal.status, "DEAL_CREATED");
});

test("declined offer cannot be accepted", async () => {
  await assert.rejects(() => acceptOffer(declinedOfferId, fixtureBuyerId));
});
```

Webhook idempotency (money path):

```ts
test("replayed stripe deposit webhook does not double-credit", async () => {
  await handleStripeWebhook(signedEvent);   // first delivery → PAID
  await handleStripeWebhook(signedEvent);   // replay
  assert.equal(await countDepositTransitions(depositId, "PAID"), 1);
});
```

## Acceptance criteria

- [ ] Every behavioral change has a test that fails before it and passes after.
- [ ] Tests live at the owning service seam and are deterministic (no live
      network/DB/model; time+randomness mocked).
- [ ] State-machine changes cover happy + off-path/terminal transitions with
      exact enum values.
- [ ] Money, authz, and webhook paths have cents/idempotency/signature/role tests.
- [ ] AI changes test output validation + disabled-kill-switch fallback.
- [ ] Public UI changes have an intentional Playwright visual snapshot.
- [ ] Required buyer and dealer critical paths remain green.
- [ ] Every new test file is reachable from a `test:*` script and included in
      `test:all` (`pnpm test:coverage-check` passes).
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm test:all` all pass — and this is
      understood as necessary but not, by itself, "done".

## Cross-skill links

- `autolenis-nextjs-react` — where Server Action/route seams live.
- `autolenis-payments-and-ledger` — money-path invariants to assert.
- `autolenis-ai-safety-and-orchestration` — AI validation + kill-switch tests.
- `autolenis-buyer-journey` / `autolenis-auction-engine` /
  `autolenis-dealer-marketplace` / `autolenis-contract-shield` — the state
  machines the E2E paths exercise.
- `autolenis-observability-sre` — post-deploy verification and rollback.
- `autolenis-domain-model` — exact enum values under test.
- `autolenis-deal-lifecycle` — the `DealStatus` guard tests and the deal E2E path.
- `autolenis-debugging` — the failing-first regression loop for bug fixes.
- `autolenis-production-readiness` — the verdict this gate feeds.
