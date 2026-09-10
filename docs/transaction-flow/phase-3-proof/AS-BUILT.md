# Phase 3 — as built

Implements §8.2 "#### Phase 3 — Payment gate, money model, plans, settlement opens the sourcing
case". Branch `claude/txflow-03-payment`, base `8fb9fd84`.

Read this with `CAPABILITY-MAP.md` (the before → after accounting §CLAUDE.md requires) and
`README.md` (the migration package).

## The sequencing guard, first

**Phase 3 must not reach production before Phase 5.** It removes the only path that invites
dealers and the replacement does not exist until Phase 5, so the legacy behaviour is kept **by
default** behind `SOURCING_CASE_REPLACES_AUCTION_LAUNCH`, and every settlement that takes it writes
a `LEGACY_PATH_WRITE` row. Registered as §13-D52; Phase 5 flips it. Flipping it early gives every
paying buyer an open sourcing case and no dealer, silently and with no failed job.

The default is not trusted, it is asserted: `settlement-effects.test.ts` fails if the flag defaults
on, if anything but the exact string `"true"` turns it on, or if the value is captured at module
load rather than read at call time.

## What was built, by §

| § | Built | Where |
| --- | --- | --- |
| §5a | Seven-condition eligibility recheck, each failure naming the exact missing item, and the `PAYMENT_REQUIRED` transition it gates | `lib/services/payment/deposit-eligibility.ts`, `app/api/buyer/deposit/create-intent/route.ts` |
| §5a | The code→step map, so a named failure routes the buyer to the step that fixes it | `ELIGIBILITY_STEP`, `app/buyer/deposit/page.tsx` |
| §5b | All seven disclosures, rendered before the card form, versioned, acceptance stored, gating the intent rather than the transition | `lib/payments/deposit-disclosures.ts`, `app/buyer/deposit/page.tsx` |
| §5c | The six-touch series on `comms_outbox`, keyed to the request, every-minute drain, with a state recheck that reads the request as well as the money | `lib/services/payment/deposit-reminder.service.ts`, `lib/services/comms/state-recheck-registry.ts` |
| §5d | Settlement: record, unlock, open the sourcing case with its checkpoints, bind the plan snapshot — atomically | `lib/services/payment/settlement-effects.service.ts` |
| §5d/§26 | Dispute and refund hold fulfilment and stop all unsent outreach on both rails; a won dispute lifts the hold and closes the Finance exception; a lost one refunds and keeps the hold | `lib/services/payment/fulfillment-hold.service.ts` |
| §26/§13-D12 | One rail for webhook gaps: the duplicate detector folded onto `raiseException`, keyed on the PaymentIntent | `lib/services/monitoring/health.service.ts`, `lib/services/payment/deposit-settlement.service.ts` |
| §22.1 | One refund primitive; never labels a no-charge record as refunded; refunds stay manual | `lib/services/payment/refund.service.ts` |
| §23.1 | Plan elected per request; election and entitlement separated | `lib/services/buyer/plan-snapshot.service.ts` |
| §23.2 | The upgrade window (open at settlement, shut on a broken credit basis, shut at funding clearance) and the $499-less-$99 quote from the settled ledger | `lib/services/plan/upgrade-window.service.ts` |
| §23.2a | Touchpoint 1 on the receipt and the sourcing-started screen | `lib/services/email/templates/deposit-confirmation.tsx`, `app/buyer/deposit/success/page.tsx` |
| §23.2b | The four guardrails this phase owns | `lib/services/plan/upgrade-suppression.service.ts` |
| §23.3 | Downgrade before and after settlement, concierge release, ownership back to the pool | `lib/services/plan/plan-change.service.ts` |
| §23.5 | Fee reconciliation from the ledger of settled payments | `lib/services/deal/service-fee.service.ts` |
| §11.6 4–5 | The commission ledger shape, asserted rather than asserted-about | `lib/services/affiliate/__tests__/commission-ledger-shape.test.ts` |

## The four money-path defects

1. **A card decline made `FAILED` terminal while the intent stayed live at Stripe.** `FAILED` now
   means the intent is DEAD; only `payment_intent.canceled` writes it. A retry on a live intent
   settles, and the reconciler sweeps `SETTLE_FROM` rather than `PENDING` alone.
2. **`buyer.plan` was a free flag that gated money.** Election and entitlement are now two
   functions with two names, and entitlement reads the ledger.
3. **`REFUND_TRIGGERED` advanced a deal to `REFUNDED` on a no-charge record, and `DEAL_CANCELLED`
   auto-refunded.** Split onto the `cancelDeal` seam and one refund primitive.
4. **Admin create-intent and send-link could issue a second $99 to a buyer who had already paid.**
   The provider-side obligation check now covers all three paths, request-scoped.

## Verification

Every command below ran in this session, against this branch, at `5153ae21` or later.

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | 0 errors |
| `pnpm lint` | 0 errors (warnings only, none introduced) |
| `pnpm test:coverage-check` | green — every test file reachable, every script chained |
| `pnpm test:all` | **EXIT 0 — 69 of 69 suites, 4108 tests, zero failures** |
| `next build` | **exit 0**, compiled successfully |
| `prisma migrate deploy` (throwaway loopback PG 17.6) | full chain applied to an empty database; re-apply reports no pending migrations |
| `DepositStatus` after the chain | `PENDING, PAID, REFUNDED, FAILED, DISPUTED` |
| `pnpm db:check-drift` | **no functional drift; structural drift at baseline** |
| `phase-3-proof/run-proof.sh` | PASSED, exit 0, on PostgreSQL 17.6 |

### Three buckets

**CODE-VERIFIED.** Everything in the table above. The money paths are covered by unit and
integration suites that exercise the real services against in-memory doubles: the deposit state
matrix, both gates of §5a, the disclosure module, the obligation check, the settlement effect and
its flag, the sourcing-case writer and its savepoint, the fulfilment hold in all four dispute
outcomes, the reminder producer's cadence and keying, the recheck, the one-rail fold, the upgrade
window, the quote, the downgrade, the suppression predicate, and the commission ledger shape.

**BROWSER-VERIFIED.** Read-only and unauthenticated only. The application was built and served
from loopback against a throwaway PostgreSQL 17.6 created for this session, and answered `200` on
the public root. No authenticated page was exercised in a browser.

**NOT VERIFIED**, stated plainly with what each would need:

- **Stripe provider integration.** All checkout journeys are exercised with Stripe mocked. No
  test-mode key was provisioned into this session, by the owner's ruling. Needs a Stripe test-mode
  key and a `payment_intent.succeeded` delivered by Stripe rather than by a test.
- **Authenticated browser journeys** — the checkout gate, the disclosure gate, the receipt line,
  the fee window gate and every admin route. This repository has no legitimate non-production
  authenticated environment, and buyer authentication is Supabase-backed, so a buyer session
  cannot be minted locally the way the admin JWT can. The new E2E assertions skip with an explicit
  reason rather than passing vacuously. Needs the isolated preview environment Phase 2 scopes.
- **The three Playwright journeys §8.2 names for this phase** (request → checkout → webhook →
  case opened with no auction row; declined-then-retry settles once; the Premium balance math).
  Same blocker. Their assertions exist at the unit and integration layer; what is missing is the
  browser.
- **The visual regression suite.** Ten marketing screenshots differ from the committed baseline by
  1–2% of pixels on this container. This branch touches **no** marketing file, the suite is not
  part of CI, and the delta is uniform across all five pages on both viewports — consistent with a
  renderer difference rather than a content change. Not attributed either way here. Needs a run on
  the machine that produced the baseline.
- **Production data shape.** Whether `email_confirmed_at` is populated for the existing buyer
  population (**§13-D53**, registered by this phase), how many deposits carry a null
  `vehicle_request_id`, and whether any historical Standard deal carries a settled service fee.
  This session held no production credential and ran nothing against production.

## Deploy order is a constraint, not a preference

`DepositStatus.DISPUTED` appears in **read** predicates that run on every checkout. Deploying the
application before the migration is applied makes PostgreSQL raise `22P02` on
`WHERE status IN (… 'DISPUTED')`, which is a 500 for every buyer at checkout rather than only for
disputed ones. **The migration is applied first**, through the per-run protocol, and verified in
both halves before the application deploy.

## Reported, not fixed

Each of these was found during the phase and is named here rather than acted on.

- **PAY-64a.** A Premium buyer who never pays the $400 is still stuck at `FEE_PENDING`; the ladder
  runs `FINANCING_PENDING → FEE_PENDING → FEE_PAID → INSURANCE_PENDING`. Fixing it is a
  `DealStatus` transition change, which §8.2's Phase 3 bullet does not carry and the deal-lifecycle
  phases own.
- **PAY-30's request scoping** of `isFulfillmentUnlocked`. No caller at Phase 3 has a request to
  pass; the VR-bearing callers arrive with Phase 5's sourcing and invitation services (PAY-40). The
  hold-awareness half, which is what makes §26's dispute row mean anything, is built.
- **`hasPaidDeposit` is not a duplicate.** It answers "has this buyer converted, stop chasing
  them?", where a hold still means yes. Folding it onto the hold-aware gate would dun a buyer for
  money they are actively contesting.
- **`service_fee_payments` has no reversal or refund column**, so a refunded $400 still reads as
  settled entitlement. §23.3's post-settlement downgrade produces a Stripe refund and no ledger
  fact to read.
- **`commissions` has no `reversedBy`** to match `approvedBy`, and `deal_id` is a bare column with
  no declared relation.
- **`RefundReason` has no chargeback label**, so a lost dispute leaves `refund_reason` null and
  records the fact in `hold_reason`.
- **§13-D48's copy contradiction is live.** The deposit confirmation email says the $99 "is
  credited toward your AutoLenis concierge fee when your deal closes" while §23.1 rules the $99 IS
  the Standard plan paid in full. The disclosures module is the corrected single source; the
  surrounding marketing copy is legal-approved wording and was not rewritten.
- **The concierge-conversion 23505** now raises after the money moves, which makes it Phase
  3-adjacent even though the fix is not this phase's (§7.4).
- **There is no concierge roster** — no rotation, availability or capacity — so §23.2's automatic
  same-day assignment has nobody to assign. The ownership move is built and an admin names the
  person.

## The second review's four questions, answered

The independent re-review closed with four questions rather than findings. Each is answered here
from the code, and one of them turned out to be material and was fixed.

**1. `recordFeePayment` has zero callers — future path, or obsolete?**
Obsolete as written, and **reported rather than deleted**, per the standing rule. It is documented
as dead at `frontend/lib/services/deal/service-fee.service.ts:239` and named again at
`frontend/app/api/webhooks/stripe/route.ts:714`, where the webhook writes the ledger row itself.
Making it the webhook's path would be a refactor of a settled money path for tidiness, which is not
this phase's to do; the owner decides whether it is removed.

**2. `plan_snapshots.settled_deposit_cents` has no reader — audit column, or dead?**
It **has a reader**, inside the service that owns it:
`recordRequestPlanElection` selects it (`plan-snapshot.service.ts:207`) and uses it as the
money-carrying discriminator (`:221`), which is what stops settlement's own election from being
discarded as a duplicate of an earlier PREMIUM election. What it deliberately is **not** is the
basis of any live money decision. `settledDepositCentsForRequest` (`:404-422`) reads the `deposits`
table instead, hold-aware and refund-aware, because the credit a buyer is owed **now** and the fact
that was true **when they elected** are two different questions. Recording the second in the
snapshot is the point of the column.

**3. `touchpoint: "admin_override"` / `"downgrade"` are not in `UPGRADE_TOUCHPOINTS` — drift?**
Two vocabularies, deliberately. `PlanTouchpoint` (`plan-snapshot.service.ts:38-47`) is the closed
union that governs `plan_snapshots.touchpoint` and answers *where was the election made*; it has
always carried `signup`, `checkout` and `admin_override`, and Phase 3 added `settlement` and
`downgrade`. `UPGRADE_TOUCHPOINTS` (`upgrade-suppression.service.ts:49-60`) is §23.2a's five
**upsell prompt positions** and answers *where may AutoLenis ask*. A downgrade is not a prompt
position; neither is an admin override. Not drift.

**4. The concierge path's unvalidated `disclosuresVersion` — does it matter?**
**Yes, and it is fixed.** On that branch `intentGate` is null, so nothing compared the client's
string to `DISCLOSURES_VERSION`, and an arbitrary value reached `deposits.disclosures_version` —
the column §13-D48's whole version mechanism relies on to prove which words a buyer agreed to.
`create-intent/route.ts` now derives `stampableDisclosuresVersion`, null unless the value is the
version in force, and all three stamp sites use it. The raw value is still parsed, because the
standard path's gate must see a stale version to answer `DISCLOSURE_REQUIRED`, and because nulling
it at the parse site would misclassify a stale checkout tab as a probe. Pre-existing rather than
introduced here; fixed because this route is where the column is written. Proven failing-first by
`create-intent-request-scope.test.ts` tests 8-10.

## Owner-gated

§13-**D48** (legal-approved checkout and receipt copy) · §13-**D10** (the six NULL-location buyers)
· §13-**D12** (enabling the settlement reconciler in production) · §13-**D27** (the six-touch
series on the every-minute drain) · §13-**D52** (the flag flip — Phase 5's) · §13-**D53**
(`email_confirmed_at` for the existing buyer population — registered by this phase).
