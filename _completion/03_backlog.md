# Phase 3 — Prioritized Remediation Backlog

| ID | Pri | Defect | Files | Action | Status |
|---|---|---|---|---|---|
| P0-1 | P0 | 18 admin CRM/search GET endpoints unauthenticated (service-role client, PII exposure) | `app/api/admin/crm/**`, `app/api/admin/search/route.ts` | Add `getAdminActor()` guard to each GET handler | ✅ Fixed (Batch 1) |
| P1-1 | P1 | Refund calls missing Stripe idempotency keys (double-refund on retry) | `app/api/admin/deals/[dealId]/action/route.ts` (×2), `app/api/admin/auctions/[auctionId]/action/route.ts` | Add `idempotencyKey` to `refunds.create()` | ✅ Fixed (Batch 2) |
| P2-1 | P2 | Affiliate payout request lacks unified audit-log entry | `app/api/affiliate/payouts/request/route.ts` | Deferred — no actor-agnostic audit model; AffiliatePayout row is the system-of-record | ◻ Deferred (documented) |
| P2-2 | P2 | "$99 refundable" wording nuance | buyer fee/FAQ copy | None — concluded transparent by compliance audit | ◻ No action |

## Sequencing rationale
- P0-1 first: unauthenticated PII exposure is the only security-critical, exploitable defect found; fixed and re-verified before touching anything else.
- P1-1 second: payment-correctness hardening, low blast radius, mirrors an existing in-repo convention.
- P2 items documented, not forced (smallest-correct-change discipline; avoid wrong-schema writes).

## Batches executed
- **Batch 1 (P0-1):** 18 files. Verified: per-handler re-scan → 0 real unguarded handlers; typecheck ✅; lint ✅; build ✅.
- **Batch 2 (P1-1):** 2 files. Verified: typecheck ✅; unit tests 22/22 ✅; lint ✅; build ✅.
