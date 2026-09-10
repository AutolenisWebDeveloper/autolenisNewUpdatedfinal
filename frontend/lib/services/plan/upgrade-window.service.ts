// lib/services/plan/upgrade-window.service.ts
//
// §23.2 — the Premium upgrade window, and what it costs.
//
//   Opens        the moment the $99 settles.
//   Closes       when funding clears.
//   What it costs  always the $400 balance, shown as $499 total less the $99 already
//                  paid. Never re-quoted, never prorated, never discounted by stage.
//   What must be true  the $99 is valid, paid, unrefunded and not charged back. Where
//                  it was refunded or charged back there is no credit, and Premium is
//                  $499 gross.
//
// WHAT WAS THERE BEFORE, and why each half is a money defect rather than a gap:
//
//   • The upgrade route had NO deposit check at all, and the card rendered before any
//     payment. A buyer could be Premium before paying the $99 the plan is built on.
//   • `writeServiceFeePayment` recorded `depositCreditCents: DEPOSIT_AMOUNT_CENTS`
//     unconditionally — the ledger asserted a $99 credit for buyers whose $99 was
//     refunded or charged back, which is PAY-52 exactly: the credit basis is broken and
//     the price is $499 gross. The DISPLAY side had already been fixed to look up a real
//     PAID deposit; the LEDGER had not, so the two disagreed and the ledger was wrong.
//
// WHY IT LIVES HERE. `lib/services/buyer/plan-snapshot.service.ts` owns the RECORD of
// what plan is in force; this owns the RULES about buying one. The parity ledger names
// `lib/services/plan/__tests__/upgrade-window.test.ts` for exactly this, and the phase
// scope guard declares the directory with that reason.
//
// PHASE BOUNDARY, stated rather than assumed. Phase 3 records the window OPENING. The
// CLOSE predicate reads `deals.funding_cleared_at`, and nothing writes that column until
// Phase 8's clearance service (§11.6 rulings 2–3, PAY-59a/59b). The close is therefore
// read HERE — it costs nothing and is correct the moment Phase 8 lands — but it can only
// ever be false today. That is stated in `closesWhen` rather than left for a reader to
// discover, because a predicate that cannot currently fire is otherwise indistinguishable
// from one that is broken.

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { PREMIUM_FEE_CENTS } from "@/lib/constants";
import {
  settledDepositCentsForRequest,
  entitledPlanForRequest,
} from "@/lib/services/buyer/plan-snapshot.service";

type Db = typeof prisma | Prisma.TransactionClient;

/** Why the window is shut. Each maps to a §23.2 / §23.2b rule. */
export type WindowClosedReason =
  /** The $99 has not settled, so the window has not opened. §23.2 "Opens". */
  | "deposit_not_settled"
  /** Funding cleared. §23.2 "Closes" — Phase 8 writes the column this reads. */
  | "funding_cleared"
  /** Already Premium, and paid for. §23.2b "Suppressed on holds". */
  | "already_premium"
  /** The request no longer exists. */
  | "request_not_found";

export type UpgradeWindow =
  | { open: true }
  | { open: false; reason: WindowClosedReason; detail: string };

/**
 * Is the Premium upgrade window open for this request?
 *
 * Three reads, in the order the rules are written.
 *
 * NOT a suppression check. §23.2b's do-not-contact, dispute, chargeback and
 * cancellation-in-progress holds govern whether AutoLenis may ASK; this governs whether
 * a buyer may BUY. They are different questions and conflating them would either stop a
 * buyer who came to us of their own accord, or let a prompt go out where §23.2b forbids
 * one. `isUpgradePromptSuppressed` is the other half.
 *
 * A dispute or chargeback DOES close the window here, though — not as a suppression but
 * because it removes the credit basis, and §23.2's "what must be true" is a condition on
 * the purchase itself. `settledDepositCentsForRequest` returns 0 for a held deposit, so
 * that falls out of the first read rather than being a fourth rule.
 */
export async function isUpgradeWindowOpen(
  vehicleRequestId: string,
  db: Db = prisma,
): Promise<UpgradeWindow> {
  const vr = await db.vehicleRequest.findUnique({
    where: { id: vehicleRequestId },
    select: { id: true },
  });
  if (!vr) {
    return { open: false, reason: "request_not_found", detail: `no vehicle request ${vehicleRequestId}` };
  }

  const settledDeposit = await settledDepositCentsForRequest(vehicleRequestId, db);
  if (settledDeposit <= 0) {
    return {
      open: false,
      reason: "deposit_not_settled",
      detail:
        "the window opens the moment the $99 settles (§23.2). No settled, unrefunded, " +
        "undisputed deposit is recorded for this request.",
    };
  }

  const entitled = await entitledPlanForRequest(vehicleRequestId, db);
  if (entitled.plan === "PREMIUM") {
    return {
      open: false,
      reason: "already_premium",
      detail: "the Premium balance has already settled for this request",
    };
  }

  // THE CLOSE. Reads `deals.funding_cleared_at`, which nothing writes until Phase 8
  // (§11.6 rulings 2–3). Correct now, inert now, and live the day the clearance service
  // ships — with no change here.
  const cleared = await db.deal.findFirst({
    where: { vehicleRequestId, fundingClearedAt: { not: null } },
    select: { id: true },
  });
  if (cleared) {
    return {
      open: false,
      reason: "funding_cleared",
      detail:
        "funding has cleared, so only scheduling and handover remain and pickup support " +
        "alone does not justify $400 (§23.2). An administrator may still open an upgrade " +
        "with an audited approval — never automatically (§23.2b, PAY-76).",
    };
  }

  return { open: true };
}

export interface PremiumQuote {
  /** Always $499. §23.2: "shown as $499 total less the $99 already paid". */
  grossCents: number;
  /** The settled $99, or 0 when the credit basis is broken. */
  creditCents: number;
  /** What is actually charged. */
  dueCents: number;
  /**
   * `settled_deposit` — a real, settled, unrefunded, undisputed $99 backs the credit.
   * `none` — there is no credit basis, so Premium is $499 gross (PAY-52, PAY-61).
   */
  creditBasis: "settled_deposit" | "none";
  /** Plain English, for the buyer-facing line and for an operator reading a ledger row. */
  explanation: string;
}

/**
 * What Premium costs for this request, computed from the LEDGER.
 *
 * §23.5: "Fee reconciliation always computes from the ledger of settled payments, never
 * from the current plan flag." The credit is the deposit that actually settled and is
 * not refunded, disputed or on hold — never `DEPOSIT_AMOUNT_CENTS` assumed.
 *
 * Never re-quoted, never prorated, never discounted by stage: the gross is the constant
 * and the only variable is whether the credit exists. There is no third answer.
 */
export async function quotePremiumBalance(
  vehicleRequestId: string,
  db: Db = prisma,
): Promise<PremiumQuote> {
  const creditCents = await settledDepositCentsForRequest(vehicleRequestId, db);

  if (creditCents <= 0) {
    // WHERE THIS PRICE IS ACTUALLY REACHABLE, since the question is a fair one: not from
    // the buyer's own route. `isUpgradeWindowOpen` shuts on the same read that zeroes
    // the credit, so a buyer whose $99 was refunded or charged back is refused before
    // they can be quoted. It is reachable through the ADMIN concierge-fee routes, which
    // take payment without the window, and that is the case §23.2's "Premium is $499
    // gross" is written for: an admin taking the balance from someone with no credit
    // basis must charge the whole thing.
    return {
      grossCents: PREMIUM_FEE_CENTS,
      creditCents: 0,
      dueCents: PREMIUM_FEE_CENTS,
      creditBasis: "none",
      explanation:
        "No settled, unrefunded, undisputed $99 is recorded for this request, so there is " +
        "no credit and Premium is $499 gross (§23.2, PAY-52/PAY-61).",
    };
  }

  return {
    grossCents: PREMIUM_FEE_CENTS,
    creditCents,
    dueCents: PREMIUM_FEE_CENTS - creditCents,
    creditBasis: "settled_deposit",
    explanation:
      `Premium is $499 in total, less the $${(creditCents / 100).toFixed(0)} already paid at the ` +
      `payment gate. Never a second $99 (§23.1).`,
  };
}
