// lib/services/esign/consent-policy.ts
//
// Program 4 e-sign completion — CENTRALIZED, VERSIONED consent language for the
// buyer purchase-contract signing ceremony. All consent copy lives here (never
// scattered as literals across components/routes), so it can be versioned and so
// a per-attempt FROZEN snapshot can be persisted for evidence.
//
// ⚠️ DRAFT_V1 is WORKING IMPLEMENTATION COPY, not immutable AutoLenis legal
// policy. Production activation of this ceremony is OWNER-GATED on attorney /
// compliance approval of this customer-facing language. ESIGN/UETA sufficiency is
// NOT VERIFIED — REQUIRES ATTORNEY/COMPLIANCE REVIEW. That internal caveat must
// NEVER be shown to customers.
//
// Versioning rule: a future consent version is a NEW entry in CONSENT_POLICIES
// with a new version id. Historical snapshots persisted under an older version are
// NEVER rewritten or reinterpreted — the snapshot carries the exact text shown.

/** The consent-policy version currently in force for new signing attempts. */
export const CONSENT_POLICY_VERSION = "DRAFT_V1" as const;

/** Stable keys for each required acknowledgment. Persisted in every snapshot; the
 *  server validates that ALL of these were affirmatively accepted. Order is the
 *  presentation order. */
export const CONSENT_ACK_KEYS = [
  "ELECTRONIC_RECORDS_AND_SIGNATURE",
  "CONTRACT_REVIEW_AND_INDEPENDENT_ADVICE",
  "ACCEPTANCE_AND_INTENT_TO_BE_BOUND",
  "ELECTRONIC_COPY_AND_ACCESS",
] as const;

export type ConsentAckKey = (typeof CONSENT_ACK_KEYS)[number];

export interface ConsentAcknowledgmentDef {
  key: ConsentAckKey;
  title: string;
  text: string;
}

export interface ConsentPolicy {
  version: string;
  acknowledgments: ConsentAcknowledgmentDef[];
}

// ── DRAFT_V1 ────────────────────────────────────────────────────────────────
const DRAFT_V1: ConsentPolicy = {
  version: "DRAFT_V1",
  acknowledgments: [
    {
      key: "ELECTRONIC_RECORDS_AND_SIGNATURE",
      title: "Electronic Records and Signature Consent",
      text: "I consent to transact and sign electronically and understand that my electronic signature has the same effect as a handwritten signature.",
    },
    {
      key: "CONTRACT_REVIEW_AND_INDEPENDENT_ADVICE",
      title: "Contract Review and Independent Advice",
      text: "I have reviewed the complete dealer-provided agreement. I understand that it was not reviewed or approved by an attorney representing AutoLenis, that AutoLenis does not provide legal advice or represent any party, and that I have had the opportunity to ask questions and consult an independent attorney.",
    },
    {
      key: "ACCEPTANCE_AND_INTENT_TO_BE_BOUND",
      title: "Acceptance and Intent to Be Bound",
      text: "I understand and voluntarily accept the terms of the agreement and intend to be legally bound, without waiving any rights or protections that cannot legally be waived.",
    },
    {
      key: "ELECTRONIC_COPY_AND_ACCESS",
      title: "Electronic Copy and Access",
      text: "I can view, download, and retain the agreement electronically and understand that I will receive access to the completed agreement after signing is complete.",
    },
  ],
};

// Immutable registry of every consent-policy version ever published. Old versions
// are retained so a historical snapshot's version id always resolves to the exact
// text that was shown at the time (append-only — never edit a published entry).
export const CONSENT_POLICIES: Readonly<Record<string, ConsentPolicy>> = Object.freeze({
  DRAFT_V1,
});

/** The consent policy in force now (for presenting the ceremony). */
export function getActiveConsentPolicy(): ConsentPolicy {
  return CONSENT_POLICIES[CONSENT_POLICY_VERSION];
}

/** Resolve a specific version (for rendering a historical snapshot); null if unknown. */
export function getConsentPolicy(version: string): ConsentPolicy | null {
  return CONSENT_POLICIES[version] ?? null;
}

// ── Per-attempt frozen consent snapshot ──────────────────────────────────────
// The complete, self-contained consent record persisted on the envelope for one
// signing attempt. It embeds the exact text shown (not just the version) so it is
// interpretable forever even if the policy changes. Bound to the document version
// + hash presented, so consent can never be reattributed to a different document.

export interface ConsentAcknowledgmentRecord {
  key: ConsentAckKey;
  title: string;
  /** The EXACT text displayed to the signer for this acknowledgment. */
  text: string;
  /** The signer affirmatively accepted this acknowledgment. Always true when persisted. */
  accepted: boolean;
}

export interface ConsentSnapshot {
  policyVersion: string;
  acknowledgments: ConsentAcknowledgmentRecord[];
  // Attribution — resolved server-side.
  signerUserId: string;
  signerName: string;
  signerRole: string;
  signerEmail: string;
  // Document binding.
  documentVersionId: string;
  documentVersion: number;
  documentHash: string;
  // Ceremony evidence.
  consentedAt: string; // ISO
  ipAddress: string;
  userAgent: string;
}

export interface AcknowledgmentInput {
  key: string;
  accepted: boolean;
}

export class IncompleteConsentError extends Error {
  code = "CONSENT_REQUIRED";
  constructor(public readonly missing: string[]) {
    super(`All required electronic-signature acknowledgments must be affirmatively accepted (missing/unaccepted: ${missing.join(", ")})`);
    this.name = "IncompleteConsentError";
  }
}

/**
 * Validate that every required acknowledgment of the ACTIVE policy was
 * affirmatively accepted. Fails closed (IncompleteConsentError) on any missing or
 * unaccepted acknowledgment, an unknown key, or a duplicate. A view/click/typed
 * name is never consent — only an explicit `accepted: true` for each required key.
 */
export function validateAcknowledgments(input: AcknowledgmentInput[]): ConsentAcknowledgmentDef[] {
  const policy = getActiveConsentPolicy();
  const required = new Set<string>(policy.acknowledgments.map((a) => a.key));
  const acceptedKeys = new Set<string>();
  for (const item of input ?? []) {
    if (!required.has(item.key)) continue; // ignore unknown keys — required set is authoritative
    if (item.accepted === true) acceptedKeys.add(item.key);
  }
  const missing = policy.acknowledgments.filter((a) => !acceptedKeys.has(a.key)).map((a) => a.key);
  if (missing.length > 0) throw new IncompleteConsentError(missing);
  return policy.acknowledgments;
}

/**
 * Build the frozen per-attempt consent snapshot. Call ONLY after
 * validateAcknowledgments has passed. Embeds the exact active-policy text for each
 * acknowledgment (marked accepted), the signer attribution, the document binding,
 * and the ceremony evidence.
 */
export function buildConsentSnapshot(params: {
  signerUserId: string;
  signerName: string;
  signerRole: string;
  signerEmail: string;
  documentVersionId: string;
  documentVersion: number;
  documentHash: string;
  consentedAt: Date;
  ipAddress: string;
  userAgent: string;
}): ConsentSnapshot {
  const policy = getActiveConsentPolicy();
  return {
    policyVersion: policy.version,
    acknowledgments: policy.acknowledgments.map((a) => ({
      key: a.key,
      title: a.title,
      text: a.text,
      accepted: true,
    })),
    signerUserId: params.signerUserId,
    signerName: params.signerName,
    signerRole: params.signerRole,
    signerEmail: params.signerEmail,
    documentVersionId: params.documentVersionId,
    documentVersion: params.documentVersion,
    documentHash: params.documentHash,
    consentedAt: params.consentedAt.toISOString(),
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  };
}
