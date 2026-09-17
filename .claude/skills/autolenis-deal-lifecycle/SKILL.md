---
name: autolenis-deal-lifecycle
description: >-
  Owns the AutoLenis post-acceptance deal lifecycle — everything after a buyer
  accepts an offer: Deal creation, the DealStatus guarded state machine,
  financing, the concierge service fee, insurance gating, contract review,
  DocuSign e-sign, pickup/delivery, trade-in, deal documents, deal risk scoring,
  and the deal timeline. Use this skill when touching
  frontend/lib/services/deal/, lib/services/esign/, lib/services/pickup/,
  lib/services/trade-in/, lib/services/documents/, app/api/buyer/deals/**,
  app/api/admin/deals/**, or the Deal / ESignEnvelope / Pickup / Financing /
  TradeInSubmission / DealNote models; or when a task mentions DealStatus,
  advanceDealStatus, canTransition, deal stage, service fee, e-sign envelope,
  pickup QR, delivery, or "the deal is stuck".
---

## Purpose & Authority

This skill is the authority for the **second half of the AutoLenis funnel**. The
buyer journey (`autolenis-buyer-journey`) ends when an offer is accepted; the
auction engine (`autolenis-auction-engine`) ends when a winner is selected. From
that point the money is real, the documents are legally binding, and the buyer is
committed — this skill owns that stretch.

Before this skill existed, `Deal`, `ESignEnvelope`, `Pickup`, `Financing` and
`TradeInSubmission` were referenced in passing by six skills and **owned by none**.
Ownership matters here because `DealStatus` is a *guarded* state machine: the
Contract Shield gate lives inside it, and a bypassed transition means a buyer
signs a contract that was never reviewed.

## When this skill activates

- `frontend/lib/services/deal/` (`deal.service.ts`, `service-fee.service.ts`,
  `deal-risk.service.ts`, `deal-timeline.service.ts` — the last has zero callers,
  see the drift note at the end).
- `frontend/lib/services/esign/`, `lib/services/pickup/`,
  `lib/services/trade-in/`, `lib/services/documents/`.
- Routes under `app/api/buyer/deals/**`, `app/api/admin/deals/**`,
  `app/buyer/deals/**`, `app/admin/deals/**`.
- Models `Deal`, `DealNote`, `ESignEnvelope`, `Pickup`, `Financing`,
  `FinancingScenario`, `TradeInSubmission`, `TradeInValuation`, `ContractScan`.
- Enums `DealStatus`, `ESignStatus`, `PickupStatus`, `FinancingStatus`,
  `FinancingPath`, `TradeInStatus`, `RiskTier`.
- Keywords: deal stage, advance deal, deal stuck, service fee, `$499`,
  envelope, DocuSign, signing, pickup, delivery, QR check-in, trade-in.

## Architecture & key files

**The state machine is code, not convention.** `lib/services/deal/deal.service.ts`
exports the whole contract:

| Export | Role |
| --- | --- |
| `canTransition(from, to)` | Pure guard. The single source of truth for legality. |
| `advanceDealStatus(...)` | The **only** sanctioned way to move a deal forward. |
| `createDealFromOffer(buyerId, offerId)` | Entry point from a won auction. |
| `getDealForBuyer(buyerId, dealId?)` | Buyer-scoped read (ownership enforced). |
| `cancelDeal(dealId, reason)` | Off-path exit. |
| `INSURANCE_SATISFIED: InsuranceStatus[]` | The insurance set that unblocks release. |

**Happy path** (proven by `lib/services/deal/__tests__/deal-state-machine.test.ts`):

```
PENDING → ACTIVE → FINANCING_PENDING → FEE_PENDING → FEE_PAID
       → INSURANCE_PENDING → CONTRACT_PENDING → CONTRACT_REVIEW
       → CONTRACT_APPROVED → SIGNING_PENDING → SIGNED
       → PICKUP_SCHEDULED → PICKUP_COMPLETE → COMPLETED
```

Off-path terminals: `CANCELLED`, `REFUNDED`.

**Stage owners:**

- **Financing** — `Financing` / `FinancingScenario`, `FinancingStatus`,
  `FinancingPath`; `Deal.financingPath`.
- **Service fee** — `service-fee.service.ts`:
  `createFeePaymentIntent(dealId, buyerId)` → `recordFeePayment(dealId, pi)`.
  Persists `feeAmountCents`, `feePaidAt`, `stripeFeePIId`, and the refund pair
  `feeRefundedAt` / `feeRefundedAmountCents`. Money rules are owned by
  `autolenis-payments-and-ledger`.
- **Insurance** — `Deal.insuranceStatus` (`InsuranceStatus`); the buyer-facing
  quote flow belongs to `autolenis-buyer-journey`, the *gate* belongs here.
- **Contract** — `ContractScan`, `Deal.contractShieldScore` /
  `contractShieldStatus`, `ContractVersion`. Scan logic:
  `autolenis-contract-shield`.
- **E-sign** — `esign.service.ts`: `createEnvelope`, `sendEnvelope`,
  `handleEnvelopeCompleted(docusignEnvelopeId)`, `voidEnvelope`,
  `resendEnvelope`; `envelope-template.service.ts`,
  `docusign-auth.service.ts` (`isDocuSignConfigured()`). Adapter rules:
  `autolenis-integrations`.
- **Pickup** — `pickup.service.ts`: `schedulePickup`, `checkInPickup`,
  `completePickup`, `regenerateQr`; `qr.service.ts`
  (`generatePickupQr`, `validateQrPayload`); `scheduling.service.ts`
  (`reschedulePickup`).
- **Trade-in** — `trade-in.service.ts` (`submitTradeIn`, `getBuyerTradeIns`),
  `TradeInSubmission` / `TradeInValuation`.
- **Risk & audit** — `deal-risk.service.ts` (`computeDealRisk`,
  `updateAllDealRisks`) writing `riskScore` / `riskTier`;
  `DealStatusHistory`, written by `deal.service.ts` (`advanceDealStatus`),
  `deal-creation.ts`, `return-to-offers.service.ts` and
  `pickup/pickup-completion.service.ts`. **`deal-timeline.service.ts` has zero
  callers and `deal_timeline` is empty — see the drift note at the end.**

## Core rules & invariants

1. **Never write `deal.status` directly.** Every forward move goes through
   `advanceDealStatus`, which consults `canTransition`. A raw
   `prisma.deal.update({ data: { status } })` outside `deal.service.ts` is a
   defect, not a shortcut.
2. **The Contract Shield gate is load-bearing.** `SIGNING_PENDING` is reachable
   **only** from `CONTRACT_APPROVED`. Do not add a transition that lets a deal
   reach signing from `CONTRACT_PENDING`, `CONTRACT_REVIEW`, `FEE_PAID`, or
   `INSURANCE_PENDING`. This exact bypass is asserted against in
   `deal-state-machine.test.ts` — if you widen the guard, that test must fail
   first and the widening must be justified in the PR.
3. **No stage skipping.** `FEE_PENDING → INSURANCE_PENDING` (skipping
   `FEE_PAID`) and `SIGNED → COMPLETED` (skipping pickup) are illegal by design.
4. **Insurance releases only on `INSURANCE_SATISFIED`.** Read the exported array;
   never re-hardcode the satisfied set at a call site.
5. **Fee state comes from Stripe, never the client.** `recordFeePayment` is
   driven by a verified PaymentIntent; a client claiming "paid" changes nothing.
6. **E-sign completion is webhook-driven and idempotent.**
   `handleEnvelopeCompleted` must tolerate replay — DocuSign redelivers.
   `ESignStatus` moves `PENDING → SENT → DELIVERED → COMPLETED`, with `DECLINED`
   and `VOIDED` as terminals.
7. **Pickup QR is a credential.** `validateQrPayload(qrData, dealId)` binds the
   code to the deal; never accept a QR without re-validating it against the deal
   being checked in.
8. **Every transition is recorded.** Call `recordStatusTransition` (from/to,
   actor, reason) so a stuck deal is diagnosable without guessing.
9. **Buyer reads are ownership-scoped.** Use `getDealForBuyer`; never fetch a
   deal by id alone in a buyer route.
10. **Cancellation is explicit.** `cancelDeal(dealId, reason)` with a real reason
    (`CancellationReason`); do not silently park a deal in a stale stage.

## Workflows

**Add a new stage requirement (e.g. gate signing on a document)**
1. Locate the guard in `deal.service.ts::canTransition` — do not add a parallel
   check at the route.
2. Write the failing test in `lib/services/deal/__tests__/deal-state-machine.test.ts`
   asserting the new transition is rejected without the requirement.
3. Implement inside the guard; keep the transition table exhaustive.
4. Add the buyer-facing explanation of *why* the deal is blocked (a silent block
   is a support ticket).
5. Run `pnpm test` (covers `lib/services/deal/__tests__`).

**Diagnose a stuck deal**
1. Read `DealStatusHistory` for the deal — the transition history, not the current row.
   **NOT `getDealTimeline(dealId)`. See the drift note at the end of this skill.**
2. Compare current status against `canTransition` for the expected next step.
3. Check the stage's gating field: `feePaidAt`, `insuranceStatus` ∈
   `INSURANCE_SATISFIED`, `contractShieldStatus`, `ESignEnvelope.status`,
   `Pickup.status`.
4. If a cron owns the advance (`app/api/cron/*`), check `CronJobLog` before
   suspecting the state machine — see `autolenis-observability-sre`.

**Wire a new deal document**
1. Extend `lib/services/documents/` — do not add a second upload path.
2. Enforce `DocumentType` / `DocumentStatus` from the schema
   (`autolenis-domain-model`), and storage authz per
   `autolenis-auth-security-privacy`.

## Boundaries — do / never

**Do**
- Route every status change through `advanceDealStatus`.
- Extend the existing guard table; keep `canTransition` pure and testable.
- Make DocuSign and Stripe callbacks idempotent.
- Record a timeline event for every transition and every off-path exit.
- Scope every buyer read by `buyerId`.

**Never**
- Mutate `Deal.status` outside `deal.service.ts`.
- Create a path to `SIGNING_PENDING` that bypasses `CONTRACT_APPROVED`.
- Trust a client-supplied fee, insurance, or signature status.
- Add a second e-sign, pickup, or document subsystem alongside the existing one.
- Advance a deal from a UI event handler without a server-side guard.

## Acceptance criteria

- [ ] No new direct write to `deal.status` outside `deal.service.ts`.
- [ ] Any guard change has a failing-first test in `deal-state-machine.test.ts`.
- [ ] The Contract Shield gate (`CONTRACT_APPROVED → SIGNING_PENDING` only) holds.
- [ ] Fee/e-sign/webhook handlers are idempotent under replay.
- [ ] Every transition writes a timeline event with actor and reason.
- [ ] Buyer-facing deal reads are ownership-scoped.
- [ ] `pnpm test` and `pnpm test:admin-deals` pass.

## Cross-skill links

- `autolenis-buyer-journey` — the stages before acceptance; insurance quoting.
- `autolenis-auction-engine` — offer acceptance that calls `createDealFromOffer`.
- `autolenis-contract-shield` — what `CONTRACT_REVIEW → CONTRACT_APPROVED` means.
- `autolenis-payments-and-ledger` — service-fee money movement and refunds.
- `autolenis-integrations` — the DocuSign adapter contract.
- `autolenis-observability-sre` — crons that advance deals; stuck-deal runbooks.
- `autolenis-domain-model` — exact enum values and relations.

---

## DRIFT NOTE — `deal_timeline` is empty, and this skill used to send you to it

**Recorded at the Phase 9 close, 2026-09-17. Defect (9) of §8.2's Phase 9 list, confirmed in scope
by the owner with the instruction: record the drift, build no new timeline.**

### What is actually true

`lib/services/deal/deal-timeline.service.ts` exports three functions —
`recordTimelineEvent`, `getDealTimeline`, `recordStatusTransition` — and **all three have zero
callers** anywhere in `lib/`, `app/` or `components/`. `recordTimelineEvent` is the only writer of
the `deal_timeline` table, so **`deal_timeline` is empty and always has been.**

The live record of how a deal moved is **`DealStatusHistory`**, and it has four writers:

| Writer | What it records |
| --- | --- |
| `deal.service.ts` → `advanceDealStatus` | every guarded forward transition |
| `deal-creation.ts` | the deal's first status |
| `return-to-offers.service.ts` | the send-back |
| `pickup/pickup-completion.service.ts` | `PICKUP_SCHEDULED → HANDOVER_PENDING` and `→ COMPLETED` (Phase 9) |

`recordStatusTransition` writes to BOTH tables, which is why the two can look interchangeable when
you read that one function — but nothing calls it, so in practice one table is written by four
services and the other by nobody.

### Why this mattered enough to correct in place

This skill's "Diagnose a stuck deal" runbook opened with *"Read `getDealTimeline(dealId)` — the
transition history"*. An engineer following it on a genuinely stuck deal gets an empty array and
the reasonable conclusion that the deal has no recorded history — when four services have been
writing its history all along, to a different table.

**That is the repository's named failure class, in a skill rather than in code:** an artefact that
reports nothing, read as evidence that there was nothing to report. §8.1h of
`docs/transaction-flow/IMPLEMENTATION-WORKFLOW.md` catalogues eight instances of it across nine
phases — in runtime, in tests, in guards, in the written record, and in the investigation itself.
This is the same shape, one layer further out: in the guidance an engineer reads *before* the
investigation.

### What was NOT done

**No new timeline was built, and `deal-timeline.service.ts` was not deleted.** Two unused tables
would be worse than one, and CLAUDE.md is explicit that dead code is REPORTED for an owner decision
rather than removed. Whether `deal_timeline` and its service are dropped, or given the writer they
were designed for, is an owner decision that this note exists to put in front of one.

Until then: **read `DealStatusHistory`. It is the record.**
