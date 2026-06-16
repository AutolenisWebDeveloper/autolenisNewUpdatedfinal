# AUTOLENIS — Completion Workflow · Phase 3 Batch A (Lifecycle Integrity)

**Session:** 3 (first session to change application code) · **Date:** 2026-06-15 · **Branch:** `claude/epic-lamport-h6i6cy`
**Scope:** Close the reachable CRITICAL/HIGH integrity gaps from `_completion/02_gaps.md` with **purely additive guards** + an upgraded state-machine seam. No money-flow reroutes (see "Deferred" for why).

## Acceptance gate (all green)
| Check | Before (baseline) | After |
|---|---|---|
| `pnpm tsc --noEmit` | 0 errors | **0 errors** |
| `pnpm lint` | 0 errors / 102 warn | **0 errors / 100 warn** |
| `pnpm build` | PASS | **PASS** |
| `pnpm test` | 22 pass | **30 pass / 0 fail** (+8 new state-machine tests) |

## What shipped

### 1. Upgraded state-machine seam — `lib/services/deal/deal.service.ts`
- `TRANSITIONS` map corrected: `PICKUP_SCHEDULED → [PICKUP_COMPLETE, COMPLETED]` (Gap 6); `CANCELLED → [REFUNDED]` (Gap 7).
- `canTransition()` now: rejects same-state; allows `→CANCELLED` from any non-terminal; allows `→REFUNDED` from `CANCELLED` or any non-terminal.
- New exports: `INSURANCE_SATISFIED` = `{VERIFIED, POLICY_BOUND, EXTERNAL_UPLOADED}` (matches UI), `DealTransitionError`, `InsuranceRequiredError`.
- `advanceDealStatus(dealId, newStatus, opts)` rewritten: idempotent same-state no-op; rejects illegal transitions unless `opts.force`; **enforces the insurance hard-gate before `COMPLETED`** unless `force`; writes `DealStatusHistory` + buyer activity; supports atomic `opts.data` merge.
- `cancelDeal()` routed through the seam (records history).

### 2. Contract Shield hard gate (Gap 2, CRITICAL) — `app/api/buyer/esign/[dealId]/route.ts`
Replaced the unguarded direct write to `SIGNING_PENDING` with: explicit `CONTRACT_APPROVED` precondition (409 `CONTRACT_NOT_APPROVED`) **and** routing through `advanceDealStatus`. A buyer can no longer reach signing without Contract Shield approval.

### 3. Insurance release gate (Gap 3, HIGH) — `app/api/dealer/pickup/scan/route.ts`
Added an `INSURANCE_SATISFIED` check before completion (409 `INSURANCE_REQUIRED`). The primary (dealer QR scan) completion path can no longer release a vehicle with `NOT_STARTED`/`FAILED` insurance. Earlier stages remain unblocked; the buyer's own-policy upload (`EXTERNAL_UPLOADED`) satisfies the gate.

### 4. Auction shortlist precondition (Gap 4, HIGH) — `app/api/buyer/deposit/create-intent/route.ts`
Added a non-empty `shortlistItem` check before allowing the deposit that activates the auction (400 `SHORTLIST_REQUIRED`).
*Scoping note:* the gate was **not** added to the admin `launch-auction` path — that path attaches vehicles explicitly (`vehicles[]` / `vehicleRequestId`) and is a deliberate, audit-logged admin override, so a buyer-shortlist requirement there would be incorrect.

### 5. Admin stage-advance legality (Gap 5, HIGH) — `app/api/admin/deals/[dealId]/action/route.ts`
`DEAL_STAGE_ADVANCED` now routes through `advanceDealStatus` (rejects illegal jumps with 409 `INVALID_TRANSITION`; inherits the insurance gate for `→COMPLETED`). Legitimate manual corrections pass `force:true`, which is audit-logged via the existing `adminAuditLog` write.

### 6. Test — `lib/services/deal/__tests__/deal-state-machine.test.ts`
8 tests proving: happy-path legality; **Contract Shield gate (SIGNING_PENDING only from CONTRACT_APPROVED)**; arbitrary-jump rejection; pickup completion edges; cancel/refund reachability; same-state rejection; insurance-satisfied set excludes `NOT_STARTED`/`FAILED`. Wired into `pnpm test`.

## Deferred within Batch A (with reasoning)
These are the **money-flow reroutes** (gap-doc sites #4 service-fee, #5 esign webhook, #11 Stripe fee webhook, #12/#13 financing, #19 mark-paid). They are intentionally **not** rerouted in this push because:
- The live buyer flow **skips `FEE_PAID`** (fee payment jumps `FEE_PENDING → INSURANCE_PENDING`), so naively routing these through `advanceDealStatus` would throw and **break production payments**. Correct remediation requires reconciling the map with the real fee flow (two-step `FEE_PENDING→FEE_PAID→INSURANCE_PENDING`) **and** integration testing against Stripe/DocuSign, which is not possible in this read-context environment.
- `moveBuyerWorkflowStage` / admin journey tooling (`complete-all`) deliberately advances stages and reaches `COMPLETED`; adding the guard there needs a dedicated override-flag pass to avoid breaking admin journey UX.

These remain tracked for **Batch A.2** (test-gated). The seam is now ready for them.

## Net effect on Phase 2 gaps
- Gap 2 (esign) — **FIXED** (guarded + tested).
- Gap 3 (insurance release) — **FIXED at the primary completion path**; admin manual-complete intentionally retains override.
- Gap 4 (shortlist) — **FIXED** on the buyer activation path.
- Gap 5 (admin arbitrary jumps via `DEAL_STAGE_ADVANCED`) — **FIXED** (force-override preserved).
- Gaps 6/7 (map: PICKUP_COMPLETE / CANCELLED-REFUNDED edges) — **FIXED** in the map.
- Gap 1 (systemic dead-code seam) — **partially closed**: the seam is upgraded and now used by the reachable security-critical paths; full funneling of the remaining money-flow sites is Batch A.2.
- Gap 8 (Stripe fee `updateMany` source check) — deferred to Batch A.2 (webhook reroute).
