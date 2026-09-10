# Phase 3 — before → after capability map

`CLAUDE.md`'s capability-preservation invariant: *"Simplification is not feature removal. A
capability may be moved, regrouped, or made progressive — it may never silently disappear."* Every
route, control, action and workflow this phase touched is accounted for below with a disposition.
`REMOVED` requires explicit owner sign-off, and the two of them cite the authorisation.

**Counts.** 16 routes and pages · 14 services · 3 jobs/crons · 6 workflows = **39 entries**.
KEPT 14 · MOVED 4 · REGROUPED 5 · PROGRESSIVE 8 · RENAMED 0 · **REMOVED 2** (both authorised in
§8.2's Phase 3 bullet). 14 + 4 + 5 + 8 + 0 + 2 = **39**. The counts reconcile.

## Routes and pages

| # | Surface | Disposition | What actually happened |
| --- | --- | --- | --- |
| 1 | `POST /api/buyer/deposit/create-intent` | PROGRESSIVE | Every prior behaviour still works. Added: §5a's seven-condition recheck, the `PAYMENT_REQUIRED` transition, request-scoped obligation checking, the §5b disclosure gate immediately before the mint, and a probe shape (a call with no disclosure version) that cannot mint. |
| 2 | `/buyer/deposit` (checkout) | PROGRESSIVE | The card form, the concierge path, the already-charged block and the retry are all unchanged. Added: the seven §5b disclosures with an acceptance control, an `ALREADY_PAID` state, and the §5a code→step map so a named failure routes the buyer to the step that fixes it instead of a dead end. |
| 3 | `/buyer/deposit/success` | PROGRESSIVE | The payment-outcome logic is untouched. Added: §23.2a touchpoint 1, rendered only where activation may be claimed and only where §23.2b permits the ask. |
| 4 | `POST /api/buyer/deals/[dealId]/fee/create-intent` | PROGRESSIVE | Same duplicate-charge guards, same `CHARGE_UNSETTLED` contract. Added: the §23.2 upgrade-window gate this route had never had, and a ledger-priced amount instead of a constant. |
| 5 | `/buyer/deal/payment` | KEPT | Same two branches and the same server-decided charge. The displayed credit now comes from the same quote the charge does, so the page and the server cannot disagree. |
| 6 | `POST /api/buyer/plan/upgrade` | PROGRESSIVE | The free election is unchanged, by the owner's 2026-07 decision. Added: the request-bound snapshot, and `entitled: false` plus the window and balance in the response so a client cannot render "you are Premium" from a flag flip. |
| 7 | `POST /api/admin/buyers/[buyerId]/plan` | PROGRESSIVE | The flag write, the role gate, the reason requirement and the audit row are unchanged. Added: the plan snapshot, the concierge release and ownership move on a downgrade, the §23.3 Finance refund review where the balance had settled, and an optional named concierge on an upgrade. |
| 8 | `POST /api/admin/payments/deposit/create-intent` | KEPT | Unchanged except that the obligation check is now request-scoped, which restores the ability to issue a $99 for a repeat buyer's second request. |
| 9 | `POST /api/admin/payments/deposit/send-link` | KEPT | As above. |
| 10 | `POST /api/admin/payments/deposit/[depositId]/refund` | KEPT | Same route, same authorisation. It now routes through the one refund primitive, which also applies the §5d fulfilment hold. |
| 11 | `POST /api/admin/payments/deposit/[depositId]/mark-paid` | KEPT | Unchanged behaviour; reads the shared obligation check. |
| 12 | `POST /api/admin/deals/[dealId]/action` | **REMOVED** (one action's side effect) | `DEAL_CANCELLED` no longer auto-refunds, and `REFUND_TRIGGERED` no longer advances the deal to `REFUNDED` when the refund primitive reports `NO_CHARGE`. **Authorised by name** in §8.2's Phase 3 bullet, money-path defect 3: "the admin actions are split onto the existing `cancelDeal` seam (never refunds) and one refund primitive". Cancelling and refunding remain available as separate actions, which is §22.1's rule. |
| 13 | `POST /api/admin/auctions/[auctionId]/action` | KEPT | Touched only where it shared the refund path. |
| 14 | `/admin/payments/deposits` | PROGRESSIVE | Added `DISPUTED` to the status filter so the new label is reachable rather than findable only under "ALL". |
| 15 | `POST /api/webhooks/stripe` | PROGRESSIVE | Every existing branch still runs. Added: `payment_intent.canceled`, `charge.dispute.closed`, the settlement side effect, the fulfilment hold on dispute and refund, and the state gate that stops a late success acting on a refunded or disputed deposit. |
| 16 | `GET /api/cron/deposit-activation-reconcile` | PROGRESSIVE | Both stages still run. The settlement stage now applies the settlement effect with the flip and reports a failure instead of throwing past the activation stage. |

## Services

| # | Service | Disposition | Note |
| --- | --- | --- | --- |
| 17 | `lib/payments/deposit-state.ts` | REGROUPED | The matrix gains `DISPUTED` and per-event predecessor sets; a load-time assertion refuses any set wider than the matrix. `depositNotOnHold()` is added beside it as the one spelling of the derived hold rule. |
| 18 | `lib/services/payment/refund.service.ts` | REGROUPED | Three implementations consolidated to one primitive. `processRefund` survives as a thin adapter, and its one behaviour change is stated: it used to report failure for money that had already gone back. |
| 19 | `lib/services/payment/deposit-obligation.ts` | KEPT (new file, no predecessor) | The one provider-side obligation check the buyer route and both admin routes share. |
| 20 | `lib/services/payment/deposit-eligibility.ts` | KEPT (new) | §5a as a pure function plus its loader, returning both gates from one read. |
| 21 | `lib/services/payment/settlement-effects.service.ts` | KEPT (new) | The in-transaction half of §5d. |
| 22 | `lib/services/payment/fulfillment-hold.service.ts` | KEPT (new) | §5d/§26's dispute and refund hold, and its release. |
| 23 | `lib/services/payment/deposit-reminder.service.ts` | MOVED | The six-touch series, same words and same offsets, on `comms_outbox` instead of `lifecycle_touch_schedule`. |
| 24 | `lib/services/sourcing/sourcing-case.service.ts` | KEPT (new) | The writer for a table that had none. |
| 25 | `lib/services/plan/upgrade-window.service.ts` | KEPT (new) | §23.2's window and quote. |
| 26 | `lib/services/plan/plan-change.service.ts` | KEPT (new) | §23.3's downgrade and §23.2's ownership move. |
| 27 | `lib/services/plan/upgrade-suppression.service.ts` | KEPT (new) | §23.2b's four guardrails this phase owns. |
| 28 | `lib/services/buyer/plan-snapshot.service.ts` | PROGRESSIVE | Stage 1's buyer-level history is untouched. Added: the per-request binding, the money fields and the pointers. |
| 29 | `lib/services/deal/service-fee.service.ts` | PROGRESSIVE | Same duplicate-charge guards. The credit and the amount are now the ledger's answer rather than a constant. |
| 30 | `lib/services/monitoring/health.service.checkDepositProviderEvidence` | REGROUPED | Still detects the same rows; raises on the single exception rail instead of its own notification rail. |

## Jobs and workflows

| # | Capability | Disposition | Note |
| --- | --- | --- | --- |
| 31 | The $99 reminder cadence (six touches, 0/+1h/+6h/+24h/+72h/day-7) | MOVED | Same six offsets, same copy, keyed to the request, drained every minute instead of every fifteen. |
| 32 | The lifecycle touch drain for deposit reminders | KEPT | Still drains the rows in flight. It simply no longer receives new ones. |
| 33 | `scheduleLifecycleWorkload({workload: "deposit_reminder"})` | **REMOVED** (as a producer) | Stands down and records a `LEGACY_LIFECYCLE_ENROLLMENT` counter row. **Authorised by name** in §8.2's Phase 3 bullet: "its direct sender retired behind the compatibility adapter". Both rails enrolling would send every touch twice. |
| 34 | Settlement creating and launching an auction | PROGRESSIVE | Still happens, by default, behind `SOURCING_CASE_REPLACES_AUCTION_LAUNCH` and counted on every trip. Phase 5 flips it (§13-D52). |
| 35 | The deposit-activation reconciler's `create_auction` / `invite` / `close` branches | PROGRESSIVE | Same three branches, gated on the same flag, counted the same way. |
| 36 | Webhook-gap alerting | REGROUPED | Two rails become one `raiseException` keyed on the PaymentIntent. |
| 37 | The settlement reconciler | PROGRESSIVE | Same sweep, now applying the settlement effect with the flip. |
| 38 | Commission creation, approval, reversal and payout | KEPT | Untouched. Phase 3 owes only the ledger shape, which is now asserted by test. |
| 39 | Buyer checkout end to end | PROGRESSIVE | Every prior step still exists; the disclosures and the named-failure routing are additions. |

## Nothing else was removed

Two `REMOVED` entries, both named in §8.2's Phase 3 bullet before this branch existed. Everything
found "obsolete, duplicated, unfinished, misleading or dead" during the phase is REPORTED in the
STOP 2 record and in code comments — none of it was deleted.
