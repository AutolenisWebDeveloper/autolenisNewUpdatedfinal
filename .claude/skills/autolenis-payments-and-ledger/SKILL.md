---
name: autolenis-payments-and-ledger
description: >-
  Authoritative rules for money movement in AutoLenis — Stripe deposits, concierge/service
  fees, refunds, disputes, affiliate commissions and payouts, and the Stripe webhook ledger.
  Use this skill when working on anything touching payments, the $99 Auction Access Deposit,
  the $499 Premium concierge fee, Stripe PaymentIntents or Checkout Sessions, the
  `/api/webhooks/stripe` handler, Deposit/DealerPayment/Commission/AffiliatePayout models,
  refunds, chargebacks/disputes, idempotency keys, `PaymentProviderEvent` dedup, or any
  code under `lib/stripe.ts`, `lib/payments/`, `lib/services/payment/`, or
  `lib/services/deposit/`.
---

## Purpose & Authority

This skill owns every path where money is charged, captured, refunded, disputed, or
distributed in AutoLenis, and the ledger that records those facts. It is the source of
truth for the deposit/fee lifecycle, Stripe webhook processing, idempotency, and
commission/payout accounting. Where generic advice conflicts with the rules below —
"just store the amount as a float", "trust the client's success callback", "flip the
status then dedup later" — the rules here win. Money bugs are the most expensive class of
bug in this codebase; treat every rule as a hard invariant, not a suggestion.

## When this skill activates

- Files: `frontend/lib/stripe.ts`, `frontend/lib/payments/deposit-state.ts`,
  `frontend/lib/services/deposit/deposit.service.ts`,
  `frontend/lib/services/payment/stripe.service.ts`,
  `frontend/lib/services/payment/refund.service.ts`,
  `frontend/app/api/webhooks/stripe/route.ts` and its tests in
  `frontend/app/api/webhooks/__tests__/`.
- Routes: anything under `app/api/admin/payments/**`, `app/api/buyer/deposit/**`,
  `app/api/buyer/deals/[dealId]/fee/**`, `app/api/cron/deposit-activation-reconcile/`,
  `app/api/affiliate/**` payout/commission surfaces.
- Models: `Deposit`, `PaymentProviderEvent`, `Commission`, `AffiliatePayout`,
  `AffiliatePayoutMethod`, `DealerPayment`.
- Keywords: Stripe, PaymentIntent, Checkout Session, webhook, idempotency, refund,
  dispute/chargeback, deposit, concierge fee, service fee, commission, payout, minor units.

## Architecture & key files

- **Stripe client:** `lib/stripe.ts` — `getStripe()` is a *lazy* singleton. It throws hard
  if `STRIPE_SECRET_KEY` is missing (never a placeholder). Pinned API version
  `2026-04-22.dahlia`. Never instantiate `new Stripe()` anywhere else.
- **Amount constants:** `lib/constants.ts` — `DEPOSIT_AMOUNT_CENTS = 9900` ($99),
  `PREMIUM_FEE_CENTS = 49900` ($499), `PREMIUM_FEE_REMAINING_CENTS = 40000` ($400, the
  fee net of the $99 deposit credit). Amounts come from constants, **never from the client**.
- **Deposit lifecycle matrix:** `lib/payments/deposit-state.ts` — the single authoritative
  allowed-transition set. `canTransitionDeposit`, `isTerminalDepositStatus`,
  `allowedPredecessors(to)`. `DepositStatus` = `PENDING | PAID | FAILED | REFUNDED`.
  Terminal: `FAILED`, `REFUNDED`. Allowed edges: `PENDING→{PAID,FAILED}`, `PAID→{REFUNDED}`.
- **Deposit service:** `lib/services/deposit/deposit.service.ts` — `createDepositIntent`,
  `handleDepositPaid`, `refundDeposit` (manual-only; see rules).
- **Payment primitives:** `lib/services/payment/stripe.service.ts` —
  `createPaymentIntent`, `refundPaymentIntent`, `retrievePaymentIntent`,
  `constructWebhookEvent`. `lib/services/payment/refund.service.ts` — `processRefund`
  (status-guarded PAID→REFUNDED flip).
- **The webhook (the ledger's front door):** `app/api/webhooks/stripe/route.ts` handles
  `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`,
  `charge.dispute.created`. Signature-verified, idempotent via `PaymentProviderEvent`.
- **Dedup ledger:** `PaymentProviderEvent` model — unique on `eventId`, `processed` flag +
  `processedAt`. This row is the idempotency claim record.
- **Commissions:** `lib/services/affiliate/commission.service.ts` — `walkCommissionTree`
  (3 levels max, rates from `COMMISSION_RATES` in constants, idempotent on
  `qualifyingEventId` keyed `${eventId}-L${level}`). Models `Commission`,
  `AffiliatePayout` (linked via `Commission.payoutId`).

## Core rules & invariants

1. **Money is integer minor units (cents), always.** Every amount field is `Int`
   `amountCents`/`amount_cents`. Never use floats, never `parseFloat` a price into a
   money variable, never do `dollars * 100` inline where a constant exists.
2. **Never trust client-supplied payment status or amount.** The buyer's browser never
   decides that a deposit is paid. Payment truth arrives *only* through the
   signature-verified Stripe webhook. Charge amounts come from `DEPOSIT_AMOUNT_CENTS` /
   `PREMIUM_FEE_REMAINING_CENTS`, hardcoded server-side into the PaymentIntent.
3. **Every Stripe webhook is signature-verified.** `stripe.webhooks.constructEvent(body,
   sig, STRIPE_WEBHOOK_SECRET)` on the raw request body. Missing `STRIPE_WEBHOOK_SECRET`
   is a hard **500** (so Stripe keeps retrying), never a verify-against-`""`. Invalid
   signature is **400**. Read the body with `request.text()` — never `.json()` first, or
   verification breaks.
4. **Every webhook is idempotent via `PaymentProviderEvent.eventId`.** Fast-path duplicate
   ack when `processed === true`. The unique index arbitrates concurrent creates (swallow
   `P2002`). The deposit money-cluster claims `processed=true` *inside the same
   `$transaction`* as the state mutation, so replay/concurrency/crash are all safe.
5. **Status writes go through the transition matrix, enforced at the DB.** Never
   `findFirst` then unconditionally `update`. Use `updateMany` with
   `where: { ..., status: { in: allowedPredecessors(TARGET) } }` so the WHERE clause
   enforces the allowed edge atomically and closes the check-then-write race. A late/
   out-of-order success can never resurrect a `REFUNDED`/`FAILED` deposit; a late failure
   can never downgrade a `PAID` one.
6. **Refunds are idempotency-keyed and never automatic for the deposit.** Every
   `refunds.create` passes an `idempotencyKey`. Deposit refunds use the deposit-scoped key
   `refund-deposit-${depositId}` so all refund paths for one deposit collapse to a single
   real Stripe refund. The $99 Auction Access Deposit is **manual-only** — refunded solely
   via admin-authenticated action, **never** from a cron, webhook, or automated workflow.
7. **Buyers pay AutoLenis; dealers pay AutoLenis. Buyers never pay dealers, dealers never
   pay buyers.** All PaymentIntents are AutoLenis-owned. `DealerPayment` records money
   AutoLenis pays *out* to dealers (`COMMISSION | BONUS | CLAWBACK`), never a buyer charge.
8. **Deposit → auction is one atomic money-cluster.** On `payment_intent.succeeded` for a
   deposit: claim event, link PI, flip `PENDING→PAID`, create the `Auction` (unique on
   `depositId` — reuse if present), notify — all in one transaction with bounded
   `maxWait`/`timeout`. Post-commit effects (`launchAuction`, `inviteDealersToAuction`,
   emails, GHL tag, QStash dispatch, `emitDomainEvent`) are best-effort and logged, never
   retried by Stripe once money committed.
9. **Commissions are idempotent and capped at 3 levels.** `walkCommissionTree` keys each
   row on `${qualifyingEventId}-L${level}`; re-running on retry never double-pays. Rates
   only from `COMMISSION_RATES`. Basis is the actual fee captured (`pi.amount_received ||
   pi.amount`), persisted as `Commission.basisCents`. A commission failure must never roll
   back the deal-status advance.
10. **Fee receipt advances the deal without regressing it.** `concierge_fee` (canonical)
    and `service_fee` (legacy) drive `DealStatus`: `FEE_PENDING→FEE_PAID→INSURANCE_PENDING`.
    A deal already past insurance records fee fields but is never moved backward. Fee is an
    authoritative payment fact so the forward transition is `force`d and audited.

## Workflows

### Buyer pays the $99 deposit → auction goes live
1. `createDepositIntent(buyerId, auctionId?)` creates a PI for `DEPOSIT_AMOUNT_CENTS` with
   `metadata.type = "deposit"`, and a `Deposit` row `status: PENDING`, storing
   `stripePaymentIntentId`. Return `client_secret` to the client.
2. Buyer completes payment client-side; **nothing is trusted from that callback.**
3. Stripe delivers `payment_intent.succeeded`. The webhook verifies the signature, claims
   the `PaymentProviderEvent`, and inside one `$transaction`: links the PI (admin
   send-link path carries `metadata.depositId`), flips deposit to `PAID` via
   `allowedPredecessors("PAID")`, creates/reuses the `Auction` (`PENDING`), writes the
   in-app notification.
4. Post-commit: `launchAuction` → `AuctionStatus PENDING→ACTIVE`, `inviteDealersToAuction`,
   confirmation + activation emails, content-conversion attribution, GHL tag, QStash
   auction-active sequence, `deposit_paid` domain event.

### Buyer pays the concierge/service fee → deal advances
1. Fee PI (or Checkout Session with `payment_intent_data.metadata`) carries
   `metadata.type = "concierge_fee"` (or legacy `service_fee`), `dealId`, `buyerId`,
   amount `PREMIUM_FEE_REMAINING_CENTS`.
2. On `payment_intent.succeeded`: locate deal by `metadata.dealId` (or legacy
   `stripeFeePIId`), record `feePaidAt`/`feeAmountCents`/`stripeFeePIId`, advance
   `DealStatus` `FEE_PENDING→FEE_PAID→INSURANCE_PENDING` (forced, audited, no regress).
3. Send idempotent concierge-fee confirmation; walk affiliate commissions if the buyer was
   referred.

### Refund a deposit (manual, admin-only)
1. Admin route → `processRefund(depositId, reason)` (or `refundDeposit` in the deposit
   service). Guarded: only a `PAID` deposit with a `stripePaymentIntentId` refunds.
2. `refundPaymentIntent(pi, reason, "refund-deposit-${depositId}")` — idempotency key
   collapses duplicates.
3. Status-guarded `updateMany` flips `PAID→REFUNDED` + `refundedAt`; `count===0` means a
   concurrent path already did it — return without side effects.
4. Stripe also emits `charge.refunded`; the webhook independently converges
   `PAID→REFUNDED` via `allowedPredecessors("REFUNDED")` and sends the receipt keyed on the
   charge id.

### Dispute / chargeback
- `charge.dispute.created` retrieves the charge, resolves the PI, and writes an
  `AdminAuditLog` (`STRIPE_DISPUTE_CREATED`) with dispute id, amount, reason, status,
  `due_by`. No automatic money movement — disputes are handled by finance ops.

## Boundaries — do / never

**Do**
- Use `getStripe()`; keep the pinned API version; keep secrets server-side only.
- Represent all money as integer cents sourced from `lib/constants.ts`.
- Verify signatures on raw body; claim `PaymentProviderEvent` before side effects.
- Gate every status write with the transition matrix / `allowedPredecessors`.
- Pass an `idempotencyKey` to every `paymentIntents.create` and `refunds.create`.
- Keep post-commit effects best-effort and logged; wrap non-money tails in try/catch.

**Never**
- Never trust a client-reported payment status or a client-supplied amount.
- Never read the webhook body as JSON before `constructEvent`; never verify against `""`.
- Never `findFirst`+unconditional `update` for a payment status — use the guarded
  `updateMany`.
- Never issue a refund without an idempotency key; never auto-refund the $99 deposit from
  cron/webhook/automation.
- Never use floats/`parseFloat` for money; never inline dollar→cent math past a constant.
- Never charge a buyer on behalf of a dealer (or vice versa); never build a second
  webhook/ledger path — extend `route.ts` and `PaymentProviderEvent`.

## Best practices & examples

Guarded, matrix-enforced status flip (the only correct shape):
```ts
// Deposit PENDING→PAID — DB WHERE enforces the allowed edge atomically
await tx.deposit.updateMany({
  where: { stripePaymentIntentId: pi.id, status: { in: allowedPredecessors("PAID") } },
  data: { status: "PAID" },
});
```

Idempotent refund keyed per deposit:
```ts
await getStripe().refunds.create(
  { payment_intent: deposit.stripePaymentIntentId },
  { idempotencyKey: `refund-deposit-${depositId}` },
);
```

Webhook entry contract: raw body → verify → claim event → transactional money cluster →
best-effort tail. Mirror the invariants proven in
`app/api/webhooks/__tests__/stripe-idempotency.test.ts` (fresh success, replay no-op,
out-of-order refuses resurrection/downgrade, crash rolls back the claim, missing secret =
500). If you change the deposit path, update those tests.

## Acceptance criteria

- [ ] All amounts are integer cents from `lib/constants.ts`; no floats, no inline `*100`.
- [ ] No code path trusts a client-reported payment status or amount.
- [ ] Every new Stripe handler verifies the signature on the raw body; missing secret → 500.
- [ ] Every event is idempotent via `PaymentProviderEvent.eventId`; replay is a no-op ack.
- [ ] Every deposit status write uses `allowedPredecessors(...)` / the transition matrix.
- [ ] Every `refunds.create` / `paymentIntents.create` passes an `idempotencyKey`.
- [ ] The $99 deposit refund is reachable only from an admin-authenticated action.
- [ ] Commission writes are keyed on `qualifyingEventId` and stay ≤ 3 levels.
- [ ] Money mutations are transactional; post-commit effects are best-effort + logged.
- [ ] Idempotency/atomicity tests updated and passing when the webhook changes.

## Cross-skill links

- `autolenis-system-architecture` — repo-wide engineering standards (source of these money rules).
- `autolenis-deal-lifecycle` — the concierge service fee and its refund pair.
- `autolenis-domain-model` — Prisma enums (`DepositStatus`, `DealStatus`, `CommissionStatus`,
  `PayoutStatus`) and model relations.
- `autolenis-buyer-journey` — where deposit/fee payment fits the buyer flow.
- `autolenis-auction-engine` — `launchAuction`/`AuctionStatus` triggered post-deposit.
- `autolenis-dealer-marketplace` — `DealerPayment` payouts and dealer settlement.
- `autolenis-contract-shield` — the deal stage (`CONTRACT_*`) that follows fee/insurance.
- `autolenis-auth-security-privacy` — admin authorization gating manual refunds/payouts.
