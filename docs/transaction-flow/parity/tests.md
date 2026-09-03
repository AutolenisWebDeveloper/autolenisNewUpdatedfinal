# Parity map — area: tests (§34 acceptance tests; quality gates, harnesses, CI, verification hooks)

Repo: /home/user/autolenisNewUpdatedfinal (app root `frontend/`), HEAD 0cd399f, branch claude/autolenis-transaction-implementation-hzyg4l. Read-only investigation; static reading plus three permitted small runs (`pnpm test:coverage-check`, `pnpm test:migrations`, `node --test .claude/hooks/verification/__tests__/lib.test.mjs`). All paths below are relative to `frontend/` unless they start with `.github/`, `.claude/` or `docs/`.

## Summary (10 lines)

1. The test harness is `node:test` via `tsx` (unit/integration, mocked Prisma) plus Playwright (3 configs). `package.json` defines **72** `test*` scripts; **`test:all` chains 65 of them**, not the "26 suites" that CLAUDE.md, the three skills, the hook comments and `.claude/hooks/verification/__tests__/lib.test.mjs` all still say — the number is stale documentation, not a defect in the gate.
2. `pnpm test:coverage-check` ran here: `test files found: 360 / reachable via scripts: 360 / OK`. It only recognises `*.test.ts(x)`; the two `tests/integration/*.itest.ts` and the six Playwright `*.spec.ts` are outside its contract by design.
3. CI (`.github/workflows/ci.yml`) has four jobs: `ci` (typecheck → lint → coverage-check → `test:all` → build, placeholder DSN), `migrations` (empty postgres 16.4 → `prisma migrate deploy` twice → `db:check-drift` ratchet at 345 → 15 CRM runbook files twice), `e2e` (ONLY `tests/e2e/dealer-outreach.spec.ts`, admin JWT minted by `scripts/e2e-admin-storage-state.ts`), `dependency-audit` (blocks on critical). `visual.yml` is a separate, path-filtered workflow pinned to ubuntu-24.04.
4. A visual-regression harness exists: `playwright.visual.config.ts` → `tests/visual/design-system.visual.spec.ts`, baseline in `tests/visual/__baseline__/` (5 marketing pages × desktop/mobile; png + text + metadata snapshots). It does **not** boot the app (needs `VISUAL_BASE_URL`), needs no secrets for the marketing tier (placeholder env renders 200), Chromium is pinned at `/opt/pw-browsers/chromium-1194` (present in this container), but `tests/visual/README.md:85` says only CI results are meaningful (font/AA drift).
5. Behavioural E2E: `playwright.e2e.config.ts` (testDir `tests/e2e`, `E2E_BASE_URL`, `E2E_STORAGE_STATE`, specs self-skip on missing prerequisites) and `playwright.config.ts` (testDir `e2e/`, boots `pnpm start --port 3100`, needs `DATABASE_URL`). The isolation preflight is a DSN guard: every DB-touching spec and the storage-state script refuse unless `DATABASE_URL` matches `/autolenis_e2e/`.
6. `.claude/hooks/verification/` tracks material `frontend/` edits and the checks actually run; the Stop gate requires `pnpm typecheck`, `pnpm lint`, `pnpm test:coverage-check`, `pnpm test:all` (+ `test:visual` for `app/(public)/`/`components/**/*.tsx`, + `build` for schema/next/tailwind config) to have run green and a verdict word in the closing message; blocks at most twice; degrades to allow on error; `AUTOLENIS_VERIFICATION_HOOK=off` disables.
7. Of the 20 bullets in spec §29 (the assignment said 18 — the Markdown has 20), **15 have a proving test file**, 3 are partially proven, and **2 have NONE** (Best Price persistence with weights; anti-circumvention monitoring). The junk-fee/fee-cap/APR/packing/disclosure rule engine has no test that imports the real `contract-shield.service.ts` (only mocks).
8. None of the four §34 scenarios (A–D) has a spine-level harness; coverage is seam-level unit tests. Real-DB concurrency proofs (`select-offer-concurrency.test.ts`, `postgres-concurrency.test.ts`) **skip** under the CI placeholder DSN, so the single-winner lock is NOT VERIFIED in CI.
9. Existing tests encode rules that **contradict** the spec and will have to be rewritten, not extended: `app/api/buyer/plan/__tests__/upgrade.test.ts:92` ("upgrade succeeds with NO charge"), `lib/services/shortlist/__tests__/shortlist-radius.test.ts:40` (100-mile ceiling, not 250-mile authorization), `lib/services/vehicle-request/__tests__/request-progression.test.ts:66` (sourcing side effects fire before payment), `lib/services/deal/__tests__/service-fee.test.ts:63` ($499/$99/$400 breakdown, no Standard $0 fee).
10. No suite is documented as known-red; I could not run `test:all` (forbidden) so the overall green state is UNVERIFIED here. Observed: `test:migrations` 50/50 pass, `coverage-check` OK, hook tests 37/37 pass. Node here is v22.22.2; CI pins Node 24.

---

## Part A — Inventory (deliverables requested for this area)

### A1. Every `test:*` script and the files it covers (package.json, HEAD 0cd399f)

| Script | Targets (globs as written) | Files today |
|---|---|---|
| `test` | `lib/services/prequal/__tests__`, `dealer-recruitment/__tests__`, `deal/__tests__`, `auction/__tests__`, `affiliate/__tests__`, `lib/social/__tests__`, `components/admin/crm/__tests__` | 8+27+7+13+12+2+1 = 70 |
| `test:content` | `lib/content/__tests__`, `lib/services/content/__tests__` | 5+3 |
| `test:admin-content` | `app/api/admin/content/__tests__` | 2 |
| `test:content-ui` | `components/admin/content/__tests__` | 2 |
| `test:buyer-insurance` | `app/api/buyer/insurance/__tests__` | 2 (request-quote, upload-proof-gate) |
| `test:buyer-plan` | `app/api/buyer/plan/__tests__` | 1 (upgrade) |
| `test:buyer-search` | `app/api/buyer/search/__tests__` | 1 |
| `test:buyer-contracts` | `app/buyer/contracts/__tests__` | 1 |
| `test:security` | `lib/security/__tests__`, `app/api/admin/__tests__` | 6+4 |
| `test:auth` | `lib/auth/__tests__` | 9 |
| `test:concurrency` | `lib/services/deal/__tests__/destructive/select-offer-concurrency.test.ts` | 2 (runs in the e2e job against its ephemeral `autolenis_e2e`; fails closed in CI if the target is not positively identified) |
| `test:webhooks` | `app/api/webhooks/__tests__` | 5 |
| `test:concierge` | `lib/services/concierge/__tests__` | 3 |
| `test:action-intent` / `test:action-intent-routes` | `lib/services/ai/action-intent/__tests__`, `app/api/admin/action-intents/__tests__` | 11 / 1 |
| `test:payments` | `lib/payments/__tests__` | 1 (deposit-state) |
| `test:format` | `lib/__tests__/format.test.ts`, `lib/__tests__/dealer-route-access.test.ts` | 2 |
| `test:utils` | `lib/utils/__tests__` | 2 |
| `test:api-client` | `lib/api/__tests__/client.test.ts` | 1 |
| `test:buyer-journey` / `test:buyer-nav` / `test:buyer-phone` / `test:buyer-location-backfill` | individual files in `lib/services/buyer/__tests__` | 1 each |
| `test:crm-audit` | `lib/services/admin/__tests__` | 2 |
| `test:seo` | `lib/seo/__tests__` | 3 |
| `test:crm` | `lib/crm/__tests__` (custom tsconfig with `server-only` stub) | 14 |
| `test:dealer` | `lib/services/dealer/__tests__` (top level only) | 4 |
| `test:amips` | `lib/amips/__tests__`, `lib/amips/intelligence/__tests__` | 13+1 |
| `test:admin-deals` | `app/api/admin/deals/__tests__` | 4 |
| `test:admin-dealers` | `app/api/admin/dealers/__tests__`, `app/api/admin/dealer-outreach/__tests__` | 1+1 |
| `test:affiliate-routes` | `app/api/affiliate/__tests__` | 1 |
| `test:admin-authz` | `app/api/admin/{affiliates,buyers,crm}/__tests__` | 4+3+1 |
| `test:admin-auctions` | `app/api/admin/auctions/__tests__` | 1 |
| `test:offer` | `lib/services/offer/__tests__` | 1 (otd-truthfulness) |
| `test:comms` | `lib/services/notifications/__tests__` | 6 |
| `test:contract-shield` | `lib/services/contract-shield/__tests__`, `app/api/admin/contract-shield/__tests__`, `app/api/dealer/contracts/__tests__` | 5+1+1 |
| `test:pickup` | `lib/services/pickup/__tests__`, `app/api/buyer/pickup/__tests__`, `app/api/dealer/pickup/__tests__` | 5+3+2 |
| `test:monitoring` | `lib/services/monitoring/__tests__` | 11 |
| `test:financing` / `test:financing-routes` | `lib/services/financing/__tests__`; `app/api/buyer/financing/__tests__`, `app/api/admin/financing-reviews/__tests__` | 6; 1+1 |
| `test:intake` | `lib/services/acquisition/__tests__` | 10 |
| `test:cron` | `app/api/cron/__tests__` | 21 |
| `test:email` | `lib/services/email/__tests__` | 5 |
| `test:analytics` | `lib/services/analytics/__tests__` | 3 |
| `test:integrations` | `lib/services/integrations/__tests__` | 2 |
| `test:refinance` | `lib/services/refinance/__tests__` | 2 |
| `test:domain` | `lib/domain/__tests__` | 1 |
| `test:jobs` | `lib/jobs/__tests__`, `lib/qstash/__tests__` | 1+2 |
| `test:crm-services` | `lib/services/crm/__tests__` | 10 |
| `test:comms-outbox` | `lib/services/comms/__tests__` | 2 |
| `test:campaign` | `lib/services/campaign/__tests__` | 1 |
| `test:operations` | `lib/services/__tests__` | 2 |
| `test:inventory` | `lib/services/inventory/__tests__` | 14 |
| `test:shortlist` | `lib/services/shortlist/__tests__`, `app/api/buyer/shortlist/__tests__` | 5+1 |
| `test:vehicle-request` | `lib/services/vehicle-request/__tests__` | 1 (request-progression) |
| `test:dealer-onboarding` | `lib/services/dealer/__tests__/batch2`, `lib/services/agreement/__tests__` | 3+1 |
| `test:esign` | `lib/services/esign/__tests__`, `app/api/buyer/esign/__tests__`, `app/api/dealer/deals/__tests__` | 5+1+1 |
| `test:admin-payments` | `app/api/admin/payments/__tests__`, `app/api/buyer/deposit/__tests__`, `lib/services/payment/__tests__` | 3+3+5 |
| `test:precheckout` | `lib/services/buyer/__tests__/request-resume-token.test.ts`, `app/api/public/request/__tests__` | 1+1 |
| `test:admin-nav` / `test:admin-ui-roles` | `lib/admin/__tests__`; `lib/auth/__tests__/admin-ui-roles.test.ts` | 3; 1 |
| `test:migrations` | `prisma/__tests__` | 5 (static, no DB) |
| `test:sms` | `lib/services/sms/__tests__` | 1 |
| `test:zura` | `lib/ai/__tests__`, `lib/services/ai/__tests__` | 3+8 |
| `test:concierge-route` | `app/api/concierge/__tests__` | 1 |
| **`test:all`** | chains the 65 scripts above (`package.json` script `test:all`) | — |
| NOT in `test:all` | `test:integration` (`tests/integration/*.itest.ts`, needs `autolenis_e2e` DB), `test:coverage-check`, `test:e2e-autopilot` (`playwright.config.ts`), `test:visual`, `test:visual:update`, `test:e2e` (`playwright.e2e.config.ts`) | — |

Counts (computed from package.json with node): `test:all` invokes 65 scripts; 72 `test*` scripts total; no duplicates; nothing referenced-but-undefined. **"26 suites" is stale** in CLAUDE.md ("the full matrix (26 suites)"), `autolenis-testing-quality-gates/SKILL.md` ("Runs all 26 suites (315 assertions as of 2026-08)"), `autolenis-code-verification/SKILL.md` ("all 26 suites"), `.claude/hooks/verification/lib.mjs:40-46` ("chains all 26 unit suites") and `lib.test.mjs` ("runs all 26 unit suites").

Total test files on disk: 362 (360 `*.test.ts(x)` + 2 `*.itest.ts`). No `lib/services/insurance/__tests__`, `lib/services/deposit/__tests__`, `app/api/dealer/{offers,auctions}/__tests__`, `app/api/buyer/{auctions,offers,deals,requests}/__tests__` exist.

### A2. Visual regression harness

- Config: `playwright.visual.config.ts` — `testDir: "./tests/visual"`, `snapshotDir: "./tests/visual/__baseline__"`, `snapshotPathTemplate: "{snapshotDir}/{arg}-{projectName}{ext}"`, `maxDiffPixelRatio: 0.001`, projects desktop (1280×900) + mobile (Pixel 7), `BASE_URL = VISUAL_BASE_URL ?? http://localhost:3000`, pinned Chromium `PW_CHROMIUM_PATH ?? /opt/pw-browsers/chromium-1194/chrome-linux/chrome` (lines 12-46).
- Spec: `tests/visual/design-system.visual.spec.ts` — MARKETING tier `/`, `/for-buyers`, `/how-it-works`, `/refinance`, `/contact` (lines 20-26); each page gated three ways (screenshot, settled `innerText` snapshot, metadata snapshot). Dashboard tier requires `VISUAL_STORAGE_STATE` and has no committed baseline.
- Baseline dir: `tests/visual/__baseline__/` — 30 files (`marketing-<page>-{desktop,mobile}.png/.txt` + `-meta-` txt).
- Runnable headless without secrets? Chromium binary exists here (`/opt/pw-browsers/chromium-1194`). It needs a **running app** (it does not boot one); `visual.yml:47-55` shows placeholder `DATABASE_URL`/Supabase env is enough for the marketing pages to render 200. But `tests/visual/README.md:85-97` states the baseline is pinned to the ubuntu-24.04 runner image and local results are not meaningful (font/anti-aliasing drift). So: technically runnable, not authoritative outside CI.
- CI: `.github/workflows/visual.yml` runs only on PRs touching `frontend/tests/visual/**`, `playwright.visual.config.ts`, `components/ui/**`, `app/(public)/**`, or the workflow itself (lines 24-31); seeds a baseline if none is committed and pushes it back to the PR branch.

### A3. Playwright E2E configs

| Config | testDir | Boots app? | Base URL | Env needs | Specs | Isolation preflight |
|---|---|---|---|---|---|---|
| `playwright.config.ts` (`test:e2e-autopilot`) | `./e2e` | Yes — `pnpm start --port ${E2E_PORT ?? 3100}` (line 51-58), `reuseExistingServer: !CI` | `http://127.0.0.1:3100` | `DATABASE_URL` (real Postgres), built `.next` | `e2e/deal-autopilot.spec.ts` (server health, buyer contract-shield POST removed, unauthenticated refusals across deal spine, cron secret gating) | none on DSN; asserts only unauthenticated boundaries ("a forged session would prove nothing", lines 14-20) |
| `playwright.e2e.config.ts` (`test:e2e`) | `./tests/e2e` | No (line 12-15) | `E2E_BASE_URL ?? http://localhost:3000` | `E2E_BASE_URL`, `E2E_STORAGE_STATE` (+ per-spec `E2E_AFFILIATE_*`, `E2E_DEAL_ID`), `DATABASE_URL` containing `autolenis_e2e` | `dealer-outreach.spec.ts` (CI), `dealer-funnel.spec.ts`, `affiliate-portal.spec.ts`, `buyer-remediation.spec.ts` | `dealer-funnel.spec.ts:21-26` `beforeAll` throws unless DSN matches `/autolenis_e2e/`; `dealer-outreach.spec.ts:43,84-85` and `affiliate-portal.spec.ts:35-45` `test.skip` with reason; `scripts/e2e-admin-storage-state.ts:25-30` refuses to mint an admin session otherwise |
| `playwright.visual.config.ts` (`test:visual`) | `./tests/visual` | No | `VISUAL_BASE_URL` | see A2 | 1 spec | n/a |

Canary pattern: CI polls `GET /` for 200 up to 60 s (`ci.yml:282-290`, `visual.yml:100-109`); `e2e/deal-autopilot.spec.ts:23-28` "the app boots and serves a public page". There is no `/api/health` route (`ci.yml:280`).
Supabase-auth flows (buyer/dealer sign-in) have no local stub, so `dealer-funnel`, `affiliate-portal`, `buyer-remediation` are not run in CI (`ci.yml:203-208`).

### A4. Verification hooks — what must be true before a turn may end

Wired in `.claude/settings.json:26-61`: PostToolUse (`Edit|Write|MultiEdit|NotebookEdit|Bash`) → `track.mjs`; Stop → `gate.mjs`.

- **Material file** (`lib.mjs:16-27,70-79`): extension in `.ts .tsx .js .jsx .mjs .cjs .prisma .sql .css`, path under `frontend/`, not `.claude/`, `node_modules/`, `.next/`, `dist/`, `coverage/`. `backend/` is out of gate scope.
- **Required checks** (`lib.mjs:33-56`): always `pnpm typecheck`, `pnpm lint`, `pnpm test:coverage-check`, `pnpm test:all`; plus `pnpm test:visual` when any changed file matches `app/(public)/` or `components/**/*.tsx`; plus `pnpm build` when `prisma/schema.prisma`, `next.config*` or `tailwind.config*` changed.
- **Command recognition** (`lib.mjs:105-156`): anchored at command/segment start, `pnpm|npm|yarn [run] <test:x|typecheck|lint|build|test>`, `tsc --noEmit`, `eslint`; heredoc bodies stripped; quoted strings not split (so `git commit -m "ran pnpm lint"` does not count).
- **Pass/fail parsing** (`lib.mjs:163-191`): `# fail N` summary line is authoritative for every `test*` script; typecheck fails on `error TS\d+`; lint fails on `N errors` > 0; build fails on `Failed to compile|Build error occurred`, passes on `Compiled successfully|✓ Generating static pages`; visual fails on `N failed`. Interrupted tool call → `fail` (`track.mjs:49-51`). Empty output → `unknown` (counts as run but not failed).
- **Stop decision** (`lib.mjs:211-268`): blocks when material files changed and (a) any required check is unrun, or (b) any is red, or (c) the last assistant message has no `PASS | PASS WITH CONDITIONS | BLOCKED | NOT VERIFIED`; additionally flags "claimsCompletion" phrases (`production-ready`, `everything works`, `all tests pass`…) when checks are missing/red. Never blocks when `stop_hook_active`, never more than `AUTOLENIS_VERIFICATION_MAX_BLOCKS` (default 2), any exception → allow; `AUTOLENIS_VERIFICATION_HOOK=off` disables. State in `.claude/.verification-state/<session>.json` (gitignored at `.gitignore:470`).
- Hook self-tests: `node --test .claude/hooks/verification/__tests__/lib.test.mjs` → observed `# tests 37 / # pass 37 / # fail 0`.

### A5. Known-red / environment status

- No suite is marked skipped/quarantined in package.json or CI. The two DB-gated tests no longer self-skip silently. `lib/services/deal/__tests__/destructive/select-offer-concurrency.test.ts` now resolves its target through `resolveDestructiveTarget()`: in CI a missing, unparseable or unapproved DSN **fails** the suite before a connection is opened; only on a developer machine does it skip, and it prints `NOT VERIFIED` and satisfies no gate. It is reachable from no glob in `test:all` (hence the `destructive/` directory) and runs only in the e2e job.
- Git history shows "RED" commits (`7e54374`, `7e537d2`) as deliberate failing-first steps, later followed by fixes; nothing indicates a currently red suite. `pnpm test:all` was NOT run here (forbidden) → overall green state **UNVERIFIED**.
- Observed here: `pnpm test:coverage-check` → `test files found: 360 / reachable via scripts: 360 / OK`; `pnpm test:migrations` → `# tests 50 / # pass 50 / # fail 0`; hook tests 37/37.
- Runtime: local Node v22.22.2, pnpm 10.33.0; CI uses Node 24 + pnpm 10.33.0; `engines.node >=18.18` (package.json:99-101) is looser than `--experimental-test-module-mocks` requires (Node ≥ 22.3).

---

## Part B — Requirement rows (spec §34, lines 1561-1579; HTML ACCEPT lines 975-979)

Status vocabulary: ALREADY CORRECT | PARTIAL | BROKEN | MISSING | DUPLICATED | UNVERIFIED. "Current" names the nearest proving test(s); "Required change" is what a test/harness engineer must add. Where the test encodes the opposite of the spec rule, status is BROKEN.

### B1. Scenario spine

| # | spec_ref | Requirement | Status | Current | Evidence | Required change | Legacy path |
|---|---|---|---|---|---|---|---|
| 1 | §34 L1563 | Implementation reconciled only when all four scenarios complete through the same spine and every §26 exception has been exercised | MISSING | No scenario-level harness. Unit seams exist per stage; CI E2E covers only dealer outreach. | `ci.yml:299-300` "E2E — dealer outreach … tests/e2e/dealer-outreach.spec.ts"; `playwright.config.ts:7-11` "an authenticated deep-journey E2E requires a live Supabase project" | Add a `tests/scenarios/` node:test (real Postgres, `autolenis_e2e` guard, Stripe/DocuSign adapters mocked) that drives A–D through the real services, wired as `test:scenarios` (not in `test:all`; new CI job reusing the `migrations` service container). | `tests/integration/*.itest.ts` pattern (real Prisma + DSN guard) is the template to extend |
| 2 | §34 L1567 (A) | $99 settles against the request | PARTIAL | Deposit settles PAID and creates auction; no `vehicle_request_id` linkage asserted (Deposit has no such FK today per IMPLEMENTATION-WORKFLOW §202) | `app/api/webhooks/__tests__/stripe-idempotency.test.ts:193` "fresh deposit success: marks PAID, creates auction, claims event, launches"; `lib/services/payment/__tests__/deposit-settlement.test.ts:205` | After the FK lands, add assertions in `stripe-idempotency.test.ts` and `deposit-settlement.test.ts` that the PAID deposit references the open request. | webhooks + `lib/services/payment/deposit-settlement.service` |
| 3 | §34 L1567 (A) | Sourcing opens after payment | BROKEN (test encodes opposite) | `request-progression.test.ts` advances SUBMITTED → ACTIVE_SOURCING with matcher/coverage side effects with no deposit precondition | `lib/services/vehicle-request/__tests__/request-progression.test.ts:66` "well-formed SUBMITTED advances all the way to ACTIVE_SOURCING with events + side effects"; `:84` "thin coverage does NOT block advancement" | Rewrite these cases so progression to ACTIVE_SOURCING requires a settled $99 (or the spec's equivalent) and add a failing-first case "unpaid request never reaches ACTIVE_SOURCING". | `lib/services/vehicle-request/request-progression.service` and `app/api/cron/intake-reconcile` |
| 4 | §34 L1567 (A) | $0 fee resolves (Standard) | BROKEN (test encodes different fee model) | Service-fee tests assert a $499/$99/$400 breakdown row is created for every deal | `lib/services/deal/__tests__/service-fee.test.ts:63` "creates a row with the correct $499/$99/$400 breakdown when none exists" | Add plan-aware cases: Standard → fee row resolves at $0 and FEE_PENDING is skipped/auto-cleared; Premium → $400 net of $99 credit. Keep idempotency cases (`:77`, `:85`). | `lib/services/deal/service-fee.service`, `FEE_PENDING` transition |
| 5 | §34 L1567 (A) | Financing completed and verified (by authorized staff) before release | PARTIAL / conflicts | Financing tests exercise an in-house lender adapter; a guard asserts the auction→offer→Deal spine does not import in-house decisioning | `lib/services/financing/__tests__/financing-orchestrator.test.ts:82` "APPROVED → … Deal advanced to FEE_PENDING"; `lib/services/auction/__tests__/no-inhouse-financing-on-auction-spine.test.ts:48` | Add a state-machine test: FINANCING_PENDING → next stage only via an admin "financing verified" action with actor recorded; add authz test (buyer/dealer cannot mark financing verified). Preserve `no-inhouse-financing-on-auction-spine.test.ts`. | `lib/services/financing/*`, `app/api/admin/financing-reviews` |
| 6 | §34 L1567 (A) | Possession confirmed; completion commits once | ALREADY CORRECT (unit) | Dealer QR scan completes deal once; completion event exactly once | `app/api/dealer/pickup/__tests__/scan-route.test.ts:140,205` "the owning dealer completes the deal on a valid scan" / "an already-scanned pickup is rejected (no double completion)"; `lib/services/deal/__tests__/advance-deal-status.test.ts:106,112` | None for the unit level; add the real-DB concurrent-completion case (see row 30). | — |
| 7 | §34 L1568 (B) | Valid $99 credit; $400 settles | BROKEN (test encodes opposite) | Upgrade route test asserts no charge | `app/api/buyer/plan/__tests__/upgrade.test.ts:92` "upgrade succeeds with NO charge — free at this stage by product decision"; `:117` idempotent no-op | Replace with: upgrade creates a $400 PaymentIntent (integer cents) with the $99 credit applied when a PAID deposit exists; second call reuses the intent (keep idempotency); webhook settles the balance. Add to `test:webhooks` a `premium-fee` event case. | `app/api/buyer/plan/upgrade`, `app/api/webhooks/stripe` |
| 8 | §34 L1568 (B) | Concierge assigned at settlement | MISSING | No test names concierge assignment on Premium settlement (concierge tests cover the separate anonymous concierge product) | `lib/services/concierge/__tests__/concierge-conversion.test.ts` (different concept) | Add a webhook→service test asserting an Operations assignment record is written when the $400 settles. | — |
| 9 | §34 L1568 (B) | Every release checkpoint passes | MISSING | No checkpoint concept on the deal spine (code "checkpoint" hits are admin vehicle-request due-diligence only) | `app/api/admin/requests/[requestId]/checkpoints/route.ts` (unrelated entity); 0 tests match `checkpoint` | Once checkpoints exist, add a state-machine table test enumerating each checkpoint and its release condition (pattern: `deal-state-machine.test.ts`). | — |
| 10 | §34 L1568 (B) | Co-buyer signs | MISSING | `coBuyer` is a boolean on the public request-vehicle payload only; no envelope signer test | `app/api/public/request-vehicle/route.ts:106` `coBuyer: z.boolean().optional()`; 0 test files match `co.?buyer` | Extend `lib/services/esign/__tests__/buyer-signing.test.ts` with a two-signer envelope: not COMPLETED until both sign; hash binding per signer. | `lib/services/esign` |
| 11 | §34 L1569 (C) | Custom Vehicle Request reaches payment immediately; no pre-payment sourcing spend | BROKEN | Same as row 3; intake tests fire outreach/matching pre-payment | `request-progression.test.ts:66,84,91`; `lib/services/acquisition/__tests__/post-intake-outreach-status.test.ts:71` (outreach gated only on buyerId) | Add "no provider call / no dealer outreach before deposit PAID" assertions in `test:intake` and `test:vehicle-request`. | acquisition intake pipeline |
| 12 | §34 L1569 (C) | `NOT_REQUIRED_CASH` set; cash confirmed at funding clearance | MISSING | No enum value or test | `rg NOT_REQUIRED` → no code hits outside unrelated strings | After the enum lands, extend `financing-orchestrator.test.ts` / `deal-state-machine.test.ts` with the cash branch and a staff confirmation authz test. | — |
| 13 | §34 L1570 (D) | Payoff good-through date enforced; trade surrendered at handover; obligations tracked after completion | MISSING | No code or tests for payoff good-through, surrender, or post-completion obligations | 0 code files match `payoffGoodThrough|good_through`; `lib/services/trade-in` has no `__tests__` | Create `lib/services/trade-in/__tests__/` + `test:trade-in` script (add to `test:all`); cases: expired good-through blocks handover; surrender recorded at scan; obligation timers. | `lib/services/trade-in` |

### B2. Branches that must be exercised (§34 L1571; HTML ACCEPT "Every branch must be exercised")

| # | spec_ref | Requirement | Status | Current | Evidence | Required change |
|---|---|---|---|---|---|---|
| 14 | §34 L1571 | Replay and concurrency on every money and completion path | PARTIAL | Replay: webhooks; duplicate-charge: deposit + fee; CAS: deal status; DB-lock single winner: skipped in CI | `stripe-idempotency.test.ts:204` "replay of a processed event is a duplicate ack with zero side effects"; `create-intent-duplicate-charge.test.ts:151`; `service-fee-duplicate-charge.test.ts:97`; `advance-deal-status.test.ts:96,128`; `select-offer-concurrency.test.ts:23-25` skip | Run `test:concurrency` in a CI job with the postgres service (the `migrations` job already has one); add refund-replay and premium-fee-replay cases. |
| 15 | §34 L1571 | Missing Stripe webhook recovered by reconciliation | ALREADY CORRECT (unit) | Provider-evidence sweep + settlement sweep | `lib/services/monitoring/__tests__/deposit-provider-evidence.test.ts:168` "a PENDING deposit whose PaymentIntent SUCCEEDED at Stripe raises a delivery exception"; `deposit-settlement.test.ts:205`; `app/api/cron/__tests__/deposit-activation-reconcile-route.test.ts:133` | None at unit level. Note settlement is env-gated OFF by default (`deposit-settlement.test.ts:131` "defaults to OFF — deploying the code settles nothing") — scenario harness must enable it. |
| 16 | §34 L1571 | Each sourcing band | UNVERIFIED | Radius ladder tests exist; whether `RADIUS_TIERS` equals the spec's "sourcing bands" is not provable from tests | `lib/services/auction/__tests__/coverage.test.ts:228,232` "RADIUS_TIERS is tightest-first" / "ladder returns the FIRST tier that meets MIN_COVERAGE_DEALERS" | Once bands are defined (§ owner: sourcing), add one case per band asserting provider-call budget and dealer set per band. |
| 17 | §34 L1571 | Buyer authorization beyond 250 miles | BROKEN (test encodes 100-mile ceiling, no authorization step) | Shortlist tests freeze a 100-mile provider ceiling and route beyond-radius to a custom request | `lib/services/shortlist/__tests__/shortlist-radius.test.ts:40` "the shortlist ceiling is the provider's 100 mile restriction"; `:61` "beyond 100 miles the action becomes the custom request" | Add an explicit buyer-authorization record test (>250 mi requires recorded consent; unauthorized → blocked) at the sourcing seam; reconcile the 100-mile shortlist ceiling with the spec owner before rewriting `:40`. |
| 18 | §34 L1571 | A limited auction with an Operations approval | MISSING | No test (only action-intent engine matched the grep) | `rg 'limited.?auction|ops.*approv'` → `lib/services/ai/action-intent/__tests__/engine.test.ts` only | Add auction-service test: limited auction cannot open without an Operations approval row; approval actor recorded. |
| 19 | §34 L1571 | Zero offers | PARTIAL | Zero-invitation close is tested; zero-offers-at-close → buyer path is not | `lib/services/auction/__tests__/deposit-activation.test.ts:57` "…past the no-dealer grace → close (no refund; deposit retained)"; `dealer-award.test.ts:67` "a decline / no winning offer notifies nobody" | Add auction-close test: CLOSED with 0 offers → buyer notified with recovery action, request stays open (or per spec), deposit disposition asserted. |
| 20 | §34 L1571 | An offer above budget | MISSING (code exists, test does not) | `assertWithinBuyerBudget` is untested — no test imports `offer.service.ts` for budget | `lib/services/offer/offer.service.ts:39,78,278`; `lib/services/offer/__tests__/otd-truthfulness.test.ts` covers arithmetic only | Add `lib/services/offer/__tests__/budget-gate.test.ts` (in `test:offer`): submit and revise above `maxOtdAmountCents` are rejected server-side. |
| 21 | §34 L1571 | A dealer timeout at reaffirmation | MISSING | No code or test | 0 code/test files match `reaffirm` | After the reaffirmation step lands: cron route test (pattern `app/api/cron/__tests__/*-route.test.ts`) + service test for timeout → scorecard consequence. |
| 22 | §34 L1571 | A material change accepted and rejected | MISSING | No code or test | 0 files match `material.?change` | Service test at the deal seam: material change proposal → buyer accept (deal continues) / reject (recovery path). |
| 23 | §34 L1571 | A vehicle hold expiry | MISSING | No code or test | 0 files match `holdExpir|VEHICLE_HOLD` | Cron route + service tests for hold expiry → exception + buyer/dealer comms. |
| 24 | §34 L1571 | A financing failure followed by a successful alternate path | PARTIAL | Failure → human review is tested; a subsequent alternate path is not | `financing-orchestrator.test.ts:93` "DECLINED + adverse-action rule EMPTY → FAILS CLOSED to human review"; `:106` adapter fail-closed | Add: after failure, staff records external financing verified → deal proceeds; original failure retained in history. |
| 25 | §34 L1571 | An insurance rejection | PARTIAL | Proof-write failure and gate-hold tested; explicit rejection status path not | `app/api/buyer/insurance/__tests__/upload-proof-gate.test.ts:148` "if the proof cannot be recorded, the gate is NOT released"; `advance-deal-status.test.ts:181` "unsatisfied insurance does NOT advance" | Add: admin rejects proof → status REJECTED, deal parked, buyer notified with recovery action, re-upload supersedes (`:174` exists for supersede). |
| 26 | §34 L1571 | A Contract Shield mismatch | PARTIAL | WARNING/FAIL never auto-advance; approval binds to reviewed version | `lib/services/contract-shield/__tests__/contract-auto-approve.test.ts:128` "WARNING and FAIL never advance or fire"; `app/api/admin/contract-shield/__tests__/approve-binds-to-reviewed-version.test.ts:172` | Add a rule-engine test against the real `contract-shield.service.ts` (row S20) with a contract whose OTD/fees mismatch the accepted offer → FAIL + exception routing. |
| 27 | §34 L1571 | A signature expiry and reissue | PARTIAL | Lazy expiry (CAS-guarded) tested; re-send from SIGNING_PENDING tested; reissue *after EXPIRED* not explicitly | `lib/services/esign/__tests__/buyer-signing.test.ts:331,346,356`; `app/api/admin/deals/__tests__/esign-gate-route.test.ts:115` "SIGNING_PENDING deal → envelope re-send allowed" | Add: EXPIRED envelope → reissue creates a new envelope bound to the same approved hash; old one stays EXPIRED. |
| 28 | §34 L1571 | A dealer that never executes | MISSING | No timeout/escalation test for dealer contract execution | `lib/services/notifications/__tests__/contract-stage-messaging.test.ts` (messaging only) | Add cron + service test: contract-execution SLA breach → Operations exception + scorecard consequence. |
| 29 | §34 L1571 | A blocked handover on identity mismatch | MISSING | Scan tests cover wrong-dealer QR, insurance, expiry — not buyer identity | `scan-route.test.ts:146` "another dealer's QR is rejected" ; no `identity.*mismatch` test | Add scan-route case: identity check fails → 409, pickup not completed, exception raised. |
| 30 | §34 L1571 | A delivery-discrepancy hold | MISSING | No code or test | 0 files match `discrepanc` | Service + route tests for discrepancy hold → deal parked, obligations, recovery. |
| 31 | §34 L1571 | Cancellation before and after contract execution | PARTIAL | Cancel seam (CAS, history actor, no completion event) tested; pre/post-execution distinction not | `lib/services/deal/__tests__/cancel-deal-seam.test.ts:91,119,157`; `deal-state-machine.test.ts:52` | Add two cases parameterised on `SIGNED`/executed state asserting the differing obligations/refund outcomes. |
| 32 | §34 L1571 | A refund request | ALREADY CORRECT (unit) | Refund route and service | `app/api/admin/payments/__tests__/deposit-refund-route.test.ts:92,114,144`; `lib/services/payment/__tests__/refund-deposit-charge.test.ts:53,69,77` | Add buyer-initiated refund *request* (not admin execution) if spec requires a buyer surface. |
| 33 | §34 L1571 | Standard→Premium upgrade at payment and again at the Best Price Report | BROKEN | Only the no-charge upgrade route is tested; no BPR-point upgrade | `upgrade.test.ts:92` | See row 7; add a second entry-point test at the BPR surface. |
| 34 | §34 L1571 | Upgrade from post-acceptance invitation, from each email, from the dashboard | MISSING | No tests | — | Route/template tests: each entry point carries the same idempotent upgrade token; email template tests in `lib/services/email/__tests__` (pattern `admin-cta-destinations.test.ts`). |
| 35 | §34 L1571 | A suppressed prompt during an open exception | MISSING | No tests | — | Service test: open Operations exception → upgrade prompt suppressed on dashboard/email. |
| 36 | §34 L1571 | Premium→Standard downgrade before and after the $400 settles | MISSING | No tests | — | Route + webhook tests; after settlement the downgrade path must produce an idempotency-keyed refund (reuse `refund-deposit-charge` patterns). |
| 37 | §34 L1571 | Unpaid Premium balance reverting to Standard at acceptance | MISSING | No tests | — | Offer-acceptance test: plan reverts and fee row is $0 when the $400 intent never succeeded. |
| 38 | §34 L1571 | Concurrent completion attempts | PARTIAL | CAS + exactly-once in mocked Prisma; not proven on real DB | `advance-deal-status.test.ts:106,112,128`; `scan-route.test.ts:205` | Add to the real-DB concurrency suite (row 14): N parallel scans → exactly one COMPLETED event. |

### B3. Every form walked (§34 L1573)

| # | spec_ref | Requirement | Status | Current | Evidence | Required change |
|---|---|---|---|---|---|---|
| 39 | §34 L1573 | Every website form walked (homepage, inventory, vehicle detail, shortlist, AMIPS pages, blog CTAs, social landing pages, affiliate links, conversational intake, callback, trade-in, prequalification, refinance, dealer application, affiliate application, support) | MISSING (browser walk) | No Playwright spec submits a public form; visual harness screenshots 5 marketing pages only; CI E2E is admin-only outreach | `tests/visual/design-system.visual.spec.ts:20-26`; `ci.yml:299-300` | New `tests/e2e/public-forms.spec.ts` under `playwright.e2e.config.ts` with a fixture per form, DB assertions (Prisma) on the resulting lane rows; run in the `e2e` CI job (no Supabase auth needed for public forms). |
| 40 | §34 L1573 | Each lands in its correct lane | PARTIAL (unit) | Unified intake emits opportunity + request; progression tests | `lib/services/acquisition/__tests__/unified-intake-emit.test.ts:47` "a submission creates the opportunity + linked request without inline orchestration" | Parameterise intake tests by `source` (form) → expected lane. |
| 41 | §34 L1573 | Attribution recorded | PARTIAL | Affiliate attribution chain tested; per-form UTM capture not | `lib/services/affiliate/__tests__/attribution-chain.test.ts` | Add per-form attribution assertions to row 39/40. |
| 42 | §34 L1573 | ZIP recorded | PARTIAL | "incomplete submission (no zip) stays SUBMITTED" | `request-progression.test.ts:56`; `docs/plans/BUYER-LOCATION-GAP.md` root cause (no journey path writes buyer location) | Add: every form that collects ZIP persists it on the buyer/request (failing-first per BUYER-LOCATION-GAP §"Test (failing first)" at doc line 296). |
| 43 | §34 L1573 | Consent recorded | PARTIAL | SMS consent-basis and suppression tested; per-form consent capture not | `lib/services/sms/__tests__/consent-basis-gate.test.ts`; `lib/services/notifications/__tests__/contact-sms-consent.test.ts` | Add consent persistence assertions per form in row 39. |
| 44 | §34 L1573 | No duplicate buyer, no second open request | PARTIAL | Phone-keyed mutation guard and dedup fail-closed exist; "second open request" not tested | `lib/services/acquisition/__tests__/no-phone-keyed-buyer-mutation.test.ts`; `lib/services/__tests__/contact-dedup-fail-closed.test.ts`; `lib/services/acquisition/__tests__/promote-opportunity.test.ts` | Add: same email/phone submitting twice → one buyer, one open request (second submission attaches). |

### B4. Passing condition (§34 L1575)

| # | spec_ref | Requirement | Status | Current | Evidence | Required change |
|---|---|---|---|---|---|---|
| 45 | §34 L1575 | Buyer portal, dealership portal and Operations queue show the same current checkpoint, responsible party, deadline and recovery action against one lineage | MISSING | No shared checkpoint DTO or test; buyer journey tests exist only for the buyer stage machine | 0 tests match `checkpoint|responsible.?party|recovery.?action`; `lib/services/buyer/__tests__/journey.test.ts:60` (buyer-only) | Add a single "transaction status" DTO test (`lib/services/deal/__tests__/transaction-status-parity.test.ts`) asserting buyer/dealer/admin projections derive from one function; Playwright parity check across three portals once auth stubs exist. |

### B5. Quality-gate / harness rows (this area's own controls, governed by CLAUDE.md pipeline + skills)

| # | spec_ref | Requirement | Status | Current | Evidence | Required change |
|---|---|---|---|---|---|---|
| 46 | CLAUDE.md "Commands" / skills | `test:all` is the full matrix of **26** suites | BROKEN (documentation) | 65 scripts chained; 72 `test*` total | package.json `test:all`; `lib.mjs:40-46`; `lib.test.mjs` "runs all 26 unit suites"; SKILL.md "Runs all 26 suites (315 assertions…)" | Update CLAUDE.md, the three skills and hook comments/test to say "every `test:*` suite (65 today)" or derive the count from package.json. |
| 47 | skill quality-gates | Every test file reachable from a `test:*` script | ALREADY CORRECT | `scripts/check-test-coverage.ts` | Observed: `test files found: 360 / reachable via scripts: 360 / OK` | Preserve. Note it ignores `*.itest.ts` and `*.spec.ts` (`check-test-coverage.ts:44`). |
| 48 | skill quality-gates | CI runs typecheck → lint → coverage-check → `test:all` → build | ALREADY CORRECT | `.github/workflows/ci.yml:51-75` | quoted above | — |
| 49 | supabase-postgres skill | Migration chain replay from empty DB + drift ratchet + CRM runbook | ALREADY CORRECT | `ci.yml:95-196`; `scripts/check-migration-drift.ts`; `prisma/drift-baseline.json` (`structuralStatements: 345`) | `ci.yml:158-165` apply twice; `:172-173` drift | — (stronger safeguard; preserve) |
| 50 | skill quality-gates | Playwright E2E for buyer + dealer critical paths stays green | PARTIAL | Only `dealer-outreach.spec.ts` runs in CI; buyer/dealer/affiliate specs need Supabase auth and self-skip | `ci.yml:203-208`; `tests/e2e/buyer-remediation.spec.ts:20-21` | Stand up a Supabase-auth stub or JWT-minting equivalent for buyer/dealer (as done for admin) and widen the `e2e` job. |
| 51 | skill quality-gates | Public UI change → visual snapshot | ALREADY CORRECT (marketing tier) | see A2 | `visual.yml:24-31` path filter | Dashboard tier baseline absent (needs `VISUAL_STORAGE_STATE`). |
| 52 | code-verification skill | Stop hook enforces the loop | ALREADY CORRECT | see A4 | `lib.mjs:211-268`; 37/37 hook tests | Update the "26" comment; consider requiring `test:concurrency` with a real DSN when `lib/services/deal/select-offer*` changes. |
| 53 | quality-gates skill | Real-DB concurrency proofs run somewhere | BROKEN in CI | Both DB-gated tests skip under the placeholder DSN; `test:integration` is not in CI at all | `select-offer-concurrency.test.ts:11-15` "Not part of `pnpm test:all` (which runs against a placeholder DSN)"; `ci.yml:69-72` | Add a CI job step (postgres service) running `pnpm test:concurrency` and `pnpm test:integration` with `DATABASE_URL=…/autolenis_e2e`. |
| 54 | "master §11" (assignment) | Test-level policy from the master prompt | UNVERIFIED | The "master prompt" is not in the repository; only references to it in `docs/transaction-flow/IMPLEMENTATION-WORKFLOW.md:23,32` | — | Owner to supply the master §11 text. |

---

## Part C — The §29 safeguards: proving test file or NONE

The Markdown §29 (lines 1438-1463) lists **20** bullets (the HTML SAFE block splits them into 22; the assignment said 18). Mapping every Markdown bullet:

| # | §29 bullet (L1442-1462) | Proving test file(s) | Evidence | Status |
|---|---|---|---|---|
| S1 | FCRA consent persisted before the MicroBilt pull; duplicate paid pulls claimed safely | `lib/services/prequal/__tests__/prequal-decisioning.test.ts` (consent fixture `:134 fcraConsent: true`); claim path `claimPrequalPull` at `lib/services/prequal/prequal.service.ts:215-279` | No test names the in-flight/duplicate claim outcome ("inflight") — grep `test\(.*(claim|duplicate)` in prequal tests returns nothing | PARTIAL — add a failing-first test for concurrent pull → one MicroBilt call |
| S2 | No SSN required; OFAC fails closed on positive or indeterminate | `prequal-decisioning.test.ts:162` "INDETERMINATE OFAC (null) on an APPROVED result ⇒ NEVER persisted APPROVED (fail-closed)"; `:170` "OFAC hit (true) ⇒ OFAC_REVIEW"; `prequal-provider-failure.test.ts:236,275`; `microbilt-config-and-payload.test.ts` (payload shape) | — | PROVEN |
| S3 | Adverse-action delivery distinguishes sent, duplicate, failed | Code: `lib/services/prequal/admin-prequal.service.ts:665-668` (`ADVERSE_ACTION_NOTICE_SENT / _SUPPRESSED_DUPLICATE / _SEND_FAILED`); tests assert only SENT (`prequal-decisioning.test.ts:124,186`) | duplicate/failed outcomes not asserted | PARTIAL |
| S4 | Stripe is the authority; provider-side duplicate-charge checks on deposit and Premium fee | `lib/services/payment/__tests__/payment-confirmation.test.ts:102` "a locally-recorded PAID can never substitute for provider evidence"; `app/api/buyer/deposit/__tests__/create-intent-duplicate-charge.test.ts:151`; `lib/services/deal/__tests__/service-fee-duplicate-charge.test.ts:97,115,145` | fee check is on the concierge fee PI, not a "$400 Premium fee" | PROVEN (for current fee model) |
| S5 | Deposit transitions guarded by a state matrix; unroutable successful payments raise an Operations exception | `lib/payments/__tests__/deposit-state.test.ts:13-39`; `app/api/webhooks/__tests__/stripe-delivery-observability.test.ts:198,225,251` | — | PROVEN |
| S6 | Auction close atomic claim; reprocess closed auctions with unfinished side effects | `lib/services/auction/__tests__/auction-close-idempotency.test.ts:14,19,25,31` | — | PROVEN |
| S7 | Anti-snipe with hard cap and full audit | `lib/services/auction/__tests__/anti-snipe.test.ts:49` "…logs ANTI_SNIPE"; `:70` "does not extend past the cap"; `:89` atomic guard | — | PROVEN |
| S8 | Offer selection serialized under a DB lock | `lib/services/deal/__tests__/destructive/select-offer-concurrency.test.ts:23` — **skips without a real DB** | `:25` `skip: "no real DATABASE_URL — REQUIRES LIVE INFRASTRUCTURE"` | PROVEN only when run against Postgres; NOT VERIFIED in CI |
| S9 | Offer arithmetic and approved budget checked server-side | Arithmetic: `lib/services/offer/__tests__/otd-truthfulness.test.ts:13-66`; budget: **NONE** (code `offer.service.ts:39`) | — | PARTIAL |
| S10 | Best Price rankings persisted with weights and results | **NONE** (code `lib/services/offer/best-price.service.ts:112` `bestPriceCalculationLog.create`) | `rg best-?price --glob '*.test.ts'` → only unrelated AMIPS files | NONE |
| S11 | Deal transitions: legal table, CAS, history, exactly-once completion | `lib/services/deal/__tests__/deal-state-machine.test.ts:13-74`; `advance-deal-status.test.ts:96,106,112,139`; `cancel-deal-seam.test.ts:119,183` "deal.status has exactly ONE writer" | — | PROVEN |
| S12 | Contract uploads private, dealer-owned, versioned create-before-supersede, fail closed on extraction/scan failure | `app/api/dealer/contracts/__tests__/upload-completes-pipeline.test.ts:121,131,140`; `lib/services/contract-shield/__tests__/admin-approve-signable.test.ts:245,265`; `contract-document-ref.test.ts:66` (SSRF); scan/extraction-failure fail-closed: not found by name | — | PARTIAL (extraction/scan-failure case not named) |
| S13 | Approval binds to the reviewed version; rejects upload-during-review races | `admin-approve-signable.test.ts:141,163,278`; `app/api/admin/contract-shield/__tests__/approve-binds-to-reviewed-version.test.ts:159,172` | — | PROVEN |
| S14 | E-sign binds envelope to document bytes by hash; refuses to sign when evidence storage unavailable | `lib/services/esign/__tests__/buyer-signing.test.ts:240` "prepare binds the approved contract by hash"; `:295` "document mutation after prepare invalidates: VOIDED"; `:540` frozen evidence + hash; evidence-storage-unavailable refusal: not found by name | — | PARTIAL |
| S15 | Pickup negotiation: strict turn-taking, proposal-time CAS, two-counter cap, compensating recovery | `lib/services/pickup/__tests__/pickup-coordination.test.ts:163,205,255,277,298` | — | PROVEN |
| S16 | Pickup emails dispatch durably with round-specific idempotency keys | Code: `lib/services/pickup/pickup-notifications.service.ts:117,151,228,262` (`pickup-proposed-${dealId}-${roundKey(p)}`); tests: `pickup-coordination.test.ts:220-` asserts notifications fire; no test asserts the round-keyed idempotency key string | — | PARTIAL |
| S17 | Refund execution idempotency-keyed; never labels a no-charge record as refunded | `lib/services/payment/__tests__/refund-deposit-charge.test.ts:53,61,69,77,84`; `app/api/admin/payments/__tests__/deposit-refund-route.test.ts:92,104,144` | — | PROVEN |
| S18 | Identity firewall between buyer and non-winning dealerships | `lib/services/auction/__tests__/dealer-invitation-pii.test.ts:104,118`; `lib/services/notifications/__tests__/dealer-award.test.ts:99` "no buyer PII leaks: only first name + last initial reach the winner"; `dealer-award.dispatch.test.ts:147`; `lib/services/esign/__tests__/esign-dto.test.ts:67` | — | PROVEN |
| S19 | Anti-circumvention monitoring with pattern capture and Operations routing | **NONE** (code `lib/services/trust/anti-circumvention.service.ts`, `app/api/cron/trust-check/route.ts`) | `rg -l 'anti-circumvention|trust-check' --glob '*.test.ts'` → empty | NONE |
| S20 | Junk-fee patterns, fee caps, APR validation, payment packing, disclosure checks in Contract Shield | **NONE against the real engine** — every test mocks `contract-shield.service` (`admin-approve-signable.test.ts:97 mock.module(...)`); code `lib/services/contract-shield/contract-shield.service.ts:30,70,145` | `rg "from \"@/lib/services/contract-shield/contract-shield.service\"" --glob '*.test.ts'` → empty | NONE |

Dealer scorecard consequences (HTML SAFE "Marketplace integrity" bullet 3; not a Markdown §29 bullet): **NONE** — `rg dealer-scorecard --glob '*.test.ts'` empty; code `lib/services/dealer/dealer-scorecard.service.ts`.

---

## Part D — Recommended test level per spec area (nearest existing dir + script to extend)

| Spec area | Level | Extend this `__tests__` dir | Script |
|---|---|---|---|
| Public forms → lanes, attribution, ZIP, consent, dedup | unit (intake) + Playwright (form walk) | `lib/services/acquisition/__tests__`, `app/api/public/request/__tests__`; new `tests/e2e/public-forms.spec.ts` | `test:intake`, `test:precheckout`, `test:e2e` |
| Vehicle request progression / pre-payment gating | state-machine | `lib/services/vehicle-request/__tests__` | `test:vehicle-request` |
| $99 deposit, Premium $400, credits, refunds, reconciliation | unit + webhook replay + concurrency | `lib/services/payment/__tests__`, `app/api/buyer/deposit/__tests__`, `app/api/admin/payments/__tests__`, `app/api/webhooks/__tests__`, `lib/payments/__tests__` | `test:admin-payments`, `test:webhooks`, `test:payments` |
| Plan upgrade/downgrade entry points | unit (route) + email template | `app/api/buyer/plan/__tests__`, `lib/services/email/__tests__` | `test:buyer-plan`, `test:email` |
| Sourcing bands, 250-mile authorization, limited auction approval | unit + state-machine | `lib/services/auction/__tests__` (coverage), `lib/services/shortlist/__tests__` | `test` (auction), `test:shortlist` |
| Auction close, zero offers, anti-snipe, offer budget/arithmetic, Best Price persistence | unit + concurrency | `lib/services/auction/__tests__`, `lib/services/offer/__tests__` | `test`, `test:offer` |
| Offer selection single winner | concurrency (real Postgres) | `lib/services/deal/__tests__/destructive/select-offer-concurrency.test.ts` | `test:concurrency` (needs CI DB job) |
| Deal checkpoints, financing verification, cash path, cancellation pre/post execution | state-machine + authz | `lib/services/deal/__tests__`, `lib/services/financing/__tests__`, `app/api/admin/deals/__tests__` | `test`, `test:financing`, `test:admin-deals` |
| Insurance rejection | unit (route) | `app/api/buyer/insurance/__tests__` | `test:buyer-insurance` |
| Contract Shield rule engine + mismatch | unit against the real service (no mock) | `lib/services/contract-shield/__tests__` | `test:contract-shield` |
| E-sign expiry/reissue, co-buyer, evidence storage refusal | unit + state-machine | `lib/services/esign/__tests__` | `test:esign` |
| Pickup identity mismatch, delivery discrepancy, concurrent completion | unit + concurrency | `lib/services/pickup/__tests__`, `app/api/dealer/pickup/__tests__` | `test:pickup`, `test:concurrency` |
| Trade-in lien / payoff good-through / surrender | unit (new dir) | new `lib/services/trade-in/__tests__` | new `test:trade-in` (add to `test:all`) |
| Reaffirmation timeout, hold expiry, dealer never executes, anti-circumvention, scorecard consequences | cron route + service | `app/api/cron/__tests__` (pattern `*-route.test.ts`), `lib/services/dealer/__tests__` | `test:cron`, `test:dealer` |
| Three-portal parity (checkpoint/party/deadline/recovery) | unit (DTO) then Playwright | `lib/services/deal/__tests__`; `tests/e2e` | `test`, `test:e2e` |
| Scenarios A–D | integration (real Postgres, mocked vendors) | new `tests/scenarios/*.itest.ts` following `tests/integration/dealer-funnel.itest.ts` DSN-guard pattern | new `test:scenarios`, CI job reusing the postgres service |

---

## Duplicates

- No duplicate test harnesses (single runner `node:test`+`tsx`; Playwright for browser). Three Playwright configs are intentional, not duplicates (`playwright.e2e.config.ts:3-10` explains the split).
- **Two Playwright E2E roots**: `e2e/` (`playwright.config.ts`, boots the app) and `tests/e2e/` (`playwright.e2e.config.ts`, expects a running app). Both exist for different reasons; recommend consolidating to one root before adding the form-walk suite.
- Dealer-award notification is tested at two seams (`lib/services/notifications/__tests__/dealer-award*.test.ts` and `lib/services/deal/__tests__/dealer-award-dispatch.test.ts`) — complementary (plan vs dispatch), not duplicate.

## Stronger safeguards to preserve

- Reachability guard (`scripts/check-test-coverage.ts`) — fails the build on orphaned tests; CI step `ci.yml:60-61`.
- Migration chain from-zero replay twice + drift ratchet at 345 + CRM runbook twice (`ci.yml:95-196`, `prisma/drift-baseline.json`).
- DSN guard `/autolenis_e2e/` in every DB-touching spec, the integration tests and `scripts/e2e-admin-storage-state.ts` — makes pointing E2E at production a refusal, not a risk.
- CI E2E runs with no vendor credentials at all (`ci.yml:245-246`), and the outreach spec asserts the `dealer_outreach_log` gate row, not browser-side interceptors (`dealer-outreach.spec.ts:14-30`).
- Specs skip with explicit reasons rather than pass vacuously (`buyer-remediation.spec.ts:9-12`).
- `e2e/deal-autopilot.spec.ts` refuses to forge a session; reports the authenticated happy path as NOT VERIFIED (lines 14-20).
- Visual harness triple gate (pixel + text + metadata) and baseline pinned to the CI image (`tests/visual/README.md`).
- Stop hook: anchored command matching, quoted-string safe, interrupted run = fail, failure never laundered into pass (`lib.mjs:90-156`, `track.mjs:52-55`).
- `no-inhouse-financing-on-auction-spine.test.ts` structurally forbids in-house lender decisioning on the auction→offer→Deal spine (matches the spec's "financing happens entirely outside AutoLenis").
- `buyer-cannot-self-approve.test.ts` / `buyer-route-surface.test.ts` scan source to keep `scanContract` off buyer routes.
- `cron-proven-alive.test.ts` asserts crons write `CronJobLog` runs.

## Legacy paths

- `test` (core subset) still exists and is the fast inner loop; `test:all` is the gate — unchanged.
- `test:integration` (`tests/integration/*.itest.ts`) predates the CI DB job and is run by nobody in CI.
- `test:e2e-autopilot` (`e2e/deal-autopilot.spec.ts`) is a second E2E root introduced with the deal-completion autopilot branch; not in CI.
- `lib/services/dealer/__tests__/batch2/` is covered by `test:dealer-onboarding`, not `test:dealer` (glob is top-level only) — intentional but easy to miss.

## Out-of-scope findings (for other areas)

- `upgrade.test.ts:92` codifies "NO charge — free at this stage by product decision" — a product rule opposite to spec §Premium $400 (plan area).
- `shortlist-radius.test.ts:40` codifies a 100-mile provider ceiling — conflicts with the spec's 250-mile authorization (sourcing/inventory area).
- `request-progression.test.ts:66-91` codifies sourcing side effects before payment (intake/sourcing area).
- `service-fee.test.ts:63` codifies a $499/$99/$400 fee row for every deal (payments area).
- `deposit-settlement.test.ts:131` codifies that settlement is OFF by default — the reconciliation the spec relies on is env-gated (payments/ops area).
- Financing tests exercise an in-house lender adapter (`lender-adapter.test.ts`, `credit-application.test.ts`) although the spec says financing is entirely external (financing area).
- The migration-drift ratchet carries 345 structural statements (`prisma/drift-baseline.json`) — a known, pinned schema/chain divergence (database area).
- CLAUDE.md, skills and hook comments say "26 suites"; actual is 65 (documentation).

## UNVERIFIED items

- Whether `pnpm test:all`, `pnpm typecheck`, `pnpm lint`, `pnpm build` are green at HEAD — not run (forbidden).
- Whether the visual baseline matches a fresh render — not run; README says only CI is meaningful.
- Whether `test:concurrency` / `test:integration` / `tests/e2e/*` pass against a real `autolenis_e2e` database — no DB here.
- Whether recent GitHub Actions runs are green — I did not call the GitHub MCP (prohibited); only workflow files were read.
- The "master §11" test policy — the master prompt is not in the repository.
- Whether `RADIUS_TIERS` in `coverage.test.ts` is the spec's "sourcing bands".
- S12 extraction/scan-failure fail-closed and S14 evidence-storage-unavailable refusal — code may exist, but no test names them; I did not trace the service internals for these two clauses.

## Open questions for the owner

1. Should the four scenarios be a Playwright suite (needs a Supabase-auth stub for buyer/dealer) or a node:test integration suite against real Postgres with mocked vendors (runnable in the existing `migrations` CI container today)? Recommendation: the latter first.
2. Is the shortlist 100-mile provider ceiling (`shortlist-radius.test.ts:40`) meant to coexist with the 250-mile authorization rule, or is 250 the new ceiling?
3. The spec's "18 safeguards" vs Markdown §29's 20 bullets vs HTML SAFE's 22 — which list is canonical for the acceptance sign-off?
4. Should `test:coverage-check` be extended to `*.itest.ts` and `*.spec.ts` so Playwright/integration specs cannot become orphans?
5. Should the Stop hook require `pnpm test:visual` on `app/(public)/**` changes when no `VISUAL_BASE_URL` instance exists (today it blocks until the check "runs", and a local run is non-authoritative)?
6. Where should the "master §11" text live in the repo so it can be cited?

---

## Verification corrections (adversarial pass)

Second, independent pass at HEAD 0cd399f. Every cited line in Parts A–C was re-opened; every MISSING row was re-searched under ≥3 alternative names across `app`, `lib`, `components`, `prisma` (schema, `migrations/`, `manual_supabase_sql/`) and `scripts`; every ALREADY CORRECT row was probed for the branch that makes it PARTIAL. The only executable check run was a pure-function probe of the Stop hook's classifier (`node -e` importing `.claude/hooks/verification/lib.mjs`); no repository file was modified. Line quotes in Parts A–C were confirmed verbatim unless listed below. Format: spec_ref | original → corrected | reason | evidence.

### Corrections to existing rows

1. **Rows 14–45 spec_ref line numbers** | `§34 L1571 / L1573 / L1575` → **`§34 L1572 / L1574 / L1576`** | The branch sentence, the form-walk paragraph and the passing condition sit one line lower than cited (the Markdown table ends at L1570 and a blank line follows). Statuses unchanged. | `docs/transaction-flow/AUTOLENIS-COMPLETE-TRANSACTION-FLOW.md:1572` "For every scenario, also exercise:"; `:1574` "**Additionally, every form on the website must be walked**"; `:1576` "**The test passes only when…"

2. **Row 52 — Stop hook enforces the loop** | ALREADY CORRECT → **BROKEN (parser) / PARTIAL (gate)** | The hook's pass/fail parser takes the *first* `# fail N` line in the tool output. `pnpm test:all` chains 65 `node:test` suites, so when suite 1 prints `# fail 0` and a later suite fails, the run is classified **pass**. Probe: `classifyOutcome("test:all", "…# fail 0…# fail 2… ELIFECYCLE Command failed")` → `"pass"`. The exit code is never consulted, and the hook self-test only covers single-suite output. Separately, an empty-output run classifies `unknown`, which the gate treats as "ran" (codified by test), so `pnpm test:all >/dev/null 2>&1` satisfies the gate. The gate is therefore a floor with a hole in it for exactly the check it calls "the gate". | `.claude/hooks/verification/lib.mjs:168` `const nodeFail = text.match(/^# fail (\d+)$/m);` (no `g` flag, first match wins); `:169` `return Number(nodeFail[1]) > 0 ? 'fail' : 'pass';`; `track.mjs:49-51` (only `interrupted` overrides; no `exit_code`); `__tests__/lib.test.mjs:123-125` (single-suite fixtures only); `:216` "unknown-outcome runs satisfy the gate — only explicit failure blocks". **Required change:** classify a `test*` run as fail if *any* `# fail N>0` line appears (`matchAll`) or if the response carries a non-zero exit / `ELIFECYCLE` marker; add a multi-suite fixture to `lib.test.mjs`; treat `unknown` for `test:all` as not-run.

3. **Row 53 — real-DB concurrency proofs run somewhere** | BROKEN in CI → **RESOLVED**. The old arrangement was a genuine safety hazard: `select-offer-concurrency.test.ts` was reachable from `test:all`, which CI runs with `secrets.DATABASE_URL \|\| placeholder`, and whether that secret pointed at a throw-away database could not be established. It no longer receives that secret at all. The suite runs in the e2e job against `postgresql://autolenis_ci@localhost:5432/autolenis_e2e` — a service container destroyed with the runner — with `CI: "true"` so a refused target fails rather than skips. Two regression tests keep it there: one expands every glob reachable from `test:all` and asserts the file is in none of them, the other asserts exactly one workflow step runs it. Both are tamper-verified. |
   - **Consequential correction to "Stronger safeguards to preserve":** "DSN guard `/autolenis_e2e/` in every DB-touching spec" is **false** — it holds for `tests/e2e/*`, `tests/integration/*.itest.ts` and the storage-state script (all re-verified: `dealer-funnel.spec.ts:23`, `dealer-outreach.spec.ts:43,50`, `affiliate-portal.spec.ts:35,45`, `dealer-invitation-tokens.itest.ts:37`, `dealer-funnel.itest.ts:22`) but not for `select-offer-concurrency.test.ts`.

4. **Row 27 — signature expiry and reissue** | PARTIAL → **ALREADY CORRECT (unit)** | Reissue after EXPIRED *is* tested: the terminal-state loop covers `EXPIRED` explicitly, asserts the expired record is archived as attempt 1 with its own hash, and that the new attempt is SENT, numbered 2, and re-bound to the current approved document hash. The row's "not explicitly" was wrong. | `lib/services/esign/__tests__/buyer-signing.test.ts:405` `for (const terminal of ["VOIDED", "DECLINED", "EXPIRED"])`; `:406` "prepare on a ${terminal} record archives it immutably and starts a DISTINCT new attempt"; `:429` `attemptNumber, 2, "a distinct new attempt"`; `:431` `"re-bound to the current approved document"`. Remaining gap (keep as note): no test that the *old* row cannot be signed after reissue beyond `:356` (TTL) — minor.

5. **Row 47 — every test file reachable from a `test:*` script** | ALREADY CORRECT → **PARTIAL** | `check-test-coverage.ts` iterates every `package.json` script whose *name starts with `test`* and asks whether each `*.test.ts(x)` is covered by *any* of them; it never checks membership in `test:all` — the string `test:all` appears only in its error message. A new `test:foo` script that is never chained into `test:all` passes the guard while never running in CI. The skill text and IMPLEMENTATION-WORKFLOW §12.1 ("reachable from a `test:*` script **and from `test:all`** (`test:coverage-check` fails otherwise)") over-state what the guard enforces. | `frontend/scripts/check-test-coverage.ts:95-96` `for (const [name, script] of Object.entries(pkg.scripts)) { if (!name.startsWith("test")) continue;`; `:115` (message only) "…and include it in test:all."; `:44` `/\.test\.tsx?$/` (itest/spec excluded). **Required change:** parse the `test:all` chain and fail if any `test:*` script that targets `*.test.ts` is absent from it (and optionally recognise `*.itest.ts`/`*.spec.ts` with an explicit allow-list).

6. **Row 19 — zero offers** | PARTIAL (evidence corrected) | The zero-offers-at-close buyer path **exists in code** and is partly tested at the ops seam; the row said only the zero-*invitation* close was tested. `processAuctionClose`'s `else` branch creates a buyer notification with a recovery action and explicitly never auto-refunds; the ops-exception side is asserted. The buyer-notification body/recovery text and the deposit disposition on a *zero-offer* (not zero-dealer) close remain untested. Also flag: the header comment of `auction-close-idempotency.test.ts` still refers to a "zero-offer refund" that the service says never happens — a stale comment that would mislead a test author. | `lib/services/auction/auction.service.ts:169-172` "NO AUTO-REFUND … retained"; `:178` `title: "Auction closed — no offers received"`; `lib/services/auction/__tests__/deposit-activation-exception.test.ts:78` "no-dealer close raises an ops-only SYSTEM_ALERT (no buyerId, no auto-refund)"; `lib/services/auction/__tests__/auction-close-idempotency.test.ts:8` "never double-notify the buyer or double-issue the zero-offer refund."

7. **Row 12 — `NOT_REQUIRED_CASH`** | MISSING (kept) — **required change corrected** | The literal enum value is absent, but the cash concept already exists in three places and must be *extended*, not re-created: `FinancingScenarioType.CASH_PURCHASE`, buyer request `paymentMethod: "CASH"`, and the derived `CASH_BUYER` intake classification. `FinancingStatus` has no not-required value. | `prisma/schema.prisma:1853` `CASH_PURCHASE`; `:1711-1716` `enum FinancingStatus { PENDING SELECTED APPROVED DECLINED }`; `app/api/buyer/requests/route.ts:74` `paymentMethod: z.enum([… "CASH" …])`; `lib/services/vehicle-request/car-request-financing.service.ts:132` `if (financing.paymentMethod === "CASH") return "CASH_BUYER";`. **Required change:** add `NOT_REQUIRED_CASH` to `FinancingStatus` (migration) and derive it from the existing `paymentMethod === "CASH"` signal; test at `lib/services/financing/__tests__` + `deal-state-machine.test.ts`.

8. **Row 29 — blocked handover on identity mismatch** | MISSING (kept) — **note added** | Two identity enums already exist and are unused by any runtime code (`rg` over `app`, `lib`, `components` → zero usages): `AntiCircumventionFlag.IDENTITY_MISMATCH` and `IdentityVerificationStatus {PENDING, VERIFIED, FAILED}`. The pickup scan route has no identity step. Reuse these rather than adding a new enum. | `prisma/schema.prisma:1946` `IDENTITY_MISMATCH`; `:1950-1954` `enum IdentityVerificationStatus`; `app/api/dealer/pickup/__tests__/scan-route.test.ts:146` (wrong-dealer only).

9. **Row 39 — every website form walked** | MISSING (kept) — **evidence corrected** | "No Playwright spec submits a public form" is imprecise: `dealer-funnel.spec.ts` does fill and submit forms (dealer claim password, dealer sign-in, manual inventory add, CSV import) — but these are **authenticated dealer-portal** forms, not the public *dealer application* the spec lists, and the spec is not in CI. No form in the §34 list (homepage … support) is walked by any spec. | `tests/e2e/dealer-funnel.spec.ts:33-37` `/dealer/claim?token=…` + `fill("E2ePassw0rd!")`; `:76-78` `/dealer/sign-in` email/password; `:113-118` `/dealer/inventory/add` VIN/year/make/model/price; `.github/workflows/ci.yml:300` (only `dealer-outreach.spec.ts` runs).

10. **Row S20 — Contract Shield rule engine** | NONE (kept) — **claim corrected** | "Every test mocks `contract-shield.service`" is wrong as stated: `contract-auto-approve.test.ts` imports the **real** module (mocking prisma, deal.service and buyer-signing) — but every case exercises `planContractAutoAdvance` / `autoAdvanceContractOnPass`, never `scanContract`; the other two hits are source-text inspections. The conclusion — the JUNK_FEE_KEYWORD / DOC_FEE_CAP / APR / packing / disclosure rules have no executing test — stands. | `lib/services/contract-shield/__tests__/contract-auto-approve.test.ts:78` `await import("@/lib/services/contract-shield/contract-shield.service")`; `:101-199` test titles all `planContractAutoAdvance:` / `autoAdvanceContractOnPass:`; `buyer-cannot-self-approve.test.ts:64-71` (readFileSync source scan); `buyer-route-surface.test.ts:68,85` (regex over source).

11. **Row 5 — financing completed and verified by authorized staff** | PARTIAL (kept) — **evidence strengthened** | Staff-only resolution of a financing review *is* tested at the route (403 without an operational role; adminId + decision forwarded), which the row omitted; what is still absent is a "financing verified" state — `DealStatus` goes `FINANCING_PENDING → FEE_PENDING` with no verified checkpoint and `FinancingStatus` has no `VERIFIED`. | `app/api/admin/financing-reviews/__tests__/resolve-route.test.ts:51` "403 when the admin lacks an operational role"; `:62` "resolves and forwards adminId + decision to the service"; `prisma/schema.prisma:1516-1517` `FINANCING_PENDING FEE_PENDING`; `:1711-1716`.

12. **Row 25 — insurance rejection** | PARTIAL (kept) — **required change corrected** | `InsuranceStatus` has `FAILED` but no `REJECTED`; no test names the `FAILED` path either (the only "reject" hits in the insurance tests are an authz check and a shortlist check). The required change must reuse `FAILED` or add `REJECTED` by migration — not invent a parallel status. | `prisma/schema.prisma:1493-1501` `enum InsuranceStatus { NOT_STARTED … VERIFIED FAILED`; `app/api/buyer/insurance/__tests__/request-quote.test.ts:116`; `upload-proof-gate.test.ts:156` (both unrelated to rejection).

13. **Row 34 — upgrade from post-acceptance invitation / each email / dashboard** | MISSING tests (kept) — **current implementation corrected from "—"** | Dashboard-style entry points exist in code (a `PlanUpgradeCard` rendered on dashboard, deal-payment, billing and profile pages); **no email template contains an upgrade CTA** (the only "upgrade" hit under `lib/services/email` is an unrelated suppression-tier test); no post-acceptance invitation surface. | `components/buyer/PlanUpgradeCard.tsx`; `app/buyer/dashboard/page.tsx`; `app/buyer/deal/payment/page.tsx`; `app/buyer/billing/page.tsx`; `app/buyer/profile/page.tsx`; `lib/services/email/__tests__/suppression-tier.test.ts` (only hit).

14. **Row 36 — Premium→Standard downgrade** | MISSING (confirmed) | `app/api/buyer/plan/` contains only `upgrade/` and `__tests__/`; every `downgrade` hit in the tree is an unrelated "never-downgrade" scoring rule. | `ls app/api/buyer/plan` → `__tests__ upgrade`; `lib/events/lifecycle-advance.ts:8`, `lib/services/dealer/dealer-contact-profile.service.ts:37` (unrelated).

15. **Row 44 — no duplicate buyer, no second open request** | PARTIAL (kept) — **sub-clause downgraded to MISSING in code** | The "second open request" half has no guard anywhere in the intake/request write paths (searched `open request|one open|existing open|already has an (open|active)|duplicate` across `lib/services/acquisition/*.ts`, `lib/services/vehicle-request/*.ts`, `app/api/buyer/requests/route.ts` → zero hits); IMPLEMENTATION-WORKFLOW plans a partial unique index for it. So the required test is failing-first against code that does not exist yet. | `docs/transaction-flow/IMPLEMENTATION-WORKFLOW.md` §5 table row `vehicle_requests` "**partial unique index** enforcing one open request per buyer (predicate in §8 Phase 1)".

16. **Row 54 — "master §11" test policy** | UNVERIFIED → **PARTIAL (documentation)** | The master prompt is indeed not in the repo, but the repo *does* carry the test-level policy as `IMPLEMENTATION-WORKFLOW.md` **§12** (12.1 test levels, 12.2 gates, 12.3 preview-isolation preflight, 12.4 Playwright scope). Its Part 0 promises a **§11 coverage reconciliation**, but no `## §11` heading exists (only §1–§8 and §12 at read time — the file is under active edit by the parent session, so line numbers shift). §12.1's reachability claim is over-stated (see correction 5). | `docs/transaction-flow/IMPLEMENTATION-WORKFLOW.md:29-33` (Part 0 promises §11/§12); `grep '^## §'` → §1…§8, §12 only; §12 heading observed at line 820.

17. **Row 46 — "26 suites"** | BROKEN (documentation) (confirmed, one more location) | Re-computed from `package.json`: 72 `test*` scripts, `test:all` chains 65, none undefined, none duplicated, 6 outside the chain (`test:integration`, `test:coverage-check`, `test:e2e-autopilot`, `test:visual`, `test:visual:update`, `test:e2e`). Add `autolenis-production-readiness/SKILL.md:112` ("test:all PASS 15 suites, 295 assertions") to the stale list. | `.claude/skills/autolenis-production-readiness/SKILL.md:112`; `.claude/skills/autolenis-testing-quality-gates/SKILL.md:50`; `.claude/skills/autolenis-code-verification/SKILL.md:95`; `.claude/hooks/verification/lib.mjs:40,46`; `__tests__/lib.test.mjs:48`.

18. **Part A3 / Legacy paths — `playwright.config.ts`** | note added | Its header says "Run: pnpm test:e2e" but that script runs the *other* config; the autopilot root is `test:e2e-autopilot`. A reader following the file comment runs the wrong suite. | `frontend/playwright.config.ts:13` "// Run: pnpm test:e2e   (requires DATABASE_URL)"; `package.json` `test:e2e-autopilot: playwright test --config playwright.config.ts`.

19. **Part A4 — hook `test:visual` trigger** | note added | The visual check is demanded for **any** `components/**/*.tsx` edit (admin, dealer, affiliate components included), not only public UI — over-broad relative to the skill's "public UI" rule but a stronger safeguard to preserve; combined with correction 2, an empty-output `pnpm test:visual` satisfies it. | `.claude/hooks/verification/lib.mjs:50` `when: (f) => /app\/\(public\)\/|components\/.*\.tsx$/.test(f)`.

20. **Rows 3 / 11 — sourcing before payment** | BROKEN (kept) — **note added** | The progression service's own header declares a "deposit-first model, locked with the owner", yet the test suite advances SUBMITTED → ACTIVE_SOURCING with no deposit in the fixture. Whether the service checks a PAID deposit at runtime was not traced here (UNVERIFIED); the test-level finding (no deposit precondition asserted; side effects fire) stands. | `lib/services/vehicle-request/request-progression.service.ts:9` "// Scope boundary (deposit-first model, locked with the owner):"; `__tests__/request-progression.test.ts:66,84,91`.

### Rows re-verified with no change

Rows 1, 2, 4, 6, 7, 8, 9, 10, 13, 14, 15, 16, 17, 18, 20, 21, 22, 23, 24, 26, 28, 30, 31, 32, 33, 35, 37, 38, 40, 41, 42, 43, 45, 48, 49, 50, 51 — every cited line re-opened and matched verbatim; every MISSING row re-searched (concierge assignment: `assignConcierge|concierge_?assign|conciergeUserId|OperationsAssignment` → 0; checkpoint → only `VehicleRequestDueDiligenceCheckpoint`; co-buyer → boolean only at `request-vehicle/route.ts:106`, `RequestVehicleFormClient.tsx:309`; payoff good-through: `goodThrough|good_through|payoffExpir|payoffValid|payoffQuote|lienholder` → 0; surrender/obligation → marketing copy only; limited auction/ops approval → 0; reaffirm/confirmAvailability → 0; material change/amendment → 0; hold expiry `holdExpir|VEHICLE_HOLD|holdUntil|hold_until` → 0; discrepancy → marketing copy only; suppressed prompt → 0; plan revert → 0; dealer-execution SLA → 0; `manual_supabase_sql/` and `migrations/` → 0 for all of the above). Row 8 confirmed: the webhook's concierge branches (`concierge_deposit`, `concierge_fee`) belong to the separate concierge product (`app/api/webhooks/stripe/route.ts:31,345`), not Premium settlement. Row 20 confirmed: `lib/services/offer/__tests__/` holds only `otd-truthfulness.test.ts`. Row 13 confirmed: `lib/services/trade-in/` holds only `trade-in.service.ts`, no tests. Row 49: `prisma/drift-baseline.json:2` `"structuralStatements": 345`. Row 51/A2: 30 baseline files, 5 pages × 2 projects × (png + txt + meta txt), `visual.yml:24-31` path filter, README:85 "Only CI results are meaningful". S1/S3/S16/S19 (no claim/duplicate/failed/idempotency-key/anti-circumvention tests) re-confirmed by grep; S10 (no best-price test outside AMIPS) re-confirmed; dealer-scorecard tests: none (`scorecard` appears in tests only as a fixture field, `dealer-invitation.test.ts:53`).

### Requirements in §34 the map did not cover

| spec_ref | Requirement | Status | Current | Evidence | Required change |
|---|---|---|---|---|---|
| §34 L1563 (second clause) | "…and **every exception in §26** has been exercised" — a §26-row-by-row proof, distinct from the four scenarios | MISSING | Row 1 folds this into the scenario harness; there is no register mapping each §26 exception to a proving test | `docs/…/AUTOLENIS-COMPLETE-TRANSACTION-FLOW.md:1233` `## 26. Exception register`; no test file references §26 ids | Add a `docs/transaction-flow/verification/exception-coverage.md` (or a table in IMPLEMENTATION-WORKFLOW §11) listing every §26 exception → test file:line, and a `test:exceptions` aggregate that runs them |
| §34 L1569 (C, last clause) | "same auction, deal, and pickup path as A" — a custom-request-origin transaction must traverse the identical auction/deal/pickup code path | PARTIAL | Auction→offer→deal→pickup services are shared code (`lib/services/auction`, `deal`, `pickup`), but no test is parameterised on request origin (selected inventory vs custom request); `outside_auction_invites` is a documented parallel path | `docs/transaction-flow/IMPLEMENTATION-WORKFLOW.md` §8.4 "`outside_auction_invites` … parallel offer models"; `lib/services/auction/__tests__/outside-invite.test.ts` (separate path) | Origin-parameterised state-machine tests in `lib/services/deal/__tests__` and `lib/services/pickup/__tests__` asserting identical transitions/events for both origins |
| §34 L1570 (D, first clause) | "Same lineage as C" — a single unbroken lineage from custom request through completion with trade/lien | MISSING | No lineage/`vehicle_request_id` linkage test across deposit → auction → deal → pickup (Deposit has no request FK; trade-in has no deal/request FK) | `prisma/schema.prisma` `model Deposit` (no `vehicleRequestId`); IMPLEMENTATION-WORKFLOW §5 rows `deposits` / `trade_in_submissions` "no `vehicle_request_id`" | After the FKs land, one lineage test that walks the chain by ids and fails on any null link |
| §34 L1568 (B) — Markdown-only clause | "concierge assigned at settlement" appears in the Markdown but not in the HTML `ACCEPT[0][1]` | note (Markdown governs) | see row 8 | `AutoLenis-Transaction-Flow.html:977` (B text omits concierge) | Keep row 8; record the divergence so the HTML is not used as the acceptance checklist |

### Corrected UNVERIFIED list (additions)

- Whether the GitHub secret `DATABASE_URL` is set for this repo (decides whether `test:concurrency` writes to a real database on every CI run) — GitHub not queried by rule.
- Whether `request-progression.service.ts` gates ACTIVE_SOURCING on a PAID deposit at runtime (only the tests were read).
- Line numbers in `IMPLEMENTATION-WORKFLOW.md` — the file changed between two reads in this session (§12 heading moved 777 → 820); cite by heading, not line.
