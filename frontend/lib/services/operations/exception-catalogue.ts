// lib/services/operations/exception-catalogue.ts
//
// The §26 exception register, as data.
//
// §26 requires that "every exception names an owner, a buyer-visible status, a
// required action, a deadline, and the return point in the same transaction."
// Those five facts are static — they are a property of the exception KIND, not of
// the row — so they live here once rather than being retyped at each raise site.
// `raiseException()` reads them from this table; a caller supplies only the code,
// the refs, and anything genuinely per-occurrence.
//
// WHY A CATALOGUE AND NOT A CHECK CONSTRAINT. The Phase 1 migration deliberately
// left `queue_items.buyer_visible_status` and `.required_action` free text with no
// CHECK (20261106000100_transaction_spine_foundation/migration.sql:628-635) and
// assigned authorship of the catalogue to this service. A database CHECK could not
// express "this string belongs to this code", and a per-call-site literal would
// drift the moment two sites raised the same code.
//
// COMPLETENESS. All 48 §26 rows are present, in document order, plus
// COMMS_TERMINAL_FAILURE — which the Markdown carries in §27 ("terminal-failure
// Operations alert") and the HTML renders in its exception register; §2 difference
// D2 rules it a §27 requirement rendered in §26, so it is catalogued here and
// counted separately. 49 entries.
//
// `raisedByPhase` records which implementation phase wires the raise site. Phase 2
// raises the ten entries marked 2; the rest are catalogued now so that Phase 10's
// completeness assertion (§8.3 — "every exception_code in the register has at
// least one raise site") has a register to assert against, and so that no later
// phase needs a second writer to introduce its own vocabulary.
//
// Run: pnpm test:operations

import type { QueueItemType, QueueOwnerRole } from "@prisma/client";

/**
 * §26's "Owner" column, mapped onto `QueueOwnerRole`. The enum has exactly the
 * eight values §26 uses; the mapping is total in both directions.
 */
const OWNER = {
  SYSTEM: "SYSTEM",
  BUYER: "BUYER",
  OPERATIONS: "OPERATIONS",
  FINANCE: "FINANCE",
  COMPLIANCE: "COMPLIANCE",
  BUYER_OPERATIONS: "BUYER_OPERATIONS",
  OPERATIONS_FINANCE: "OPERATIONS_FINANCE",
  BUYER_DEALER: "BUYER_DEALER",
} as const satisfies Record<QueueOwnerRole, QueueOwnerRole>;

export interface ExceptionDefinition {
  /** Stable machine key. Written to `queue_items.exception_code`. */
  readonly code: string;
  /** The `QueueItemType` bucket this exception belongs to. */
  readonly type: QueueItemType;
  /** §26 "Owner", as the enum. */
  readonly ownerRole: QueueOwnerRole;
  /** §26 "Exception" column, verbatim. */
  readonly label: string;
  /** §26 "Required result" column, verbatim. */
  readonly requiredResult: string;
  /**
   * What the buyer is told while this is open. `null` where the exception is
   * ops-only and the buyer has no visible state change — §26 requires a
   * buyer-visible status, but several rows are infrastructure conditions the
   * buyer is deliberately never shown (a provider quota, a sweep shortfall).
   * `null` is the explicit "no buyer-facing status", never an oversight.
   */
  readonly buyerVisibleStatus: string | null;
  /** The action the owner must take. Imperative, addressed to the owner. */
  readonly requiredAction: string;
  /**
   * Hours from creation to the deadline, or `null` where §26 states no clock.
   * `raiseException()` turns this into `deadline_at`.
   */
  readonly deadlineHours: number | null;
  /** Where the transaction resumes once this is resolved. §26 "return point". */
  readonly returnPoint: string;
  /** The phase that wires this code's raise site. */
  readonly raisedByPhase: number;
  /** Where the requirement is stated. */
  readonly specSection: string;
}

const DEFINITIONS: readonly ExceptionDefinition[] = [
  {
    code: "BUYER_UNVERIFIED",
    type: "SYSTEM_ALERT",
    ownerRole: OWNER.SYSTEM,
    label: "Buyer does not verify account",
    requiredResult: "Remind at 1h/24h/72h, then abandon draft",
    buyerVisibleStatus: "Verify your email to continue.",
    requiredAction: "Send the 1h/24h/72h reminder sequence, then mark the draft abandoned at 14 days without deleting it.",
    deadlineHours: 336,
    returnPoint: "Stage 1 — the verification link may be reissued at any time",
    raisedByPhase: 2,
    specSection: "§26; Stage 1; §6.4",
  },
  {
    code: "LOCATION_UNUSABLE",
    type: "SYSTEM_ALERT",
    ownerRole: OWNER.BUYER_OPERATIONS,
    label: "Onboarding location unusable",
    requiredResult: "Block location-dependent stages; specific correction task",
    buyerVisibleStatus: "We could not place your address. Correct the highlighted field to continue.",
    requiredAction: "Return the buyer to the specific field with a specific message; open a correction task for Operations if geocoding fails repeatedly.",
    deadlineHours: 72,
    returnPoint: "Stage 2 — onboarding address, at the failing field",
    raisedByPhase: 2,
    specSection: "§26; Stage 2",
  },
  {
    code: "PREQUAL_MANUAL_OR_OFAC_REVIEW",
    type: "PREQUAL_MANUAL",
    ownerRole: OWNER.COMPLIANCE,
    label: "Prequalification manual or OFAC review",
    requiredResult: "Hold and route to the responsible reviewer",
    buyerVisibleStatus: "Your application is under review. We will follow up with the outcome.",
    requiredAction: "Route to the responsible reviewer and hold the transaction; do not expose restricted screening information to the buyer.",
    deadlineHours: 48,
    returnPoint: "Stage 3 — prequalification outcome",
    raisedByPhase: 2,
    specSection: "§26; Stage 3",
  },
  {
    code: "PREQUAL_PROVIDER_DELAY",
    type: "PREQUAL_MANUAL",
    ownerRole: OWNER.SYSTEM,
    label: "Prequalification provider delay",
    requiredResult: "Retry and notify; honest processing notice",
    buyerVisibleStatus: "Your application is still processing. This is taking longer than usual.",
    requiredAction: "Retry the provider call and send the honest processing-delay notice.",
    deadlineHours: 24,
    returnPoint: "Stage 3 — prequalification outcome",
    raisedByPhase: 2,
    specSection: "§26; Stage 3",
  },
  {
    code: "PREQUAL_DECLINE",
    type: "PREQUAL_MANUAL",
    ownerRole: OWNER.COMPLIANCE,
    label: "Prequalification decline",
    requiredResult: "Decision and applicable adverse-action communication",
    buyerVisibleStatus: "We could not approve your application. Your decision notice explains why.",
    requiredAction: "Send the decision and the applicable adverse-action information; record delivery as sent, duplicate, or failed.",
    deadlineHours: 24,
    returnPoint: "Stage 3 — prequalification outcome",
    raisedByPhase: 2,
    specSection: "§26; Stage 3",
  },
  {
    code: "PREQUAL_APPROVAL_EXPIRED",
    type: "PREQUAL_MANUAL",
    ownerRole: OWNER.BUYER_OPERATIONS,
    label: "Approval expires mid-transaction",
    requiredResult: "Pause; require renewal before advancing",
    buyerVisibleStatus: "Your approval has expired. Renew it to continue.",
    requiredAction: "Pause the transaction and require renewal before it advances; never proceed on a stale ceiling.",
    deadlineHours: null,
    returnPoint: "Stage 3 — renewal of the prequalification",
    raisedByPhase: 2,
    specSection: "§26; Stage 3",
  },
  {
    code: "PAYMENT_FAILURE",
    type: "PAYMENT_EXCEPTION",
    ownerRole: OWNER.BUYER,
    label: "Payment failure",
    requiredResult: "Preserve request; allow safe retry",
    buyerVisibleStatus: "Your payment did not go through. Your request is saved — you can retry safely.",
    requiredAction: "Preserve the Vehicle Request and offer a safe retry path.",
    deadlineHours: null,
    returnPoint: "Stage 5 — the $99 checkout",
    raisedByPhase: 3,
    specSection: "§26; Stage 5",
  },
  {
    code: "PAYMENT_WEBHOOK_MISSED",
    type: "PAYMENT_EXCEPTION",
    ownerRole: OWNER.FINANCE,
    label: "Payment succeeded, webhook missed",
    requiredResult: "Reconcile from Stripe; alert with reference",
    buyerVisibleStatus: null,
    requiredAction: "Reconcile the payment from Stripe and alert Finance with the provider reference.",
    deadlineHours: 4,
    returnPoint: "Stage 5 — payment settlement",
    raisedByPhase: 3,
    specSection: "§26; Stage 5d",
  },
  {
    code: "PAYMENT_UNROUTABLE",
    type: "PAYMENT_EXCEPTION",
    ownerRole: OWNER.FINANCE,
    label: "Payment unroutable to an obligation",
    requiredResult: "Immediate exception; never absorbed",
    buyerVisibleStatus: null,
    requiredAction: "Raise immediately with the Stripe reference; never absorb the payment into an unrelated obligation.",
    deadlineHours: 4,
    returnPoint: "Stage 5 — payment settlement",
    raisedByPhase: 2,
    specSection: "§26; §3 orphan rule; Stage 5d",
  },
  {
    code: "PAYMENT_DISPUTED_OR_REFUNDED",
    type: "PAYMENT_EXCEPTION",
    ownerRole: OWNER.FINANCE,
    label: "Payment disputed or refunded",
    requiredResult: "Hold fulfillment; stop unsent outreach",
    buyerVisibleStatus: "Your payment is under review. Sourcing is on hold until it clears.",
    requiredAction: "Hold fulfilment and stop unsent outreach while the dispute is open.",
    deadlineHours: null,
    returnPoint: "Stage 5 — payment settlement",
    raisedByPhase: 3,
    specSection: "§26; §22.1",
  },
  {
    code: "NO_DEALER_COVERAGE_AT_MAX_RADIUS",
    type: "SOURCING_EXCEPTION",
    ownerRole: OWNER.BUYER_OPERATIONS,
    label: "No dealer coverage at 250 miles",
    requiredResult: "Request radius authorization; remind 24h/72h; close at 14 days",
    buyerVisibleStatus: "We need your permission to search further afield.",
    requiredAction: "Request radius authorisation from the buyer; remind at 24h and 72h; close at 14 days.",
    deadlineHours: 336,
    returnPoint: "Stage 6 — sourcing ladder",
    raisedByPhase: 5,
    specSection: "§26; Stage 6a",
  },
  {
    code: "ZERO_DEALER_COVERAGE",
    type: "SOURCING_EXCEPTION",
    ownerRole: OWNER.OPERATIONS,
    label: "Zero dealer coverage",
    requiredResult: "Review, then close or expand",
    buyerVisibleStatus: "We are reviewing dealer coverage for your request.",
    requiredAction: "Review the case, then close it or expand the search.",
    deadlineHours: 48,
    returnPoint: "Stage 6 — sourcing outcome",
    raisedByPhase: 5,
    specSection: "§26; Stage 6c",
  },
  {
    code: "INVITATION_BOUNCED",
    type: "DEALER_EXCEPTION",
    ownerRole: OWNER.OPERATIONS,
    label: "Invitation bounced",
    requiredResult: "Replace contact or rooftop inside the window",
    buyerVisibleStatus: null,
    requiredAction: "Replace the dealer contact or rooftop before the auction window closes.",
    deadlineHours: 12,
    returnPoint: "Stage 7 — invitations",
    raisedByPhase: 5,
    specSection: "§26; Stage 7",
  },
  {
    code: "ZERO_OFFERS_ALL_CANDIDATES",
    type: "AUCTION_EXCEPTION",
    ownerRole: OWNER.OPERATIONS,
    label: "Zero offers across every candidate",
    requiredResult:
      "Owned case; one relaunch without a second $99, or closure. Offers on some candidates and none on others is a success, not a failure",
    buyerVisibleStatus: "No dealer offers came in. We are reviewing your options with you.",
    requiredAction: "Own the case: relaunch once without a second $99, or close it. Partial coverage is a success, not a failure.",
    deadlineHours: 48,
    returnPoint: "Stage 8 — auction close",
    raisedByPhase: 6,
    specSection: "§26; Stage 8c",
  },
  {
    code: "CANDIDATE_STALE_MID_AUCTION",
    type: "INVENTORY_EXCEPTION",
    ownerRole: OWNER.OPERATIONS,
    label: "Shortlisted candidate goes stale or sells mid-auction",
    requiredResult: "Drop the candidate, tell the buyer, let the auction run on the rest",
    buyerVisibleStatus: "One of your vehicles is no longer available. Your auction continues on the rest.",
    requiredAction: "Drop the candidate, tell the buyer, and let the auction run on the remaining candidates.",
    deadlineHours: 4,
    returnPoint: "Stage 8 — the running auction",
    raisedByPhase: 6,
    specSection: "§26; §22a",
  },
  {
    code: "NO_IN_RADIUS_INVENTORY",
    type: "INVENTORY_EXCEPTION",
    ownerRole: OWNER.SYSTEM,
    label: "Buyer has no in-radius inventory",
    requiredResult: "Lead with the custom request; never present an empty grid",
    buyerVisibleStatus: "Nothing in stock matches yet — tell us what you want and we will find it.",
    requiredAction: "Lead with the custom request; never present an empty grid.",
    deadlineHours: null,
    returnPoint: "Stage 4 — vehicle definition",
    raisedByPhase: 4,
    specSection: "§26; §22a",
  },
  {
    code: "INVENTORY_PROVIDER_BUDGET_CEILING",
    type: "INVENTORY_EXCEPTION",
    ownerRole: OWNER.OPERATIONS,
    label: "Inventory provider call budget near or at its ceiling",
    requiredResult: "Alert before the ceiling, not after; the catalogue goes stale silently otherwise",
    buyerVisibleStatus: null,
    requiredAction: "Alert before the ceiling is reached, not after.",
    deadlineHours: 24,
    returnPoint: "Inventory ingestion — the sweep schedule",
    raisedByPhase: 4,
    specSection: "§26; §22a",
  },
  {
    code: "INVENTORY_SWEEP_SHORTFALL",
    type: "INVENTORY_EXCEPTION",
    ownerRole: OWNER.OPERATIONS,
    label: "Sweep returns fewer listings than expected",
    requiredResult: "Treat as a failed run, not a successful one; investigate before the catalogue decays",
    buyerVisibleStatus: null,
    requiredAction: "Treat the run as failed and investigate before the catalogue decays.",
    deadlineHours: 24,
    returnPoint: "Inventory ingestion — the failed run",
    raisedByPhase: 4,
    specSection: "§26; §22a",
  },
  {
    code: "NO_STORED_LOCATION_ON_INVENTORY",
    type: "INVENTORY_EXCEPTION",
    ownerRole: OWNER.SYSTEM,
    label: "Buyer has no stored location on the inventory page",
    requiredResult: "Ask for a ZIP before distances and shortlist actions; still render the catalogue",
    buyerVisibleStatus: "Add your ZIP to see distances and shortlist vehicles.",
    requiredAction: "Ask for a ZIP before distances and shortlist actions; still render the catalogue.",
    deadlineHours: null,
    returnPoint: "Inventory browse — the ZIP prompt",
    raisedByPhase: 4,
    specSection: "§26; §22a",
  },
  {
    code: "ALL_OFFERS_EXCEED_BUDGET",
    type: "OFFER_EXCEPTION",
    ownerRole: OWNER.OPERATIONS,
    label: "All offers exceed budget",
    requiredResult: "Never presented as qualified; route to recovery",
    buyerVisibleStatus: "The offers we received are above your approved amount. We are working on options.",
    requiredAction: "Never present them as qualified; route the case to recovery.",
    deadlineHours: 48,
    returnPoint: "Stage 9 — buyer selection",
    raisedByPhase: 6,
    specSection: "§26; Stage 9",
  },
  {
    code: "BUYER_DOES_NOT_SELECT",
    type: "OFFER_EXCEPTION",
    ownerRole: OWNER.BUYER_OPERATIONS,
    label: "Buyer does not select",
    requiredResult: "Remind before expiry; revalidate or close",
    buyerVisibleStatus: "Your offers expire soon. Choose one to continue.",
    requiredAction: "Remind before expiry, then revalidate or close.",
    deadlineHours: 72,
    returnPoint: "Stage 9 — buyer selection",
    raisedByPhase: 6,
    specSection: "§26; Stage 9",
  },
  {
    code: "WINNING_DEALER_REJECTS_OR_TIMES_OUT",
    type: "DEAL_EXCEPTION",
    ownerRole: OWNER.OPERATIONS,
    label: "Winning dealer rejects or times out",
    requiredResult: "Return buyer to remaining valid offers; scorecard entry",
    buyerVisibleStatus: "The dealership could not confirm. Your remaining offers are still available.",
    requiredAction: "Return the buyer to the remaining valid offers and write a scorecard entry.",
    deadlineHours: 12,
    returnPoint: "Stage 9 — remaining valid offers",
    raisedByPhase: 7,
    specSection: "§26; Stage 10",
  },
  {
    code: "DEALER_MATERIAL_CHANGE",
    type: "DEAL_EXCEPTION",
    ownerRole: OWNER.BUYER,
    label: "Dealer changes material terms",
    requiredResult: "Side-by-side accept or reject; above-ceiling changes refused",
    buyerVisibleStatus: "The dealership proposed a change. Review it side by side and accept or reject.",
    requiredAction: "Present the change side by side for accept or reject; refuse changes above the approved ceiling.",
    deadlineHours: 48,
    returnPoint: "Stage 10a — material changes",
    raisedByPhase: 7,
    specSection: "§26; Stage 10a",
  },
  {
    code: "VEHICLE_HOLD_EXPIRED",
    type: "DEAL_EXCEPTION",
    ownerRole: OWNER.OPERATIONS,
    label: "Vehicle hold expires",
    requiredResult: "Extend or release; released hold returns to offers",
    buyerVisibleStatus: "The hold on your vehicle has expired. We are confirming availability.",
    requiredAction: "Extend the hold or release it; a released hold returns the buyer to offers.",
    deadlineHours: 12,
    returnPoint: "Stage 10c — vehicle hold",
    raisedByPhase: 7,
    specSection: "§26; Stage 10c",
  },
  {
    code: "VEHICLE_SOLD_BEFORE_CONTRACT_OR_PICKUP",
    type: "DEAL_EXCEPTION",
    ownerRole: OWNER.OPERATIONS,
    label: "Vehicle sold before contract or pickup",
    requiredResult: "Return to offers or source a replacement",
    buyerVisibleStatus: "That vehicle is no longer available. We are finding you another.",
    requiredAction: "Return the buyer to offers or source a replacement.",
    deadlineHours: 24,
    returnPoint: "Stage 9 — remaining offers, or Stage 6 sourcing",
    raisedByPhase: 7,
    specSection: "§26; Stage 10c",
  },
  {
    code: "OUTSIDE_WINNER_FAILS_VERIFICATION",
    type: "DEALER_EXCEPTION",
    ownerRole: OWNER.OPERATIONS,
    label: "Outside winner fails verification",
    requiredResult: "Block advancement; return to remaining offers",
    buyerVisibleStatus: "We are verifying the dealership before your deal advances.",
    requiredAction: "Block advancement and return the buyer to the remaining offers.",
    deadlineHours: 48,
    returnPoint: "Stage 9 — remaining offers",
    raisedByPhase: 7,
    specSection: "§26; Stage 10b; §8.1",
  },
  {
    code: "RECAP_DISPUTED",
    type: "DEAL_EXCEPTION",
    ownerRole: OWNER.OPERATIONS,
    label: "Recap disputed",
    requiredResult: "Correct and reissue a new recap version",
    buyerVisibleStatus: "We are correcting your deal recap and will reissue it.",
    requiredAction: "Correct the numbers and reissue a new recap version.",
    deadlineHours: 24,
    returnPoint: "Stage 11 — final deal recap",
    raisedByPhase: 7,
    specSection: "§26; Stage 11",
  },
  {
    code: "FINANCING_FAILED_OR_EXPIRED",
    type: "FINANCING_EXCEPTION",
    ownerRole: OWNER.OPERATIONS_FINANCE,
    label: "Financing fails or expires",
    requiredResult: "Return buyer to another external path; do not auto-cancel",
    buyerVisibleStatus: "Your financing did not complete. We will help you find another path.",
    requiredAction: "Return the buyer to another external financing path; never auto-cancel the deal.",
    deadlineHours: 72,
    returnPoint: "Stage 12 — financing path selection",
    raisedByPhase: 7,
    specSection: "§26; Stage 12",
  },
  {
    code: "FUNDING_NOT_CLEARED",
    type: "FINANCING_EXCEPTION",
    ownerRole: OWNER.FINANCE,
    label: "Funding not cleared",
    requiredResult: "Block release",
    buyerVisibleStatus: "Funding has not cleared yet. Pickup is on hold until it does.",
    requiredAction: "Block release until funding clears.",
    deadlineHours: 48,
    returnPoint: "Stage 14 — funding clearance",
    raisedByPhase: 8,
    specSection: "§26; Stage 14",
  },
  {
    code: "TRADE_PAYOFF_QUOTE_STALE",
    type: "DEAL_EXCEPTION",
    ownerRole: OWNER.OPERATIONS,
    label: "Trade payoff quote stale",
    requiredResult: "Refresh before clearance",
    buyerVisibleStatus: "We need an up-to-date payoff quote for your trade.",
    requiredAction: "Refresh the payoff quote before funding clearance.",
    deadlineHours: 48,
    returnPoint: "Stage 14 — funding clearance",
    raisedByPhase: 8,
    specSection: "§26; Stage 14",
  },
  {
    code: "INSURANCE_REJECTED_OR_EXPIRED",
    type: "INSURANCE_EXCEPTION",
    ownerRole: OWNER.BUYER,
    label: "Insurance rejected or expired",
    requiredResult: "Name the defect; block release until corrected",
    buyerVisibleStatus: "Your insurance document needs a correction before pickup.",
    requiredAction: "Name the specific defect and block release until it is corrected.",
    deadlineHours: 72,
    returnPoint: "Stage 15 — insurance submission",
    raisedByPhase: 8,
    specSection: "§26; Stage 15",
  },
  {
    code: "CONTRACT_OVERDUE_FROM_DEALER",
    type: "CONTRACT_FAIL",
    ownerRole: OWNER.OPERATIONS,
    label: "Contract overdue from dealer",
    requiredResult: "Remind at deadline; escalate",
    buyerVisibleStatus: "We are waiting on the dealership's contract package.",
    requiredAction: "Remind at the deadline and escalate.",
    deadlineHours: 24,
    returnPoint: "Stage 13 — contract request",
    raisedByPhase: 8,
    specSection: "§26; Stage 13/14a",
  },
  {
    code: "CONTRACT_MISMATCH",
    type: "CONTRACT_FAIL",
    ownerRole: OWNER.OPERATIONS,
    label: "Contract mismatch",
    requiredResult: "Require correction and rescan; name discrepancies to both parties",
    buyerVisibleStatus: "Your contract does not match the agreed numbers. We have asked for a correction.",
    requiredAction: "Require a correction and a rescan; name the discrepancies to both parties.",
    deadlineHours: 24,
    returnPoint: "Stage 13 — Contract Shield",
    raisedByPhase: 8,
    specSection: "§26; Stage 13/14b",
  },
  {
    code: "CONTRACT_EXTRACTION_FAILURE",
    type: "CONTRACT_FAIL",
    ownerRole: OWNER.OPERATIONS,
    label: "Contract extraction failure",
    requiredResult: "Retry; never treat as approval",
    buyerVisibleStatus: "We are still reviewing your contract.",
    requiredAction: "Retry the extraction; never treat a failure as an approval.",
    deadlineHours: 12,
    returnPoint: "Stage 13 — Contract Shield",
    raisedByPhase: 8,
    specSection: "§26; Stage 13/14b",
  },
  {
    code: "SIGNATURE_NOT_COMPLETED",
    type: "ESIGN_EXCEPTION",
    ownerRole: OWNER.BUYER,
    label: "Buyer or co-buyer does not sign",
    requiredResult: "Remind, expire at 14 days, permit reissue",
    buyerVisibleStatus: "Your signature is still needed.",
    requiredAction: "Remind the required signer, expire at 14 days, and permit reissue.",
    deadlineHours: 336,
    returnPoint: "Stage 13 — signing",
    raisedByPhase: 8,
    specSection: "§26; Stage 13/14c",
  },
  {
    code: "DEALER_DOES_NOT_EXECUTE",
    type: "ESIGN_EXCEPTION",
    ownerRole: OWNER.OPERATIONS,
    label: "Dealer does not execute",
    requiredResult: "Escalate; release stays blocked",
    buyerVisibleStatus: "We are waiting on the dealership to countersign.",
    requiredAction: "Escalate; release stays blocked until the dealership executes.",
    deadlineHours: 24,
    returnPoint: "Stage 13 — dealer execution",
    raisedByPhase: 8,
    specSection: "§26; Stage 13/14d",
  },
  {
    code: "PICKUP_MISSED",
    type: "PICKUP_EXCEPTION",
    ownerRole: OWNER.BUYER_DEALER,
    label: "Pickup missed",
    requiredResult: "Return to scheduling; revoke and reissue token",
    buyerVisibleStatus: "Your pickup was missed. Choose a new time.",
    requiredAction: "Return the deal to scheduling; revoke and reissue the pickup token.",
    deadlineHours: 48,
    returnPoint: "Stage 17 — scheduling",
    raisedByPhase: 9,
    specSection: "§26; Stage 17",
  },
  {
    code: "ID_MISMATCH_AT_HANDOVER",
    type: "PICKUP_EXCEPTION",
    ownerRole: OWNER.OPERATIONS,
    label: "ID mismatch at handover",
    requiredResult: "Block release; urgent exception",
    buyerVisibleStatus: "We could not verify identity at handover. Please contact support.",
    requiredAction: "Block release and treat as urgent.",
    deadlineHours: 2,
    returnPoint: "Stage 18 — handover",
    raisedByPhase: 9,
    specSection: "§26; Stage 18",
  },
  {
    code: "TRADE_APPRAISAL_CHANGED_AT_HANDOVER",
    type: "PICKUP_EXCEPTION",
    ownerRole: OWNER.BUYER,
    label: "Trade appraisal changed at handover",
    requiredResult: "Buyer accepts; return to contract revision if the contract changes",
    buyerVisibleStatus: "Your trade appraisal changed. Review and accept, or we will revise the contract.",
    requiredAction: "Obtain the buyer's acceptance; return to contract revision if the contract changes.",
    deadlineHours: 24,
    returnPoint: "Stage 18 — handover, or Stage 13 contract revision",
    raisedByPhase: 9,
    specSection: "§26; Stage 18/19c",
  },
  {
    code: "DELIVERY_DISCREPANCY_REPORTED",
    type: "PICKUP_EXCEPTION",
    ownerRole: OWNER.OPERATIONS,
    label: "Buyer reports delivery discrepancy",
    requiredResult: "Hold completion; open case",
    buyerVisibleStatus: "We have your report and opened a case. Completion is on hold.",
    requiredAction: "Hold completion and open a case.",
    deadlineHours: 24,
    returnPoint: "Stage 19 — possession confirmation",
    raisedByPhase: 9,
    specSection: "§26; Stage 19",
  },
  {
    code: "RELEASED_BUT_NOT_CONFIRMED",
    type: "PICKUP_EXCEPTION",
    ownerRole: OWNER.OPERATIONS,
    label: "Dealer released, buyer has not confirmed",
    requiredResult: "Remind buyer; never complete automatically",
    buyerVisibleStatus: "Confirm you have the vehicle so we can complete your deal.",
    requiredAction: "Remind the buyer; never complete the deal automatically.",
    deadlineHours: 48,
    returnPoint: "Stage 19 — possession confirmation",
    raisedByPhase: 9,
    specSection: "§26; Stage 19",
  },
  {
    code: "CIRCUMVENTION_DETECTED",
    type: "DEALER_EXCEPTION",
    ownerRole: OWNER.OPERATIONS,
    label: "Circumvention detected",
    requiredResult: "Review; scorecard, suspension, or termination",
    buyerVisibleStatus: null,
    requiredAction: "Review the case and apply a scorecard entry, suspension, or termination.",
    deadlineHours: 48,
    returnPoint: "§25 — anti-circumvention review",
    raisedByPhase: 5,
    specSection: "§26; §25.2",
  },
  {
    code: "PREMIUM_BALANCE_UNPAID_AT_CLEARANCE",
    type: "PLAN_EXCEPTION",
    ownerRole: OWNER.BUYER,
    label: "Premium balance unpaid when funding clears",
    requiredResult: "Revert to Standard, which is already paid; continue without interruption",
    buyerVisibleStatus: "Your plan reverted to Standard, which is paid in full. Nothing else is due.",
    requiredAction: "Revert the buyer to Standard and continue without interruption.",
    deadlineHours: null,
    returnPoint: "Stage 14 — funding clearance",
    raisedByPhase: 8,
    specSection: "§26; §23.2",
  },
  {
    code: "PREMIUM_BALANCE_PAYMENT_FAILED",
    type: "PLAN_EXCEPTION",
    ownerRole: OWNER.BUYER,
    label: "Premium balance payment fails",
    requiredResult: "Retry and notify; the transaction never stalls and the buyer stays on Standard",
    buyerVisibleStatus: "Your Premium balance did not go through. You remain on Standard and your deal continues.",
    requiredAction: "Retry and notify; never stall the transaction.",
    deadlineHours: null,
    returnPoint: "§23.2a — the upgrade sequence",
    raisedByPhase: 8,
    specSection: "§26; §23.2a",
  },
  {
    code: "UPGRADE_PROMPT_DURING_OPEN_EXCEPTION",
    type: "PLAN_EXCEPTION",
    ownerRole: OWNER.OPERATIONS,
    label: "Upgrade prompt fires during an open exception",
    requiredResult: "Suppress; never upsell a buyer whose deal is stalled",
    buyerVisibleStatus: null,
    requiredAction: "Suppress the prompt; never upsell a buyer whose deal is stalled.",
    deadlineHours: null,
    returnPoint: "§23.2b — how the ask stays honest",
    raisedByPhase: 8,
    specSection: "§26; §23.2b",
  },
  {
    code: "DOWNGRADE_AFTER_PREMIUM_SETTLED",
    type: "PLAN_EXCEPTION",
    ownerRole: OWNER.FINANCE,
    label: "Downgrade requested after the Premium balance settled",
    requiredResult: "Manual refund review against the record of service delivered; the $99 is never refunded",
    buyerVisibleStatus: "Your downgrade request is under review. We will confirm the outcome.",
    requiredAction: "Run a manual refund review against the record of service delivered; never refund the $99.",
    deadlineHours: 120,
    returnPoint: "§23.3 — downgrade",
    raisedByPhase: 10,
    specSection: "§26; §23.3",
  },
  {
    code: "DEPOSIT_CHARGEBACK_AFTER_UPGRADE",
    type: "PAYMENT_EXCEPTION",
    ownerRole: OWNER.FINANCE,
    label: "The $99 is charged back after a Premium upgrade",
    requiredResult: "Finance exception; entitlement holds under review; never a silent downgrade",
    buyerVisibleStatus: null,
    requiredAction: "Hold the entitlement under review; never silently downgrade the buyer.",
    deadlineHours: 48,
    returnPoint: "§22.1 — refunds and disputes",
    raisedByPhase: 10,
    specSection: "§26; §23.4",
  },
  {
    code: "POST_COMPLETION_OBLIGATION_OVERDUE",
    type: "POST_COMPLETION_EXCEPTION",
    ownerRole: OWNER.OPERATIONS,
    label: "Post-completion obligation overdue",
    requiredResult: "Notify both parties; escalate; scorecard",
    buyerVisibleStatus: "An outstanding item from your purchase is overdue. We are chasing it.",
    requiredAction: "Notify both parties, escalate, and write a scorecard entry.",
    deadlineHours: 72,
    returnPoint: "Stage 21 — post-completion obligations",
    raisedByPhase: 9,
    specSection: "§26; Stage 21",
  },
  // §27's terminal-failure Operations alert. The Markdown states it in §27 rather
  // than in the §26 table; the HTML renders it in the exception register. §2
  // difference D2 rules it a §27 requirement rendered in §26 — so it is catalogued
  // here and counted separately from the 48.
  {
    code: "COMMS_TERMINAL_FAILURE",
    type: "COMMS_EXCEPTION",
    ownerRole: OWNER.OPERATIONS,
    label: "Communication terminal failure",
    requiredResult: "Alert Operations; the transaction never depends on a page request",
    buyerVisibleStatus: null,
    requiredAction: "Investigate the undeliverable message and reach the recipient another way.",
    deadlineHours: 4,
    returnPoint: "§27 — the dispatcher",
    raisedByPhase: 2,
    specSection: "§27; §2 difference D2",
  },
  // §3's orphan rule. The Markdown states it in §3 ("a payment, auction, offer,
  // deal, contract, or pickup that cannot resolve its parent is an orphan") rather
  // than as a §26 row; the payment half is PAYMENT_UNROUTABLE above, and this is
  // the half covering the other five classes. `QueueItemType.LINEAGE_ORPHAN`
  // exists for exactly this.
  {
    code: "LINEAGE_ORPHAN",
    type: "LINEAGE_ORPHAN",
    ownerRole: OWNER.OPERATIONS,
    label: "Record cannot resolve its parent",
    requiredResult: "Raise an Operations exception; never silently re-parent or duplicate into a parallel transaction",
    buyerVisibleStatus: null,
    requiredAction:
      "Identify the correct parent and re-parent through the audited admin action. Never write the parent id from a service.",
    deadlineHours: 48,
    returnPoint: "§3 — the transaction spine",
    raisedByPhase: 2,
    specSection: "§3",
  },
  // §7.2 (iv)'s remedy, which the register does not carry as a row of its own:
  // "flag, never merge". Two buyers sharing a normalised phone with different
  // verified emails are TWO identities under rule 16, and the resolver will not
  // merge them — a human decides, through an audited action. It was raised under
  // LINEAGE_ORPHAN, which told the operator to "identify the correct parent and
  // re-parent", instructions for a completely different condition, and counted it
  // among the orphans the reparent route reports as outstanding.
  //
  // `SUPPORT_TICKET` is an EXISTING QueueItemType label. A new enum label would
  // need a migration this phase must not add on top of an unapplied Phase 1 wave,
  // and the condition genuinely is a human-review item.
  {
    code: "POSSIBLE_DUPLICATE_BUYER",
    type: "SUPPORT_TICKET",
    ownerRole: OWNER.OPERATIONS,
    label: "Possible duplicate buyer",
    requiredResult: "A human decides whether these are one person; the system never merges on a phone",
    buyerVisibleStatus: null,
    requiredAction:
      "Open both buyer records and decide. Rule 16 forbids merging on a phone or a name — merge only through an audited admin action, and only on verified-email evidence.",
    deadlineHours: 72,
    returnPoint: "§5 — intake identity",
    raisedByPhase: 2,
    specSection: "§7.2 (iv); rule 16",
  },
] as const;

/** Every catalogued exception code. */
export type ExceptionCode = (typeof DEFINITIONS)[number]["code"];

const BY_CODE = new Map<string, ExceptionDefinition>(DEFINITIONS.map((d) => [d.code, d]));

if (BY_CODE.size !== DEFINITIONS.length) {
  // A duplicate code would silently shadow an earlier definition, so this is a
  // load-time failure rather than a test-time one.
  throw new Error("exception-catalogue: duplicate exception code");
}

/** The catalogue, in §26 document order. */
export const EXCEPTION_CATALOGUE: readonly ExceptionDefinition[] = DEFINITIONS;

/** Look up a definition, or `undefined` for an uncatalogued code. */
export function findException(code: string): ExceptionDefinition | undefined {
  return BY_CODE.get(code);
}

/**
 * Look up a definition, throwing for an uncatalogued code. `raiseException()`
 * uses this: an exception whose owner, deadline and return point are unknown is
 * not an exception §26 recognises, and inventing them at the call site is exactly
 * the drift the catalogue exists to prevent.
 */
export function requireException(code: string): ExceptionDefinition {
  const def = BY_CODE.get(code);
  if (!def) {
    throw new Error(
      `exception-catalogue: "${code}" is not in the §26 register. Add it to EXCEPTION_CATALOGUE with its owner, buyer-visible status, required action, deadline and return point.`
    );
  }
  return def;
}
