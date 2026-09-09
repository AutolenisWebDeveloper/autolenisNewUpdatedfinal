// lib/services/payment/deposit-eligibility.ts
//
// §5a — the eligibility recheck that runs BEFORE payment is offered, and names the
// exact missing requirement when it fails.
//
//   "Before payment is offered, confirm: active and verified account; completed
//    onboarding; usable geocoded location; approved and unexpired prequalification;
//    complete vehicle criteria; co-buyer and trade elections recorded; no conflicting
//    open request; and acceptance of the payment and distance disclosures.
//
//    Any failure returns the buyer to the exact missing requirement — named, not
//    generic."
//
// SEVEN CONDITIONS HERE, NOT THE EIGHT §5a LISTS. The co-buyer and trade elections
// clause moved to Phase 4 with its writer (§11.6 ruling 12): its predicate row PAY-06b
// was Phase 3 while every writer of those elections — PAY-06a, S3-02c, R14 — is Phase 4,
// so shipping the check now would refuse every buyer for a field nothing writes. It was
// NOT shipped inert. A predicate that always passes cannot be told apart from a missing
// one, and the next reader would have no way to know which they were looking at.
//
// TWO GATES, NOT ONE. §5b says eligibility passing is what moves a Vehicle Request to
// PAYMENT_REQUIRED, and §5b ALSO says the disclosures are shown "at checkout" — which
// is the state PAYMENT_REQUIRED unlocks. Read as one predicate those contradict: a
// request could never reach PAYMENT_REQUIRED, because acceptance is only obtainable on
// the surface that PAYMENT_REQUIRED opens. PAY-08 settles it — "Checkout captures
// acceptance … predicate blocks with DISCLOSURE_REQUIRED", acceptance evidence
// "Playwright: PI not created until acceptance". So the blocked artefact is the
// PaymentIntent, not the transition:
//
//   TRANSITION gate (to PAYMENT_REQUIRED) — six conditions, disclosures not yet shown.
//   INTENT gate (mint the PaymentIntent) — the same six, plus disclosure acceptance.
//
// This module is a PURE decision, in the style of `classifyPaymentConfirmation`:
// callers gather the facts and pass them in. That is what makes every branch testable
// without a database, and it is why the gathering is a separate, thin function.

import { isPrequalValid } from "@/lib/services/prequal/prequal.service";

/**
 * The named failures. §5a's "named, not generic" is the whole requirement, and PAY-09
 * makes the checkout client route each of these to the step that fixes it — so adding
 * a code here without adding it to that map leaves a buyer stuck on a message with
 * nowhere to go. The map is exhaustive over this union by type, so the compiler says so.
 */
export type EligibilityFailureCode =
  | "ACCOUNT_INACTIVE"
  | "EMAIL_UNVERIFIED"
  | "ONBOARDING_REQUIRED"
  | "LOCATION_REQUIRED"
  | "PREQUAL_REQUIRED"
  | "VEHICLE_CRITERIA_INCOMPLETE"
  | "REQUEST_CONFLICT"
  | "DISCLOSURE_REQUIRED";

export interface EligibilityFacts {
  buyer: {
    id: string;
    onboardingComplete: boolean;
    city: string | null;
    state: string | null;
    zip: string | null;
    disabledAt: Date | null;
    purgedAt: Date | null;
    isSuspended?: boolean | null;
  };
  /** From the Supabase session (`email_confirmed_at`), not from our own User row. */
  emailConfirmedAt: Date | null;
  prequal: { decision: string; expiresAt: Date } | null;
  request: {
    id: string;
    status: string;
    makePreference: string | null;
    modelPreference: string | null;
    maxBudgetCents: number | null;
  };
  /** Open Vehicle Requests for this buyer OTHER than the one being paid for. */
  otherOpenRequestIds: string[];
  /** `deposits.disclosures_accepted_at` for the deposit being created, if any. */
  disclosuresAcceptedAt: Date | null;
  /** The disclosure version the buyer accepted, if any. */
  disclosuresVersion: string | null;
}

export interface EligibilityFailure {
  eligible: false;
  code: EligibilityFailureCode;
  /** The requirement, named. Shown to the buyer. */
  message: string;
  /** Which field or item is missing, for the client's code→step map (PAY-09). */
  missing: string;
}

export type EligibilityResult = { eligible: true } | EligibilityFailure;

export interface EligibilityOptions {
  /**
   * True for the INTENT gate, false for the TRANSITION gate. See the header: the
   * disclosures are shown on the surface that PAYMENT_REQUIRED unlocks, so requiring
   * their acceptance to REACH that state would be a deadlock.
   */
  requireDisclosureAcceptance: boolean;
  /** The disclosure version currently in force. An acceptance of an older one is stale. */
  currentDisclosuresVersion?: string;
}

function fail(code: EligibilityFailureCode, missing: string, message: string): EligibilityFailure {
  return { eligible: false, code, message, missing };
}

/**
 * Order matters and is not alphabetical. Conditions are checked from the most
 * fundamental outward — account, then onboarding, then the facts about this buyer,
 * then the facts about this request — so the FIRST thing a buyer is told to fix is the
 * thing that has to be fixed first. Telling someone their budget is missing when their
 * account is suspended sends them down a road that ends in the same refusal.
 */
export function checkPaymentEligibility(
  facts: EligibilityFacts,
  opts: EligibilityOptions,
): EligibilityResult {
  const { buyer } = facts;

  // 1. Active and verified account.
  if (buyer.disabledAt || buyer.purgedAt || buyer.isSuspended) {
    return fail(
      "ACCOUNT_INACTIVE",
      "account",
      "Your account is not currently active, so payment can't be taken. Contact support and we'll sort it out.",
    );
  }
  if (!facts.emailConfirmedAt) {
    return fail(
      "EMAIL_UNVERIFIED",
      "email",
      "Confirm your email address before paying. We've sent you a link — check your inbox, including spam.",
    );
  }

  // 2. Completed onboarding.
  if (!buyer.onboardingComplete) {
    return fail(
      "ONBOARDING_REQUIRED",
      "onboarding",
      "Finish setting up your account before paying. It takes a minute and we'll bring you straight back here.",
    );
  }

  // 3. Usable geocoded location.
  //
  // City AND state AND ZIP, all three. The bar is not "a ZIP was typed" — it is
  // whether dealer sourcing can resolve coordinates for it, and that resolver tries
  // `geocodeZip(zip)` then `lookupCity(city, state)`. A buyer with only a ZIP is
  // one unset GOOGLE_GEOCODING_API_KEY away from being unsourceable, which is a
  // failure that would surface AFTER they had paid.
  //
  // This is also the condition §13-D10's ten NULL-location buyers sit behind. They
  // stay ineligible, named, until a human obtains a real address — which is the
  // correct outcome, not a residue to be waived.
  const missingLocation = [
    !buyer.city && "city",
    !buyer.state && "state",
    !buyer.zip && "ZIP code",
  ].filter(Boolean) as string[];
  if (missingLocation.length > 0) {
    return fail(
      "LOCATION_REQUIRED",
      missingLocation.join(", "),
      `We need your ${missingLocation.join(", ")} before we can find dealerships near you. ` +
        `Add it to your profile and we'll pick up where you left off.`,
    );
  }

  // 4. Approved and unexpired prequalification. Folded in unchanged (PAY-04) — one
  // definition of a valid prequal in this codebase, and this is a caller of it.
  if (!isPrequalValid(facts.prequal)) {
    return fail(
      "PREQUAL_REQUIRED",
      "prequalification",
      facts.prequal
        ? "Your prequalification has expired or wasn't approved. Run it again — it takes about a minute."
        : "Complete your prequalification before paying, so we know what to shop for.",
    );
  }

  // 5. Complete vehicle criteria.
  //
  // WHAT "COMPLETE" MEANS, stated because the specification does not enumerate it and
  // guessing wrongly here is how a gate refuses everyone (see PAY-06b). Required:
  // a budget, and at least one of make or model. NOT required: a year floor — a buyer
  // open to any model year is expressing a real preference, not an incomplete one, and
  // demanding it would invent a rule §5a does not state. Every field required here is
  // one the buyer can supply on a surface that exists today.
  const missingCriteria: string[] = [];
  if (!facts.request.makePreference && !facts.request.modelPreference) {
    missingCriteria.push("make or model");
  }
  if (!facts.request.maxBudgetCents || facts.request.maxBudgetCents <= 0) {
    missingCriteria.push("budget");
  }
  if (missingCriteria.length > 0) {
    return fail(
      "VEHICLE_CRITERIA_INCOMPLETE",
      missingCriteria.join(", "),
      `Add the ${missingCriteria.join(" and ")} to your request so dealers know what to bid on.`,
    );
  }

  // 6. No conflicting open request.
  //
  // The database enforces one open request per buyer, so this is not the guard of last
  // resort — it exists so the buyer is TOLD, in the checkout, rather than meeting a
  // unique-violation. Any other open request means this payment would activate sourcing
  // for a request the buyer may not have meant to pay for.
  if (facts.otherOpenRequestIds.length > 0) {
    return fail(
      "REQUEST_CONFLICT",
      "open request",
      "You already have another vehicle request in progress. Finish or cancel it before starting this one — " +
        "we run one search at a time so dealers compete on a single, clear brief.",
    );
  }

  // 7. Acceptance of the payment and distance disclosures. INTENT gate only.
  if (opts.requireDisclosureAcceptance) {
    if (!facts.disclosuresAcceptedAt) {
      return fail(
        "DISCLOSURE_REQUIRED",
        "disclosures",
        "Please read and accept what the $99 covers before paying.",
      );
    }
    if (
      opts.currentDisclosuresVersion &&
      facts.disclosuresVersion !== opts.currentDisclosuresVersion
    ) {
      // A stale acceptance is not an acceptance. The buyer agreed to different words.
      return fail(
        "DISCLOSURE_REQUIRED",
        "disclosures",
        "These terms have been updated since you last read them. Please review and accept the current version.",
      );
    }
  }

  return { eligible: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// The gathering half. Deliberately thin and separate: the decision above is pure so
// every branch is testable without a database, and everything that touches Prisma or
// Supabase lives here where it can be mocked in one place.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { OPEN_REQUEST_STATUSES } from "@/lib/services/vehicle-request/open-request.service";
import { DISCLOSURES_VERSION } from "@/lib/payments/deposit-disclosures";

export interface GatherEligibilityInput {
  buyerId: string;
  requestId: string;
  /** The disclosure version the caller says the buyer just accepted, if any. */
  acceptedDisclosuresVersion: string | null;
  /** From `getRequestUser(request)`. Null when the caller could not resolve it. */
  emailConfirmedAt: Date | null;
}

/**
 * Gather the §5a facts and decide.
 *
 * Both gates run here in one pass: the transition gate decides whether the request may
 * enter PAYMENT_REQUIRED, and the intent gate adds disclosure acceptance. Callers that
 * are about to mint a PaymentIntent want the second; the transition itself wants the
 * first. Running both from one set of facts is what stops them disagreeing.
 */
export async function gatherAndCheckEligibility(input: {
  buyerId: string;
  requestId: string;
  acceptedDisclosuresVersion: string | null;
  emailConfirmedAt: Date | null;
}): Promise<EligibilityResult & { code?: EligibilityFailureCode; message?: string; missing?: string }> {
  const [buyer, request, otherOpen] = await Promise.all([
    prisma.buyer.findUnique({
      where: { id: input.buyerId },
      select: {
        id: true,
        onboardingComplete: true,
        city: true,
        state: true,
        zip: true,
        disabledAt: true,
        purgedAt: true,
        isSuspended: true,
        preQualification: { select: { decision: true, expiresAt: true } },
      },
    }),
    prisma.vehicleRequest.findUnique({
      where: { id: input.requestId },
      select: {
        id: true,
        status: true,
        makePreference: true,
        modelPreference: true,
        maxBudgetCents: true,
      },
    }),
    prisma.vehicleRequest.findMany({
      where: {
        buyerId: input.buyerId,
        id: { not: input.requestId },
        status: { in: [...OPEN_REQUEST_STATUSES] },
      },
      select: { id: true },
    }),
  ]);

  // A missing buyer or request is not an eligibility question — it is a caller error,
  // and reporting it as "you are not eligible" would send the buyer to fix something
  // that is not theirs to fix.
  if (!buyer) throw new Error(`gatherAndCheckEligibility: buyer ${input.buyerId} not found`);
  if (!request) throw new Error(`gatherAndCheckEligibility: request ${input.requestId} not found`);

  return checkPaymentEligibility(
    {
      buyer,
      emailConfirmedAt: input.emailConfirmedAt,
      prequal: buyer.preQualification ?? null,
      request,
      otherOpenRequestIds: otherOpen.map((r) => r.id),
      // Acceptance is captured at the moment the PaymentIntent is requested, which is
      // what PAY-08's "PI not created until acceptance" means. There is no earlier row
      // to read it from, because the deposit may not exist yet.
      disclosuresAcceptedAt: input.acceptedDisclosuresVersion ? new Date() : null,
      disclosuresVersion: input.acceptedDisclosuresVersion,
    },
    { requireDisclosureAcceptance: true, currentDisclosuresVersion: DISCLOSURES_VERSION },
  );
}
