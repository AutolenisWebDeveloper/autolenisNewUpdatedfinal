// lib/payments/deposit-disclosures.ts
//
// §5b — the seven things a buyer must be shown before they pay the $99, in one place
// so the checkout screen and the receipt cannot drift apart.
//
// WHY ONE MODULE AND NOT TWO COPIES. §13-D48 exists because they already had: the
// checkout page said the $99 was an "Auction Access Deposit — refundable on request",
// and the confirmation email said it "is credited toward your AutoLenis concierge fee
// when your deal closes". Both contradict §23.1 ("The $99 is the Standard plan, paid in
// full") and §22 ("$400 — the balance of a $499 total, never a second $99"), and they
// contradict each other. Copy that lives in two files gets corrected in one.
//
// ─────────────────────────────────────────────────────────────────────────────
// OWNER GATE — §13-D48. NOT LEGALLY APPROVED YET.
//
// D48 asks for "legal-approved copy for the checkout disclosure and the receipt,
// written once and reused". This module is the "written once and reused" half. The
// WORDS are drafted from §5b and §22.1 and are NOT legal-approved, and bullet 7 (the
// published refund policy) is the one D48 is specifically about.
//
// `DISCLOSURES_VERSION` is what makes that safe to ship. A buyer's acceptance is stored
// with the version they accepted, and a version they have not accepted is not an
// acceptance — so when legal returns approved wording, bumping this constant invalidates
// every prior acceptance and re-asks, rather than silently treating agreement to these
// words as agreement to those. Nothing here can quietly become the approved text.
// ─────────────────────────────────────────────────────────────────────────────

import {
  DEPOSIT_AMOUNT_USD,
  PREMIUM_FEE_USD,
  PREMIUM_FEE_REMAINING_USD,
} from "@/lib/constants";

/**
 * Bump on ANY wording change. Stored on `deposits.disclosures_version` at acceptance;
 * the eligibility gate refuses an acceptance that names a different version.
 *
 * Date-shaped rather than a counter so an operator reading a deposit row can tell at a
 * glance which era of wording a buyer agreed to.
 */
export const DISCLOSURES_VERSION = "2026-09-09-draft";

/** True once legal has signed the wording off (§13-D48). Flip WITH the version bump. */
export const DISCLOSURES_LEGAL_APPROVED = false;

export interface Disclosure {
  /** Stable id — used by tests and by the acceptance UI, never shown to the buyer. */
  id: string;
  /** The sentence the buyer reads. */
  text: string;
  /** The clause of the specification this exists to satisfy. */
  source: string;
}

/**
 * All seven, in §5b's order. The order is the buyer's reading order: what they are
 * buying, then what it can grow into, then what it means for where their car comes
 * from, then what it does not commit them to, then how to get it back.
 */
export const DEPOSIT_DISCLOSURES: readonly Disclosure[] = [
  {
    id: "amount_is_the_plan",
    source: "§5b bullet 1; §23.1",
    text:
      `${DEPOSIT_AMOUNT_USD} is the Standard plan, paid in full — not a deposit against a larger fee. ` +
      `It activates dealer sourcing, your private auction, the offers, Contract Shield, signing and every ` +
      `release checkpoint.`,
  },
  {
    id: "premium_balance",
    source: "§5b bullet 2; §22, §23.2",
    text:
      `Premium can be added at any point until your financing clears, for the ${PREMIUM_FEE_REMAINING_USD} ` +
      `balance of a ${PREMIUM_FEE_USD} total — never a second ${DEPOSIT_AMOUNT_USD}.`,
  },
  {
    id: "radius_expansion",
    source: "§5b bullet 3",
    text:
      "If we can't find enough dealerships nearby, our search widens automatically from 100 to 150 and then " +
      "250 miles.",
  },
  {
    id: "out_of_state",
    source: "§5b bullet 4",
    text: "Participating dealerships may be in another state.",
  },
  {
    id: "beyond_250_needs_authorization",
    source: "§5b bullet 5",
    text: "We will never search beyond 250 miles without asking you first.",
  },
  {
    id: "no_obligation",
    source: "§5b bullet 6",
    text: "Paying does not obligate you to buy anything. If you don't like the offers, you don't have to take one.",
  },
  {
    id: "refund_policy",
    source: "§5b bullet 7; §22.1 — OWNER GATE §13-D48",
    text:
      "Refunds are reviewed by our team on request and are not automatic. Ask us and a person will look at " +
      "your case and tell you the decision, the amount and the reason.",
  },
] as const;

/**
 * The count is asserted rather than assumed. §5b has seven bullets, the Phase 3 scope
 * says "all seven", and a bullet lost in an edit would be a disclosure a buyer never
 * saw — the kind of omission that is invisible until it matters.
 */
export const REQUIRED_DISCLOSURE_COUNT = 7;

if (DEPOSIT_DISCLOSURES.length !== REQUIRED_DISCLOSURE_COUNT) {
  throw new Error(
    `deposit-disclosures: §5b requires ${REQUIRED_DISCLOSURE_COUNT} disclosures, this module has ` +
      `${DEPOSIT_DISCLOSURES.length}. A missing one is a disclosure the buyer never saw.`,
  );
}
