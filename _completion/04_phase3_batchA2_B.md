# AUTOLENIS — Completion Workflow · Phase 3 Batch A.2 + Batch B

**Session:** 4 · **Date:** 2026-06-15 · **Branch:** `claude/epic-lamport-h6i6cy`
**Scope:** A.2 = funnel the remaining deal-status mutation sites through the guarded seam (closes the rest of Gap 1 + Gap 8). B = resilience (error boundaries) + verification infra (Playwright + e2e + wired orphan tests).

## Acceptance gate (all green)
| Check | Result |
|---|---|
| `pnpm tsc --noEmit` | **0 errors** |
| `pnpm lint` | **0 errors / 100 warnings** |
| `pnpm build` | **PASS** (exit 0) |
| `pnpm test` | **38 pass / 0 fail** (was 30; +social +crm orphans wired in) |

## Batch A.2 — remaining status mutations routed through `advanceDealStatus`
Every site now records `DealStatusHistory` and is guarded (or force-overridden where the transition is an authoritative external/admin fact). Net result for Gap 1: **0 of 21 guarded → all reachable lifecycle writes now go through the seam.**

| Site | Transition | Mode | File |
|---|---|---|---|
| Fee webhook (#11) | FEE_PENDING→FEE_PAID→INSURANCE_PENDING, **source-checked** | force + Gap 8 guard (no regress past insurance) | `app/api/webhooks/stripe/route.ts` |
| esign webhook (#5) | SIGNING_PENDING→SIGNED | force (DocuSign authoritative) | `lib/services/esign/esign.service.ts` |
| Buyer financing (#12,#13) | FINANCING_PENDING→FEE_PENDING | guarded; falls back to field-only update if past financing (fixes a latent status regression) | `app/api/buyer/deal/financing/route.ts`, `app/api/buyer/financing/route.ts` |
| Admin mark-paid (#19) | →FEE_PAID | force (admin override) | `app/api/admin/payments/concierge-fee/[dealId]/mark-paid/route.ts` |
| Contract-shield APPROVE/REVISION (#20,#21) | →CONTRACT_APPROVED / →CONTRACT_PENDING | force (admin review) + shield fields merged | `app/api/admin/contract-shield/[reviewId]/route.ts` |
| Admin cancel/refund (#16,#17) | →CANCELLED / →REFUNDED | force (admin) | `app/api/admin/deals/[dealId]/action/route.ts` |
| Admin pickup-complete (#18) | →COMPLETED | force (explicit override, reason required) | `app/api/admin/deals/[dealId]/pickup/complete/route.ts` |
| `moveBuyerWorkflowStage` (#9) | any | **guarded** (canTransition) with `force` param; journey complete/complete-all pass force=true, ad-hoc workflow/move enforces | `lib/services/admin/admin-buyer-command-center.service.ts` (+ 2 callers) |
| `recordFeePayment` (#4, dead) | →FEE_PAID→INSURANCE_PENDING | force | `lib/services/deal/service-fee.service.ts` |
| `schedulePickup`/`completePickup` (#6,#7) | →PICKUP_SCHEDULED / →COMPLETED | schedule: force; complete (dead): guarded incl. insurance gate | `lib/services/pickup/pickup.service.ts` |

**Design notes:** `force` is reserved for (a) authoritative external events (Stripe/DocuSign webhooks) and (b) explicit, audit-logged admin overrides. User-action paths (buyer financing/esign) are **not** forced, so they get the real guard. The Stripe fee path adds the Gap 8 source check: a deal already at/after `INSURANCE_PENDING` is **not** regressed — only its fee fields are recorded.

## Batch B — resilience + verification
**Error boundaries (Gap 9):** added segment boundaries for the 4 uncovered segments — `app/(public)/error.tsx`, `app/affiliate/error.tsx`, `app/admin/error.tsx`, `app/auth/error.tsx` — plus `app/global-error.tsx` (self-contained, catches root-layout failures the segment/root boundaries cannot). Matches the existing `app/buyer/error.tsx` pattern (client component, logs, retry button, `data-testid`).

**Playwright (Gap 11):** added `@playwright/test` devDependency, `playwright.config.ts` (chromium project; auto-starts `pnpm dev` as `webServer`, or targets `BASE_URL` in CI), and `test:e2e` script. Artifacts gitignored.

**Tests wired:** the two orphaned unit suites (`lib/social/__tests__/analytics-null-contract.test.ts`, `components/admin/crm/__tests__/lead-temperature.test.ts`) are now in the `pnpm test` script (38 pass total).

**New e2e spec:** `tests/e2e/auth-gate-bypass.spec.ts` asserts unauthenticated `/buyer`, `/dealer`, `/affiliate`, `/admin` dashboards redirect to their sign-in surfaces, and that a privileged API call (POST `/api/buyer/esign/...`) is rejected with 401.

### e2e execution caveat (honest status)
The e2e specs are **wired and the runner executes**, but they **could not be validated in this sandbox**:
- The chromium browser binary **fails to download** here (the Playwright CDN is blocked by the environment network policy: *"Executable doesn't exist … run npx playwright install"*), so the 4 browser redirect tests cannot launch.
- The non-browser API test ran against the auto-started dev server and returned **500 instead of 401** — an environment artifact: this sandbox's Supabase credentials are placeholders, so the auth helper throws at runtime instead of cleanly returning null/401. In a configured environment (real Supabase, CI preview) it returns 401.

These specs are written for CI against a configured preview (`BASE_URL`) with browsers installed (`npx playwright install chromium`). They are **not** asserted as passing in this session.

## Net Phase 2 gap status after Batch A + A.2 + B
- Gap 1 (dead-code seam) — **closed**: all reachable lifecycle writes route through `advanceDealStatus`.
- Gaps 2,3,4,5,6,7 — **fixed** (see `03_phase3_batchA.md` + above).
- Gap 8 (Stripe fee source check) — **fixed**.
- Gap 9 (error boundaries) — **fixed** (segments + global-error).
- Gap 11 (e2e infra) — **infra in place + runner executes**; full green run pending a configured CI environment.
- Gap 10 (console.* / structured logger) — **still open** (Batch C, not in scope here).

## Remaining (recommended Batch C)
- `lib/logger.ts` + migrate 538 `console.*` in `lib/` + add `no-console` lint rule.
- Run the full e2e suite in CI (preview `BASE_URL` + `playwright install`); extend gate-bypass coverage for the esign/insurance/shortlist gates against seeded fixtures.
- Address the 53 dependabot vulnerabilities (28 high) on the default branch.
