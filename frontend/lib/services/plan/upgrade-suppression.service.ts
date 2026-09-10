// lib/services/plan/upgrade-suppression.service.ts
//
// §23.2b — "How the ask stays honest". Whether AutoLenis may PROMPT a buyer to upgrade.
//
// NOT the same question as `isUpgradeWindowOpen`, and conflating them breaks both
// directions. The window governs whether a buyer may BUY; this governs whether we may
// ASK. A buyer who comes to the upgrade page of their own accord must not be refused
// because we are forbidden to email them, and a buyer we are forbidden to email must not
// receive a prompt merely because their window is open.
//
// WHAT THIS PHASE OWNS, and what it does not. §8.2's Phase 3 bullet names four
// guardrails and excludes a fifth by name:
//
//   PAY-71  two emails, then silence; declined twice → never asked again.
//   PAY-72  never sold on fear.
//   PAY-74  suppressed on do-not-contact, dispute, chargeback, cancellation in
//           progress, and existing Premium.
//   PAY-77  measure impressions, dismissals and conversions per touchpoint, and stamp
//           the converting touchpoint onto the plan snapshot.
//
//   PAY-73  suppression while the transaction sits in an EXCEPTION state is NOT this
//           phase: E26-45, T35 and the Phase 10 scope own it, and the unqualified
//           phrase that stood in §8.2 implied otherwise (corrected 2026-09-09). It is
//           deliberately absent from the reasons below rather than stubbed, because a
//           predicate that always passes is worse than one that is not there — the next
//           reader cannot tell which it is.
//
// PAY-72 IS NOT A PREDICATE. "Never sold on fear" is a property of the COPY — no message
// may imply the deal goes worse on Standard, that Standard offers are weaker, or that
// any gate is slower. There is nothing here to evaluate at send time; it is enforced
// where the words are written, and it is named here so a reader looking for all four
// finds out where the fourth lives rather than concluding it was dropped.

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { depositNotOnHold } from "@/lib/payments/deposit-state";
import { entitledPlanForRequest } from "@/lib/services/buyer/plan-snapshot.service";

type Db = typeof prisma | Prisma.TransactionClient;

/** §23.2a's five touchpoints. The vocabulary PAY-77 measures against. */
export const UPGRADE_TOUCHPOINTS = {
  /** Payment confirmation — a single line on the receipt and the sourcing-started screen. */
  RECEIPT: "receipt",
  /** Alongside the Best Price Report. */
  BEST_PRICE_REPORT: "best_price_report",
  /** The full-screen invitation, once, immediately after offer acceptance. */
  POST_ACCEPTANCE: "post_acceptance",
  /** Email one hour after acceptance, only if the invitation was declined or dismissed. */
  POST_ACCEPTANCE_EMAIL: "post_acceptance_email",
  /** Email at dealer reaffirmation or recap. The second and final ask. */
  REAFFIRMATION_EMAIL: "reaffirmation_email",
} as const;

export type UpgradeTouchpoint = (typeof UPGRADE_TOUCHPOINTS)[keyof typeof UPGRADE_TOUCHPOINTS];

/** The two touchpoints that are EMAILS. §23.2b: two emails, then silence. */
export const EMAIL_TOUCHPOINTS: readonly UpgradeTouchpoint[] = [
  UPGRADE_TOUCHPOINTS.POST_ACCEPTANCE_EMAIL,
  UPGRADE_TOUCHPOINTS.REAFFIRMATION_EMAIL,
];

export type SuppressionReason =
  /** §23.2b — a do-not-contact flag. */
  | "do_not_contact"
  /** §23.2b — a payment dispute or chargeback on the $99. */
  | "payment_disputed"
  /** §23.2b — a cancellation in progress. */
  | "cancellation_in_progress"
  /** §23.2b — an existing Premium plan. Nothing left to sell. */
  | "already_premium"
  /** §23.2b — the two-email ceiling, or a buyer who declined twice. */
  | "asked_enough"
  /** The request is gone. */
  | "request_not_found";

export type SuppressionDecision =
  | { suppressed: false }
  | { suppressed: true; reason: SuppressionReason; detail: string };

export interface SuppressionInput {
  vehicleRequestId: string;
  buyerId: string;
  /** Which of the five §23.2a touchpoints is about to fire. */
  touchpoint: UpgradeTouchpoint;
  /**
   * How many upgrade EMAILS have already been sent for this request, and how many times
   * the buyer has declined. Passed in rather than counted here: the caller owns the
   * measurement surface (PAY-77), and a predicate that both counts and decides has two
   * reasons to change.
   */
  emailsSent?: number;
  declines?: number;
}

/**
 * `true` / `false` from the CRM contact, or `null` when it could not be read.
 *
 * Null is deliberately distinct from `true`: the caller reports a different reason for
 * each, so an operator seeing every prompt suppressed can tell a genuine flag from a
 * Supabase outage. Both suppress.
 */
async function readDoNotContact(email: string | null): Promise<boolean | null> {
  if (!email) return null;
  try {
    const { resolveDispatchContact } = await import("@/lib/crm/resolve-contact");
    const { getServiceSupabase } = await import("@/lib/supabase-service");
    const contact = await resolveDispatchContact(getServiceSupabase(), { email });
    // No contact means nobody has ever asked us to stop, and there is nothing to gate
    // an in-app prompt on. The send layer still refuses an email with no contact.
    if (!contact) return false;
    return contact.do_not_contact === true;
  } catch {
    return null;
  }
}

/** §23.2b — two emails, then silence. Never a third. */
export const MAX_UPGRADE_EMAILS = 2;
/** §23.2b — "a buyer who declines twice is not asked again". */
export const MAX_UPGRADE_DECLINES = 2;

/**
 * May AutoLenis prompt this buyer to upgrade?
 *
 * Fails CLOSED on anything it cannot establish. Silence is always a safe answer to
 * "should we ask them for money"; a prompt sent under a do-not-contact flag or a live
 * chargeback is not.
 *
 * THE IN-APP OPTION IS NOT A PROMPT. §23.2b: "The in-app option remains available
 * without further prompting." A suppressed decision stops the ASK — the dashboard link
 * stays where it is, and the buyer may still take it. Callers that render a persistent
 * link must not consult this; callers that render an interstitial, a banner or an email
 * must.
 */
export async function isUpgradePromptSuppressed(
  input: SuppressionInput,
  db: Db = prisma,
): Promise<SuppressionDecision> {
  const vr = await db.vehicleRequest.findUnique({
    where: { id: input.vehicleRequestId },
    select: { status: true, cancelledAt: true },
  });
  if (!vr) {
    return { suppressed: true, reason: "request_not_found", detail: "no such vehicle request" };
  }

  // CANCELLATION IN PROGRESS. Both halves: a stamped `cancelled_at` and a status that
  // has already reached CANCELLED. Asking someone to upgrade a transaction they are
  // ending is the §23.2b case that reads worst.
  if (vr.cancelledAt || vr.status === "CANCELLED") {
    return {
      suppressed: true,
      reason: "cancellation_in_progress",
      detail: "a cancellation is in progress or complete for this request",
    };
  }

  // ADMINISTRATIVE HOLDS. A suspended, disabled, archived or purged buyer is an
  // unambiguous "stop contacting this person", and it is on the buyer row.
  const buyer = await db.buyer.findUnique({
    where: { id: input.buyerId },
    select: {
      suspendedAt: true,
      disabledAt: true,
      archivedAt: true,
      purgedAt: true,
      user: { select: { email: true } },
    },
  });
  if (!buyer) {
    return { suppressed: true, reason: "request_not_found", detail: "no such buyer" };
  }
  if (buyer.suspendedAt || buyer.disabledAt || buyer.archivedAt || buyer.purgedAt) {
    return {
      suppressed: true,
      reason: "do_not_contact",
      detail: "an administrative hold is set on this buyer",
    };
  }

  // DO NOT CONTACT lives on the CRM CONTACT, not on the buyer — `contacts.do_not_contact`
  // is the flag every send path honours, and it is in Supabase rather than Prisma. Read
  // dynamically for the same reason the deposit-reminder producer does: the resolver
  // pulls `server-only` through the Supabase service client, and this predicate is
  // imported by page code.
  //
  // FAILS CLOSED. A prompt is never urgent, so missing one costs nothing; sending one
  // under a do-not-contact flag is a compliance event. When the flag cannot be read, the
  // ask does not go out.
  const dnc = await readDoNotContact(buyer.user?.email ?? null);
  if (dnc !== false) {
    return {
      suppressed: true,
      reason: "do_not_contact",
      detail:
        dnc === true
          ? "a do-not-contact flag is set on this buyer's CRM contact"
          : "the do-not-contact flag could not be read — failing closed rather than asking for money",
    };
  }

  // DISPUTE OR CHARGEBACK on the $99. A settled deposit that is on hold is not settled,
  // so this is the absence of one rather than a separate lookup: the same derived rule
  // the fulfilment gate and the credit basis read.
  const settledDeposit = await db.deposit.findFirst({
    where: {
      vehicleRequestId: input.vehicleRequestId,
      status: "PAID",
      refundedAt: null,
      ...depositNotOnHold(),
    },
    select: { id: true },
  });
  if (!settledDeposit) {
    return {
      suppressed: true,
      reason: "payment_disputed",
      detail:
        "no settled, unrefunded, undisputed $99 stands behind this request — a prompt here would " +
        "be selling a credit that is under dispute",
    };
  }

  // ALREADY PREMIUM, and paid for. Read from the LEDGER, not the flag: a buyer who
  // elected Premium and has not paid is exactly who §23.2a exists to ask.
  const entitled = await entitledPlanForRequest(input.vehicleRequestId, db);
  if (entitled.plan === "PREMIUM") {
    return { suppressed: true, reason: "already_premium", detail: "the Premium balance has settled" };
  }

  // TWO EMAILS, THEN SILENCE — and only for the email touchpoints. The in-app
  // touchpoints are not counted against this ceiling, because §23.2b's rule is about
  // emails and about the option staying quietly available.
  if ((input.declines ?? 0) >= MAX_UPGRADE_DECLINES) {
    return {
      suppressed: true,
      reason: "asked_enough",
      detail: `the buyer has declined ${input.declines} times — §23.2b: not asked again`,
    };
  }
  if (
    EMAIL_TOUCHPOINTS.includes(input.touchpoint) &&
    (input.emailsSent ?? 0) >= MAX_UPGRADE_EMAILS
  ) {
    return {
      suppressed: true,
      reason: "asked_enough",
      detail: `${input.emailsSent} upgrade emails have already been sent — §23.2b: never a third`,
    };
  }

  return { suppressed: false };
}
