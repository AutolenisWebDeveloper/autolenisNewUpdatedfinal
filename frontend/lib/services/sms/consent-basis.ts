// Phase 3 / Task 8a — the TCPA consent basis for the phone channel.
//
// WHY THIS MODULE EXISTS. The dealer outreach work needed SMS. The obvious move
// was a dedicated dealer send path — and that would have been a consent bypass
// implemented in architecture: sendCrmSms's consent check would still exist, and
// simply not be on the road dealer traffic takes. Instead the existing gate is
// WIDENED into an explicit basis that both callers evaluate.
//
// Deliberately free of `server-only` and of any SDK import, so the CRM path, the
// dealer path, a route, and the test runner can all read it.
//
// THREE INDEPENDENT QUESTIONS. They are not interchangeable and none overrides
// another:
//   consent basis  may we contact this person on the phone channel at all?
//   dnc_status     may this NUMBER be dialled? (only "not_found" clears)
//   phone_type     is this KIND of number acceptable? (mobile carries more risk)
// A valid consent basis does not clear a DNC listing, and neither clears a
// mobile number that policy has not allowed.

/**
 * Ordered strongest to weakest. NONE is a real value, not the absence of one —
 * storing it explicitly means "we looked and there is no basis", which is
 * different from "nobody has checked".
 */
export const CONSENT_BASES = [
  "EXPRESS_WRITTEN",
  "EXPRESS",
  "EXISTING_BUSINESS_RELATIONSHIP",
  "NONE",
] as const;

export type ConsentBasis = (typeof CONSENT_BASES)[number];

/** Bases that permit contact. NONE is absent by construction. */
const AFFIRMATIVE: readonly ConsentBasis[] = [
  "EXPRESS_WRITTEN",
  "EXPRESS",
  "EXISTING_BUSINESS_RELATIONSHIP",
];

/**
 * The ONLY dnc_status value that clears the phone channel.
 *
 * Apollo returns 'found' | 'not_found' | 'pending'. "pending" means the check
 * has not resolved — it is not a clearance, and treating it as one would dial
 * numbers whose status is genuinely unknown. NULL means never checked.
 */
export const DNC_CLEAR_STATUS = "not_found";

/**
 * Phone types permitted by default. Mobile is excluded: a mobile number carries
 * materially higher regulatory risk than a dealership's corporate line, and the
 * two must be separable. An unknown type is not permitted either — we do not
 * dial a number whose kind we cannot establish.
 */
export const DEFAULT_ALLOWED_PHONE_TYPES: readonly string[] = ["corporate_phone", "direct_phone"];

export type ConsentBlockReason = "NO_CONSENT_BASIS" | "DNC_BLOCKED" | "PHONE_TYPE_BLOCKED";

export interface ConsentEvaluationInput {
  basis: ConsentBasis | null | undefined;
  dncStatus: string | null | undefined;
  phoneType: string | null | undefined;
}

export interface ConsentEvaluationOptions {
  allowedPhoneTypes?: readonly string[];
  /**
   * Whether to apply the DNC and phone-type screens.
   *
   * Defaults to TRUE so a new caller fails closed. The CRM path passes false,
   * and that is not a loophole: CRM contacts are people who gave consent through
   * an AutoLenis form, and carry no vendor phone provenance at all — no
   * dnc_status, no phone_type. Screening on absent data would block every
   * existing CRM send, which is a regression, not a safeguard. The consent gate
   * itself is NEVER optional and applies to both callers.
   */
  screenPhone?: boolean;
}

export interface ConsentEvaluation {
  allowed: boolean;
  basis: ConsentBasis;
  reason?: ConsentBlockReason;
}

/** Coerce any stored value to a known basis. Anything unrecognised is NONE. */
function coerceBasis(value: unknown): ConsentBasis {
  return (CONSENT_BASES as readonly string[]).includes(value as string)
    ? (value as ConsentBasis)
    : "NONE";
}

/**
 * Decide whether the phone channel is open for one contact.
 *
 * Gate ORDER is deliberate, because the reason is shown to an operator and the
 * most fundamental blocker is the most useful thing to report. "No basis to
 * contact this person" does not go away by finding another number; "this number
 * is listed" might. So consent is reported first, then DNC, then phone type.
 */
export function evaluateConsentBasis(
  input: ConsentEvaluationInput,
  options?: ConsentEvaluationOptions,
): ConsentEvaluation {
  const basis = coerceBasis(input.basis);

  // The consent gate is unconditional. No option disables it.
  if (!AFFIRMATIVE.includes(basis)) {
    return { allowed: false, basis, reason: "NO_CONSENT_BASIS" };
  }
  if (options?.screenPhone === false) return { allowed: true, basis };

  if (input.dncStatus !== DNC_CLEAR_STATUS) {
    return { allowed: false, basis, reason: "DNC_BLOCKED" };
  }
  const allowedTypes = options?.allowedPhoneTypes ?? DEFAULT_ALLOWED_PHONE_TYPES;
  if (!input.phoneType || !allowedTypes.includes(input.phoneType)) {
    return { allowed: false, basis, reason: "PHONE_TYPE_BLOCKED" };
  }
  return { allowed: true, basis };
}

/**
 * Map the EXISTING CRM contact flags onto a basis.
 *
 * This preserves current behaviour exactly rather than widening it: a contact
 * with consent_sms could be texted before and maps to EXPRESS; one without could
 * not and maps to NONE; do_not_contact overrode everything and still does.
 */
export function crmContactConsentBasis(contact: {
  consent_sms?: boolean | null;
  do_not_contact?: boolean | null;
}): ConsentBasis {
  if (contact.do_not_contact) return "NONE";
  return contact.consent_sms ? "EXPRESS" : "NONE";
}

/**
 * Map a dealer contact profile's stored basis onto a known value.
 *
 * Nothing in this change writes anything but the NONE default, so every dealer
 * prospect evaluates to NONE and SMS reaches zero of them. That is the intended
 * outcome: these are vendor-sourced numbers with no consent record, and the
 * correct number of unconsented messages to send is none.
 */
export function dealerProspectConsentBasis(stored: string | null | undefined): ConsentBasis {
  return coerceBasis(stored);
}
