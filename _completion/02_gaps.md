# AUTOLENIS — Completion Workflow · Phase 2 Gap Analysis

**Session:** 2 (gap analysis — **read-only, no code changed**) · **Date:** 2026-06-14 · **Branch:** `claude/epic-lamport-h6i6cy`
**Scope:** Deep-dive on the gaps surfaced by the Phase 1 matrix (`_completion/01_matrix.md`). Fixes are **described, not implemented** (implementation = Phase 3).

---

## EXECUTIVE SUMMARY

The single most important finding upgrades the matrix's "Contract Shield bypass" from a one-route bug to a **systemic integrity failure**:

> **The deal state machine (`lib/services/deal/deal.service.ts`) is entirely DEAD CODE.** `advanceDealStatus()`, `canTransition()`, and `cancelDeal()` have **zero callers** in the codebase. **All 21 lifecycle status mutations are direct, unguarded `prisma.deal.update` writes.** No fee, insurance, contract-approval, or signing gate is enforced at runtime. Every lifecycle "gate" in the product is advisory UI only.

Severity rollup:

| # | Gap | Severity | Type |
|---|---|---|---|
| 1 | Deal state machine is unused; all transitions unguarded | **CRITICAL** | Integrity (systemic) |
| 2 | Contract Shield gate bypassed at buyer esign | **CRITICAL** | Integrity/security |
| 3 | Insurance never gates final release/completion | **HIGH** | Compliance/integrity |
| 4 | Auction activation: shortlist never enforced; admin path skips prequal | **HIGH** | Integrity |
| 5 | Admin `DEAL_STAGE_ADVANCED` / `moveBuyerWorkflowStage` allow arbitrary jumps | **HIGH** | Integrity |
| 6 | Pickup completion skips `PICKUP_COMPLETE`; dealer scan completes from any state | **HIGH** | Integrity |
| 7 | `CANCELLED`/`REFUNDED` unreachable in map but written directly (4 sites) | **MEDIUM** | Correctness |
| 8 | Stripe fee webhook `updateMany` advances status with no source check | **MEDIUM** | Integrity |
| 9 | Error boundaries missing on 4 role segments; no `global-error.tsx` | **MEDIUM** | Resilience |
| 10 | No structured logger; 538 `console.*` in `lib/` | **LOW** | Tech-debt |
| 11 | Playwright not installed/configured; e2e + 2 unit files orphaned | **MEDIUM** | Verification |
| — | Compliance copy | **NONE** | Zero genuine violations confirmed |

---

## GAP 1 — CRITICAL — Deal state machine is dead code (no gate is enforced)

**Current behavior.** `lib/services/deal/deal.service.ts:10-27` defines a linear `TRANSITIONS` map; `canTransition()` (`:29-31`) and `advanceDealStatus()` (`:33-52`, which **throws** on illegal transition) implement the guard. **Grep confirms zero callers** of `advanceDealStatus`/`canTransition`/`cancelDeal` outside the definition file. The only guarded write (`deal.service.ts:41`) is never reached.

**Blast radius — every deal status mutation:**

| # | file:line | →status | Guarded? | Reachable by |
|---|---|---|---|---|
| 1 | `lib/services/deal/deal.service.ts:41` | any→new | **Y** | (unused) |
| 2 | `lib/services/deal/deal.service.ts:91` (`cancelDeal`) | →CANCELLED | N | (unused) |
| 4 | `lib/services/deal/service-fee.service.ts:30` | →INSURANCE_PENDING | N | buyer self-serve |
| 5 | `lib/services/esign/esign.service.ts:103` | →SIGNED | N | DocuSign webhook |
| 6 | `lib/services/pickup/pickup.service.ts:48` | →PICKUP_SCHEDULED | N | pickup schedule |
| 7 | `lib/services/pickup/pickup.service.ts:98` | →COMPLETED | N | pickup complete (skips PICKUP_COMPLETE) |
| 8 | `lib/services/admin/admin-buyer-command-center.service.ts:922` | →CANCELLED | N | admin (writes dealStatusHistory) |
| 9 | `lib/services/admin/admin-buyer-command-center.service.ts:973` | →ANY | N | admin moveBuyerWorkflowStage |
| 10 | `app/api/dealer/pickup/scan/route.ts:58-60` | →COMPLETED | N | dealer QR scan |
| 11 | `app/api/webhooks/stripe/route.ts:218-226` | →INSURANCE_PENDING (updateMany) | N | Stripe webhook |
| 12 | `app/api/buyer/deal/financing/route.ts:18` | →FEE_PENDING | N | buyer |
| 13 | `app/api/buyer/financing/route.ts:83-85` | →FEE_PENDING | N | buyer (alt) |
| 14 | `app/api/buyer/esign/[dealId]/route.ts:58-61` | →SIGNING_PENDING | N | **buyer (Gap 2)** |
| 15 | `app/api/admin/deals/[dealId]/action/route.ts:60` | →ANY (enum-only) | N | admin (Gap 5) |
| 16 | `app/api/admin/deals/[dealId]/action/route.ts:166` | →CANCELLED | N | admin |
| 17 | `app/api/admin/deals/[dealId]/action/route.ts:214` | →REFUNDED | N | admin |
| 18 | `app/api/admin/deals/[dealId]/pickup/complete/route.ts:61-63` | →COMPLETED | N | admin |
| 19 | `app/api/admin/payments/concierge-fee/[dealId]/mark-paid/route.ts:30-35` | →FEE_PAID | N | admin |
| 20 | `app/api/admin/contract-shield/[reviewId]/route.ts:74` | →CONTRACT_APPROVED | N | admin (gate setter) |
| 21 | `app/api/admin/contract-shield/[reviewId]/route.ts:178` | →CONTRACT_PENDING | N | admin |

(Creates at `deal.service.ts:56`, `buyer/auctions/[id]/select-offer:32`, `requests/[id]/offer/respond:101`, `admin/deals/route.ts:44`, `scripts/seed-sandbox-deal.ts:222` are N/A.)
**0 of 21 mutation sites pass through the guard.**

**Fix (Phase 3, described).** Funnel mutation sites through `advanceDealStatus()`. Highest-value first: buyer-reachable + webhook sites (#4, #5, #6, #11, #12, #13, #14). Admin sites (#9, #15, #16, #17, #18) need a guarded path **plus** an explicit, audit-logged `forceOverride` flag to preserve intentional admin overrides. Requires first fixing the map (Gaps 6 & 7) so legal flows don't break.

---

## GAP 2 — CRITICAL — Contract Shield gate bypassed at buyer esign

**Current behavior.** `app/api/buyer/esign/[dealId]/route.ts:58-61` writes `status:"SIGNING_PENDING"` directly with no check of current status. The intended gate (`CONTRACT_APPROVED`) is set only at `app/api/admin/contract-shield/[reviewId]/route.ts:74` (APPROVE). An authenticated buyer who owns the deal can reach `SIGNING_PENDING` regardless of approval. The esign route also **duplicates** DocuSign envelope creation that the approve route already performs (`:80`).

**Fix.** Before `:58`, assert `deal.status === "CONTRACT_APPROVED"` (else 409), or route through `advanceDealStatus(dealId,"SIGNING_PENDING")` (only legal from `CONTRACT_APPROVED` per the map). De-duplicate envelope creation.

---

## GAP 3 — HIGH — Insurance never gates final release/completion

**Current behavior.** No path that sets `COMPLETED` reads `insuranceStatus`:
- `app/api/dealer/pickup/scan/route.ts:53-70` (primary, non-override completion) — only checks token/expiry/already-scanned.
- `app/api/admin/deals/[dealId]/pickup/complete/route.ts:47-64` — only requires override `reason`.
- `app/api/admin/buyers/[buyerId]/journey/complete/route.ts:226-244` (`case "pickup"`) — `advanceDeal("COMPLETED")` with no insurance read (yet the `insurance` stage at `:194-203` *sets* `VERIFIED`).
- `lib/services/pickup/pickup.service.ts:92-115`, `lib/services/deal/deal.service.ts:33-52` — no insurance read.

Insurance is **display-only** (`buyer-journey-admin.service.ts:128`, `journey-status/route.ts:59`, `AdminBuyerCommandCenter.tsx:873`) and a **risk input** (`deal-risk.service.ts:31,54`), never blocking. Proof fallback works: `upload-proof/route.ts:92-95` sets `EXTERNAL_UPLOADED`; the de-facto "satisfied" set used in UI is **`{VERIFIED, POLICY_BOUND, EXTERNAL_UPLOADED}`** (`AdminBuyerCommandCenter.tsx:873`, `app/buyer/insurance/page.tsx:72`).

**Fix.** Add `insuranceStatus ∈ {VERIFIED, POLICY_BOUND, EXTERNAL_UPLOADED}` guard before every `→COMPLETED` transition. Primary seam: `dealer/pickup/scan/route.ts` (extend the `pickup.deal` include at `:30-32`, return `INSURANCE_REQUIRED` 409 before the txn at `:53`). Defense-in-depth: same check in `pickup.service.completePickup` and the `→COMPLETED` case of `advanceDealStatus`. Admin manual-complete may keep an explicit override.

---

## GAP 4 — HIGH — Auction activation: shortlist never enforced; admin path skips prequal

**Current behavior** (3 creation paths). Intended: active prequal + **non-empty shortlist** + paid deposit.

| Path | active prequal? | non-empty shortlist? | paid deposit? |
|---|---|---|---|
| (i) buyer deposit → Stripe webhook | ✅ at `deposit/create-intent/route.ts:13-16`; not re-checked at webhook | ❌ **missing** | ✅ (PI succeeded) |
| (i-alt) `deposit.service.handleDepositPaid:29-64` | ❌ | ❌ **missing** | ✅ |
| (ii) admin `launch-auction/route.ts` | ❌ (buyer loaded w/o `preQualification`, `:57-66`) | ❌ **missing** | ⚠ auto-fabricates PAID deposit (`:110-115`) |
| (iii) `auction.service.createAuction:14-64` | — | — | — (pure writer) |

Shortlist count is checked **nowhere** (grep: zero `shortlist` refs in `deposit.service.ts`, `auction.service.ts`, `launch-auction`, `create-intent`). Confirmed: insurance/lender correctly **not** gated.

**Fix.** Add non-empty `shortlistItem` count check in `deposit/create-intent/route.ts` (after `:16`, `SHORTLIST_REQUIRED` 400) and in `launch-auction/route.ts` (after buyer lookup, before `createAuction` at `:118`); add active-prequal `select` + check on the admin path. Optionally harden in `deposit.service.handleDepositPaid` before `:42`. Single-seam alternative (`createAuction`) changes admin-override semantics — prefer per-route placement.

---

## GAP 5 — HIGH — Admin stage-advance allows arbitrary jumps

`app/api/admin/deals/[dealId]/action/route.ts:57-60` validates only that `newStatus` is a `DealStatus` enum member, not that the transition is legal; same for `moveBuyerWorkflowStage` (`admin-buyer-command-center.service.ts:973`). An admin can jump a deal straight to `COMPLETED`/`SIGNING_PENDING`, skipping fee/insurance/contract gates. **Fix:** add `canTransition()` check with an explicit audit-logged force-override flag for legitimate overrides.

---

## GAP 6 — HIGH — Pickup completion skips a required state

`pickup.service.ts:98`, `dealer/pickup/scan/route.ts:58-60`, `admin/.../pickup/complete:61` all write `COMPLETED` directly. Per the map, `COMPLETED` is legal only from `PICKUP_COMPLETE` — and **no code ever writes `PICKUP_COMPLETE`**, so the legal chain is unreachable. The dealer scan can complete from **any** state (e.g. `FEE_PENDING`). **Fix:** write `PICKUP_COMPLETE` before `COMPLETED` (or adjust the map) and gate the scan route on `status === PICKUP_SCHEDULED`.

---

## GAP 7 — MEDIUM — CANCELLED/REFUNDED unreachable in map but written directly

The `TRANSITIONS` map lists `CANCELLED`/`REFUNDED` as targets from **no** state, so a guarded cancel/refund is impossible; today they work only by bypassing the guard (`:91`, `admin-buyer-command-center:922`, `action:166/214`). Only the command-center cancel (`:922`) writes `dealStatusHistory`; `:91/:166/:214` do not. **Fix:** add `*→CANCELLED`/`*→REFUNDED` edges (from all non-terminal states) or dedicated guarded `cancelDeal`/`refundDeal` that records history — must be done **before** routing Gap 1 sites through the guard, or cancel/refund breaks.

---

## GAP 8 — MEDIUM — Stripe fee webhook advances status with no source check

`app/api/webhooks/stripe/route.ts:218-226` sets `INSURANCE_PENDING` via `updateMany` keyed `id OR stripeFeePIId`, no source-status assertion. A replay or out-of-order event could misadvance a deal. (Webhook idempotency on `PaymentProviderEvent.eventId` exists at `:32-57` and mitigates replays, but not order.) **Fix:** assert `FEE_PENDING`/`FEE_PAID` before advancing, ideally via `advanceDealStatus`.

---

## GAP 9 — MEDIUM — Error boundary coverage

Only 4 `error.tsx`: `app/error.tsx` (root), `app/buyer/error.tsx`, `app/dealer/error.tsx`, `app/admin/crm/analytics/error.tsx` (depth 4, not segment root). **No `global-error.tsx`.** `not-found.tsx`: root + `app/dealer` only.

**Zero segment-level boundary:** `app/(public)`, `app/affiliate`, `app/admin` (root), `app/auth` — all fall back to root. **Fix:** add `error.tsx` to those 4 segments; consider `global-error.tsx` (catches root-layout errors the current root boundary cannot); optionally add `not-found.tsx` to buyer/affiliate/admin/auth.

---

## GAP 10 — LOW — No structured logger; 538 `console.*` in `lib/`

538 calls across 120 files: `console.error` 294 (mostly defensible but unstructured), `console.log` 159 + `console.info` 1 (≈160 clear debt), `console.warn` 84 (mixed). **No logger exists** (no pino/winston/sentry; `monitoring/cron-monitor.service.ts` is a Prisma table writer, not an app logger). Hotspots: `social/**` and `acquisition/**` (top files: `unified-buyer-intake` 22, `gemini-maps` 22, `social-post.orchestrator` 20, `image-generation` 17, `compound-search` 15). **Fix:** add `lib/logger.ts` (pino server / structured-console edge); migrate log/info debt first, then route errors through it; add `no-console` ESLint rule on hotspots to prevent regression.

---

## GAP 11 — MEDIUM — E2E/verification infra not runnable

`playwright.config.*` does **not exist**; `@playwright/test`/`playwright` are **not installed**. `tests/e2e/responsive-overflow.spec.ts` is unwired ("CI integration TBD") and cannot run. 21 unit tests run via `tsx --test` (Node runner) — but `components/admin/crm/__tests__/lead-temperature.test.ts` and `lib/social/__tests__/analytics-null-contract.test.ts` are **orphaned** (referenced by no npm script). No build-time link/route checker exists. **Fix:** add `@playwright/test` dev dep + minimal `playwright.config.ts` + `test:e2e` script; add gate-bypass e2e specs (unauth/wrong-role redirect; direct-URL skipping of prequal/deposit/contract gates — i.e. coverage for Gaps 2/3/4); wire the 2 orphaned unit files; consider a route-existence/link check.

---

## COMPLIANCE — NO ACTION

Re-scan of `app/(public)/**` and `app/buyer/**` found **zero genuine violations**. Every guarantee/approval reference carries an adjacent disclaimer (`pricing:290`, `refinance:48/466`, `refinance/confirm:195`, `refinance/eligibility:408`, `for-affiliates:81/100-101`). `/compare:319` "guaranteed" modifies *dealer engagement* (with refund disclaimer) — benign. `buyer/deal/financing/pre-approval` explicitly enforces "no fake lender approvals / estimate only." The `_completion/01_matrix.md` UNVERIFIED flag on `/compare:319` is now **resolved: benign.**

---

## RECOMMENDED REMEDIATION SEQUENCE (Phase 3 dispatch order)

**Batch A — Lifecycle integrity (must ship together; CRITICAL/HIGH):**
1. Fix the `TRANSITIONS` map first: add `PICKUP_COMPLETE` step usage (Gap 6) and `CANCELLED`/`REFUNDED` edges (Gap 7) so legal flows survive guarding.
2. Route buyer-reachable + webhook mutations through `advanceDealStatus` (Gap 1: #4,#5,#6,#11,#12,#13,#14), which inherently fixes Gap 2 (esign) and Gap 8 (fee webhook source check).
3. Add insurance release gate (Gap 3) at dealer scan + completion seams.
4. Add `canTransition` + audit-logged override to admin stage-advance (Gap 5).
5. Add shortlist/prequal preconditions to auction activation (Gap 4).
   → Re-run `pnpm tsc/build/test` after each step; add the gate-bypass e2e tests (Gap 11) as the acceptance proof for Batch A.

**Batch B — Resilience & verification (independent):**
6. Segment error boundaries + `global-error.tsx` (Gap 9).
7. Playwright install/config + wire orphaned tests + e2e harness (Gap 11).

**Batch C — Tech-debt (lowest risk, do last):**
8. `lib/logger.ts` + `console.*` migration + `no-console` rule (Gap 10).

> Acceptance gates for Phase 3: every Batch-A fix must (a) keep `pnpm tsc --noEmit` at 0 errors and `pnpm build` passing, (b) add/extend a test that proves the gate cannot be bypassed, (c) preserve intentional admin overrides behind an explicit, audit-logged flag.
