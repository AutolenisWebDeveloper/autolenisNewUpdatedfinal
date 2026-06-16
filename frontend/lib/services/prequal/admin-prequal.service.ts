// lib/services/prequal/admin-prequal.service.ts
// Admin-initiated MicroBilt iPredict prequalification service.
//
// This wrapper enforces all the same invariants as the buyer-facing path:
//   - Admin must certify buyer authorization before any MicroBilt call is made
//   - OFAC hard gate applied after iPredict returns
//   - PreQualification upserted atomically with a PrequalConsent record
//   - AdminAuditLog written on every run
//   - ComplianceEvent + notification emails triggered where appropriate
//
// Consent model (updated):
//   EXISTING_PREQUAL_CONSENT  — buyer completed in-platform FCRA consent flow;
//                               service verifies a PrequalConsent record exists.
//   PHONE_VERBAL_AUTHORIZATION, EMAIL_AUTHORIZATION, TEXT_AUTHORIZATION,
//   SIGNED_DOCUMENT_AUTHORIZATION, IN_PERSON_AUTHORIZATION — admin records
//                               external buyer authorization and certifies it
//                               in the form; a clearly-marked admin-recorded
//                               PrequalConsent row is created.
//
// This path does NOT duplicate iPredict logic — it delegates to callIPredict()
// from microbilt.service.ts and isPrequalValid() from prequal.service.ts.

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { PreQualDecision, PreQualTier } from "@prisma/client";
import { callIPredict } from "./microbilt.service";
import { isPrequalValid } from "./prequal.service";
import {
  sendPrequalApprovedEmail,
  sendAdverseActionEmail,
  sendPrequalUnderReviewEmail,
  sendAdminPrequalAlertEmail,
} from "@/lib/services/email/resend.service";

// Expiry durations — iPredict results expire after 30 days (same as buyer path).
const IPREDICT_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConsentSource =
  | "EXISTING_PREQUAL_CONSENT"
  | "PHONE_VERBAL_AUTHORIZATION"
  | "EMAIL_AUTHORIZATION"
  | "TEXT_AUTHORIZATION"
  | "SIGNED_DOCUMENT_AUTHORIZATION"
  | "IN_PERSON_AUTHORIZATION";

/** Maps each ConsentSource to the userAgent string stored in PrequalConsent.
 *  These strings are used to clearly label admin-recorded rows vs. buyer rows. */
const CONSENT_SOURCE_USER_AGENT: Record<ConsentSource, string> = {
  EXISTING_PREQUAL_CONSENT:           "admin_ipredict_run:EXISTING_PREQUAL_CONSENT",
  PHONE_VERBAL_AUTHORIZATION:          "admin_recorded_phone_authorization",
  EMAIL_AUTHORIZATION:                 "admin_recorded_email_authorization",
  TEXT_AUTHORIZATION:                  "admin_recorded_text_authorization",
  SIGNED_DOCUMENT_AUTHORIZATION:       "admin_recorded_signed_document_authorization",
  IN_PERSON_AUTHORIZATION:             "admin_recorded_in_person_authorization",
};

/** Fields required by MicroBilt iPredict (PII). Employment fields are
 *  AutoLenis-internal only and are never forwarded to MicroBilt. */
export interface AdminIPredictInput {
  // Required — sent to MicroBilt
  firstName: string;
  lastName: string;
  /** MM/DD/YYYY — always admin-entered; Buyer profile has no DOB field. */
  dateOfBirth: string;
  address: string;
  city: string;
  state: string;
  zip: string;

  // Optional internal fields — stored on PreQualification, never sent to MicroBilt
  employmentStatus?: string;
  employerName?: string;
  /** Monthly income in cents — derived from admin-entered income amount. */
  monthlyIncomeCents?: number;
  lengthOfEmployment?: string;
  /** Housing + debt obligations (back-end DTI inputs) — internal only. */
  housingStatus?: string;
  monthlyHousingPaymentCents?: number;
  monthlyOtherDebtCents?: number;
}

export interface AdminIPredictRunArgs {
  buyerId: string;
  adminId: string;
  adminEmail: string;
  input: AdminIPredictInput;
  /** Free-text reason note — required; stored in AdminAuditLog. */
  reason: string;
  /** Which authorization source the admin is asserting. */
  consentSource: ConsentSource;
  /** ISO-8601 timestamp when the buyer gave authorization. */
  consentTimestamp: string;
  /** Admin-entered summary of how/when the buyer authorized.
   *  Stored as consentText in the PrequalConsent row (external sources only). */
  authorizationSummary: string;
  /** Optional reference — email subject, call note, doc name, etc. */
  authorizationReference?: string;
  /** Must be true — admin certification that buyer authorized this run. */
  adminCertification: true;
}

/** Shape returned from getAdminPrequalReadiness — used by the GET endpoint. */
export interface AdminPrequalReadiness {
  /**
   * Admin can always attempt an iPredict run by recording external buyer
   * authorization. `canRun` is always true; the UI uses it to show the button.
   */
  canRun: boolean;
  /** Whether a PrequalConsent record already exists for this buyer. */
  hasConsent: boolean;
  consentAcceptedAt: string | null;
  /**
   * Profile fields missing from the buyer record that are required by iPredict.
   * dateOfBirth is always required but is never in the profile — the UI must
   * always show that field regardless of this list.
   */
  profileMissingFields: string[];
  existingPrequal: {
    id: string;
    decision: string;
    tier: string | null;
    maxOtdAmountCents: number;
    expiresAt: string;
    isValid: boolean;
    checkOfacAlert: boolean;
    isExternal: boolean;
    /** Inferred source label: "admin_manual" | "admin_ipredict" | "ipredict" */
    source: string;
    createdAt: string;
    updatedAt: string;
    // iPredict_6.yaml risk detail (admin-only — never exposed to buyer).
    creditScore: number | null;
    idvScore: number | null;
    mlaCovered: boolean;
    fraudWarning: string | null;
    adverseReasonCodes: string[];
    deceasedFlag: boolean;
    bankruptcyFlag: boolean;
  } | null;
  buyer: {
    firstName: string;
    lastName: string;
    email: string;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    employmentStatus: string | null;
    incomeRange: string | null;
  };
}

export type AdminIPredictRunStatus =
  | "APPROVED"
  | "DECLINED"
  | "MANUAL_REVIEW"
  | "OFAC_REVIEW"
  | "MOCKED"
  | "PROVIDER_ERROR"
  | "CONSENT_MISSING";

export interface AdminIPredictRunResult {
  status: AdminIPredictRunStatus;
  prequal: {
    id: string;
    decision: string;
    tier: string | null;
    maxOtdAmountCents: number;
    expiresAt: string;
    checkOfacAlert: boolean;
  } | null;
  mocked: boolean;
  providerReason: string | undefined;
  approvalEmailSent: boolean;
  adverseActionSent: boolean;
  auditLogId: string;
  ranAt: string;
  adminId: string;
  adminEmail: string;
  /** Consent fields echoed back for the results view. */
  consentSource: string;
  consentTimestamp: string;
  authorizationSummary: string;
  authorizationReference: string | undefined;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Infer the display source from the rawResponse field.
 * Admin manual overrides store plain JSON; all iPredict paths store
 * AES-256-GCM encrypted base64 content.
 */
function inferPrequalSource(rawResponse: string | null): string {
  if (!rawResponse) return "unknown";
  try {
    const parsed = JSON.parse(rawResponse) as { source?: string };
    if (parsed.source === "admin_manual") return "admin_manual";
    if (parsed.source === "admin_ipredict") return "admin_ipredict";
  } catch {
    // Not plain JSON → encrypted iPredict response
  }
  return "ipredict";
}

const PROVIDER_ERROR_REASONS = new Set([
  "TIMEOUT",
  "NETWORK_ERROR",
  "OAUTH_FAILED",
  "IPREDICT_ERROR",
  "CONFIG_ERROR",
  "CONFIG_MISMATCH",
  "URL_NOT_CONFIGURED",
]);

function mapFinalDecisionToRunStatus(
  decision: PreQualDecision,
  mocked: boolean,
  providerReason: string | undefined
): AdminIPredictRunStatus {
  if (
    (providerReason !== undefined && PROVIDER_ERROR_REASONS.has(providerReason)) ||
    providerReason?.startsWith("HTTP_")
  ) {
    return "PROVIDER_ERROR";
  }
  if (mocked) return "MOCKED";
  switch (decision) {
    case PreQualDecision.APPROVED:       return "APPROVED";
    case PreQualDecision.DECLINED:       return "DECLINED";
    case PreQualDecision.OFAC_REVIEW:
    case PreQualDecision.OFAC_ESCALATED: return "OFAC_REVIEW";
    default:                             return "MANUAL_REVIEW";
  }
}

// ─── Service functions ────────────────────────────────────────────────────────

/**
 * Returns current prequal status, consent status, and buyer data completeness.
 * Used by GET /api/admin/buyers/[buyerId]/prequal to power the admin panel.
 *
 * Note: canRun is always true — admin can use external buyer authorization.
 * hasConsent indicates whether an existing in-platform PrequalConsent exists.
 */
export async function getAdminPrequalReadiness(
  buyerId: string
): Promise<AdminPrequalReadiness> {
  const buyer = await prisma.buyer.findUnique({
    where: { id: buyerId },
    include: { user: true, preQualification: true },
  });
  if (!buyer) throw new Error("Buyer not found");

  // Check for any prior FCRA consent from this buyer (informational only).
  const consentRecord = await prisma.prequalConsent.findFirst({
    where: { buyerId },
    orderBy: { acceptedAt: "desc" },
  });

  // Determine which profile fields are missing for iPredict
  const profileMissingFields: string[] = [];
  if (!buyer.address) profileMissingFields.push("address");
  if (!buyer.city)    profileMissingFields.push("city");
  if (!buyer.state)   profileMissingFields.push("state");
  if (!buyer.zip)     profileMissingFields.push("zip");
  // dateOfBirth is never in the buyer profile — the UI always requires it.

  const existing = buyer.preQualification;

  return {
    canRun: true, // Admin can always run with valid recorded authorization
    hasConsent: consentRecord !== null,
    consentAcceptedAt: consentRecord?.acceptedAt.toISOString() ?? null,
    profileMissingFields,
    existingPrequal: existing
      ? {
          id: existing.id,
          decision: existing.decision,
          tier: existing.tier,
          maxOtdAmountCents: existing.maxOtdAmountCents,
          expiresAt: existing.expiresAt.toISOString(),
          isValid: isPrequalValid(existing),
          checkOfacAlert: existing.checkOfacAlert,
          isExternal: existing.isExternal,
          source: inferPrequalSource(existing.rawResponse ?? null),
          createdAt: existing.createdAt.toISOString(),
          updatedAt: existing.updatedAt.toISOString(),
          creditScore: existing.creditScore,
          idvScore: existing.idvScore,
          mlaCovered: existing.mlaCovered,
          fraudWarning: existing.fraudWarning,
          adverseReasonCodes: existing.adverseReasonCodes,
          deceasedFlag: existing.deceasedFlag,
          bankruptcyFlag: existing.bankruptcyFlag,
        }
      : null,
    buyer: {
      firstName: buyer.firstName,
      lastName: buyer.lastName,
      email: buyer.user.email,
      address: buyer.address ?? null,
      city: buyer.city ?? null,
      state: buyer.state ?? null,
      zip: buyer.zip ?? null,
      employmentStatus: buyer.employmentStatus ?? null,
      incomeRange: buyer.incomeRange ?? null,
    },
  };
}

/**
 * Run a real MicroBilt iPredict prequalification on behalf of a buyer.
 *
 * Consent model:
 *   EXISTING_PREQUAL_CONSENT  — verified against existing PrequalConsent row;
 *                               blocks with CONSENT_MISSING if none found.
 *   External sources           — admin must certify with adminCertification=true,
 *                               consentTimestamp, and authorizationSummary;
 *                               a clearly-marked admin-recorded PrequalConsent
 *                               row is created inside the transaction.
 *
 * Other invariants:
 *   - Same callIPredict() path used by the buyer-facing service.
 *   - OFAC hard gate — same as buyer path.
 *   - Atomic upsert of PreQualification + PrequalConsent.
 *   - AdminAuditLog on every run (success or blocked).
 *   - ComplianceEvent + notification emails for APPROVED / DECLINED.
 */
export async function runAdminIPredictPrequalForBuyer(
  args: AdminIPredictRunArgs
): Promise<AdminIPredictRunResult> {
  const {
    buyerId, adminId, adminEmail, input, reason,
    consentSource, consentTimestamp, authorizationSummary, authorizationReference,
  } = args;
  const ranAt = new Date();

  const buyer = await prisma.buyer.findUnique({
    where: { id: buyerId },
    include: { user: true, preQualification: true },
  });
  if (!buyer) throw new Error("Buyer not found");

  // ── Consent gate ──────────────────────────────────────────────────────────
  // For EXISTING_PREQUAL_CONSENT: verify a PrequalConsent record exists.
  // For external sources:        admin certification + fields validated by API;
  //                              no DB check required here.
  let existingConsentId: string | undefined;

  if (consentSource === "EXISTING_PREQUAL_CONSENT") {
    const consentRecord = await prisma.prequalConsent.findFirst({
      where: { buyerId },
      orderBy: { acceptedAt: "desc" },
    });
    if (!consentRecord) {
      // Log the blocked attempt for audit purposes.
      const blockedLog = await prisma.adminAuditLog.create({
        data: {
          adminId,
          adminEmail,
          action: "PREQUAL_IPREDICT_RUN_BLOCKED_NO_CONSENT",
          entityType: "PreQualification",
          entityId: buyerId,
          reason,
          metadata: {
            buyerId,
            consentSource,
            blockedReason: "NO_CONSENT_RECORD",
            consentTimestamp,
          },
        },
      });
      return {
        status: "CONSENT_MISSING",
        prequal: null,
        mocked: false,
        providerReason: undefined,
        approvalEmailSent: false,
        adverseActionSent: false,
        auditLogId: blockedLog.id,
        ranAt: ranAt.toISOString(),
        adminId,
        adminEmail,
        consentSource,
        consentTimestamp,
        authorizationSummary,
        authorizationReference,
      };
    }
    existingConsentId = consentRecord.id;
  }

  // ── Call MicroBilt iPredict ────────────────────────────────────────────────
  const result = await callIPredict({
    buyer: {
      firstName: input.firstName,
      lastName: input.lastName,
      dateOfBirth: input.dateOfBirth,
      address: input.address,
      city: input.city,
      state: input.state,
      zip: input.zip,
    },
    monthlyIncomeCents:  input.monthlyIncomeCents ?? null,
    employmentStatus:    input.employmentStatus ?? null,
    lengthOfEmployment:  input.lengthOfEmployment ?? null,
    statedBudgetCents:   buyer.preQualification?.maxOtdAmountCents ?? null,
    monthlyHousingPaymentCents: input.monthlyHousingPaymentCents ?? null,
    monthlyOtherDebtCents:      input.monthlyOtherDebtCents ?? null,
    fallbackMaxOtdAmountCents: buyer.preQualification?.maxOtdAmountCents ?? 3_500_000,
  });

  // ── Decision gate pipeline — identical order to the buyer path ─────────────
  // Gate 1: OFAC (hard gate). Gates 2–4: iPredict_6.yaml risk signals →
  // MANUAL_REVIEW. Gate 5: existing income + credit decision (preserved).
  let finalDecision: PreQualDecision = result.decision;
  if (result.ofacFlagged === true) {
    finalDecision = PreQualDecision.OFAC_REVIEW;
    await prisma.notification
      .create({
        data: {
          title: "OFAC Alert — Admin-Initiated iPredict Flagged",
          body: `Admin ${adminEmail} ran iPredict for buyer ${buyerId}. OFAC flag returned. Do NOT approve without compliance sign-off.`,
          type: "SYSTEM_ALERT",
        },
      })
      .catch(() => {});
  }
  // Gate 2: Deceased indicator → manual review.
  else if (result.deceasedFlag) {
    finalDecision = PreQualDecision.MANUAL_REVIEW;
    logger.warn(`[admin-prequal] Deceased indicator for buyer ${buyerId} — manual review`);
  }
  // Gate 3: MLA covered borrower → manual review.
  else if (result.mlaCovered === true) {
    finalDecision = PreQualDecision.MANUAL_REVIEW;
    await prisma.notification
      .create({
        data: {
          title: "MLA Covered Borrower — Manual Review Required",
          body: `Buyer ${buyerId} is covered under the Military Lending Act. Apply MLA-compliant disclosures.`,
          type: "SYSTEM_ALERT",
        },
      })
      .catch(() => {});
  }
  // Gate 4: Fraud warning → manual review.
  else if (result.fraudWarning && result.fraudWarning !== "N" && result.fraudWarning !== "") {
    finalDecision = PreQualDecision.MANUAL_REVIEW;
    logger.warn(`[admin-prequal] Fraud warning ${result.fraudWarning} for buyer ${buyerId}`);
  }

  // ── maxOtdAmountCents — two-gate minimum already applied by callIPredict ────
  const maxOtdAmountCents =
    finalDecision === PreQualDecision.APPROVED ? result.maxOtdAmountCents : 0;

  const tier: PreQualTier | null = result.tier;

  // ── Persist PreQualification + PrequalConsent atomically ──────────────────
  const prequal = await prisma.$transaction(async (tx) => {
    const upserted = await tx.preQualification.upsert({
      where: { buyerId },
      create: {
        buyerId,
        decision: finalDecision,
        tier,
        maxOtdAmountCents,
        checkOfacAlert: result.ofacFlagged === true,
        expiresAt: result.expiresAt,
        rawResponse: result.rawResponse,
        employmentStatus: input.employmentStatus ?? null,
        employerName: input.employerName ?? null,
        monthlyIncomeCents: input.monthlyIncomeCents ?? null,
        lengthOfEmployment: input.lengthOfEmployment ?? null,
        housingStatus: input.housingStatus ?? null,
        monthlyHousingPaymentCents: input.monthlyHousingPaymentCents ?? null,
        monthlyOtherDebtCents: input.monthlyOtherDebtCents ?? null,
        frontEndDtiBps: result.frontEndDtiBps ?? null,
        backEndDtiBps: result.backEndDtiBps ?? null,
        benchmarkAprBps: result.benchmarkAprBps ?? null,
        effectiveIncomeCents: result.effectiveIncomeCents ?? null,
        // iPredict_6.yaml spec fields
        creditScore: result.creditScore ?? null,
        idvScore: result.idvScore ?? null,
        mlaCovered: result.mlaCovered ?? false,
        fraudWarning: result.fraudWarning ?? null,
        adverseReasonCodes: result.adverseReasonCodes ?? [],
        deceasedFlag: result.deceasedFlag ?? false,
        bankruptcyFlag: result.bankruptcyFlag ?? false,
      },
      update: {
        decision: finalDecision,
        tier,
        maxOtdAmountCents,
        checkOfacAlert: result.ofacFlagged === true,
        expiresAt: result.expiresAt,
        rawResponse: result.rawResponse,
        employmentStatus: input.employmentStatus ?? null,
        employerName: input.employerName ?? null,
        monthlyIncomeCents: input.monthlyIncomeCents ?? null,
        lengthOfEmployment: input.lengthOfEmployment ?? null,
        housingStatus: input.housingStatus ?? null,
        monthlyHousingPaymentCents: input.monthlyHousingPaymentCents ?? null,
        monthlyOtherDebtCents: input.monthlyOtherDebtCents ?? null,
        frontEndDtiBps: result.frontEndDtiBps ?? null,
        backEndDtiBps: result.backEndDtiBps ?? null,
        benchmarkAprBps: result.benchmarkAprBps ?? null,
        effectiveIncomeCents: result.effectiveIncomeCents ?? null,
        // iPredict_6.yaml spec fields
        creditScore: result.creditScore ?? null,
        idvScore: result.idvScore ?? null,
        mlaCovered: result.mlaCovered ?? false,
        fraudWarning: result.fraudWarning ?? null,
        adverseReasonCodes: result.adverseReasonCodes ?? [],
        deceasedFlag: result.deceasedFlag ?? false,
        bankruptcyFlag: result.bankruptcyFlag ?? false,
      },
    });

    if (consentSource === "EXISTING_PREQUAL_CONSENT") {
      // Existing in-platform consent — do NOT create a duplicate row.
      // The existing record is referenced via existingConsentId in the audit log.
    } else {
      // External authorization — create a clearly-marked admin-recorded row.
      // consentText stores the admin's authorization summary.
      // userAgent stores the type of external authorization (e.g. admin_recorded_phone_authorization).
      await tx.prequalConsent.create({
        data: {
          prequalId: upserted.id,
          buyerId,
          consentText: authorizationSummary,
          ipAddress: `admin:${adminId}`,
          userAgent: CONSENT_SOURCE_USER_AGENT[consentSource],
        },
      });
    }

    return upserted;
  });

  // ── Admin audit log ────────────────────────────────────────────────────────
  // PII (name/address) is deliberately omitted from audit metadata.
  // authorizationSummary is included as it is the consent record, not PII.
  const auditEntry = await prisma.adminAuditLog.create({
    data: {
      adminId,
      adminEmail,
      action: "PREQUAL_IPREDICT_RUN",
      entityType: "PreQualification",
      entityId: prequal.id,
      reason,
      metadata: {
        decision: finalDecision,
        maxOtdAmountCents,
        tier: tier ?? null,
        buyerId,
        consentSource,
        consentTimestamp,
        authorizationSummary,
        authorizationReference: authorizationReference ?? null,
        existingConsentId: existingConsentId ?? null,
        adminCertificationCompleted: true,
        mocked: result.mocked,
        ofacFlagged: result.ofacFlagged,
        providerReason: result.reason ?? null,
        ipredictRunAt: ranAt.toISOString(),
      },
    },
  });

  // ── Notification emails + ComplianceEvents ────────────────────────────────
  let approvalEmailSent = false;
  let adverseActionSent = false;

  if (finalDecision === PreQualDecision.APPROVED) {
    const decisionDate = new Date();
    const expiryDate = new Date(Date.now() + IPREDICT_EXPIRY_MS);

    try {
      await sendPrequalApprovedEmail({
        to: buyer.user.email,
        firstName: input.firstName,
        maxOtdAmountCents,
        tier,
        decisionDate,
        expiryDate,
      });
      approvalEmailSent = true;
    } catch (err) {
      logger.error("[admin-prequal] Failed to send approval email:", err);
    }

    try {
      await prisma.complianceEvent.create({
        data: {
          eventType: "PREQUAL_APPROVAL_NOTICE_SENT",
          buyerId,
          prequalApplicationId: prequal.id,
          metadata: {
            sentTo: buyer.user.email,
            sentAt: decisionDate.toISOString(),
            maxOtdAmountCents,
            tier: tier ?? null,
            expiresAt: expiryDate.toISOString(),
            source: "admin_ipredict",
            adminId,
            consentSource,
          },
        },
      });
    } catch (err) {
      logger.error("[admin-prequal] Failed to log approval compliance event:", err);
    }
  }

  // FCRA § 615: adverse action notice required when a consumer report caused DECLINED.
  // ComplianceEvent reflects true send status: SUPPRESSED_DUPLICATE when the
  // idempotency layer collapses a duplicate; nothing logged on a thrown error.
  if (finalDecision === PreQualDecision.DECLINED) {
    const decisionDateStr = new Date().toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });

    // See prequal.service.ts for the SENT/DUPLICATE/FAILED/DEV_SKIPPED contract —
    // we map on the discriminated outcome, not on the boolean `sent`.
    let outcome: "SENT" | "DUPLICATE" | "FAILED" | "DEV_SKIPPED" | "THREW" = "THREW";
    let adverseActionErrorMessage: string | null = null;
    try {
      const sendResult = await sendAdverseActionEmail({
        to: buyer.user.email,
        firstName: input.firstName,
        decisionDate: decisionDateStr,
        prequalApplicationId: prequal.id,
        decisionTimestamp: prequal.updatedAt.toISOString(),
        adverseReasonCodes: prequal.adverseReasonCodes,
      });
      outcome = sendResult.outcome;
      adverseActionSent = sendResult.sent;
    } catch (err) {
      logger.error("[admin-prequal] Failed to send adverse action email:", err);
      adverseActionErrorMessage = err instanceof Error ? err.message : String(err);
    }

    try {
      const eventType =
        outcome === "SENT"
          ? "ADVERSE_ACTION_NOTICE_SENT"
          : outcome === "DUPLICATE"
            ? "ADVERSE_ACTION_NOTICE_SUPPRESSED_DUPLICATE"
            : "ADVERSE_ACTION_NOTICE_SEND_FAILED";
      await prisma.complianceEvent.create({
        data: {
          eventType,
          buyerId,
          prequalApplicationId: prequal.id,
          metadata: {
            sentTo: buyer.user.email,
            sentAt: new Date().toISOString(),
            decisionTimestamp: prequal.updatedAt.toISOString(),
            sendOutcome: outcome,
            source: "admin_ipredict",
            adminId,
            consentSource,
            ...(adverseActionErrorMessage
              ? { errorMessage: adverseActionErrorMessage }
              : {}),
          },
        },
      });
    } catch (err) {
      logger.error("[admin-prequal] Failed to log adverse action compliance event:", err);
    }
  }

  const runStatus = mapFinalDecisionToRunStatus(
    finalDecision,
    result.mocked,
    result.reason
  );

  // OFAC-silent buyer email + ops alert when the run resolved to review state.
  const needsReview =
    finalDecision === PreQualDecision.MANUAL_REVIEW ||
    finalDecision === PreQualDecision.OFAC_REVIEW ||
    finalDecision === PreQualDecision.OFAC_ESCALATED;

  if (needsReview) {
    try {
      await sendPrequalUnderReviewEmail({
        to: buyer.user.email,
        firstName: input.firstName,
        prequalApplicationId: prequal.id,
        decisionTimestamp: prequal.updatedAt.toISOString(),
      });
    } catch (err) {
      logger.error("[admin-prequal] Failed to send under-review email:", err);
    }
    try {
      await prisma.complianceEvent.create({
        data: {
          eventType: "PREQUAL_UNDER_REVIEW_NOTICE_SENT",
          buyerId,
          prequalApplicationId: prequal.id,
          metadata: {
            sentTo: buyer.user.email,
            sentAt: new Date().toISOString(),
            decision: finalDecision,
            source: "admin_ipredict",
            adminId,
          },
        },
      });
    } catch (err) {
      logger.error("[admin-prequal] Failed to log under-review compliance event:", err);
    }
  }

  if (needsReview || runStatus === "PROVIDER_ERROR") {
    try {
      await sendAdminPrequalAlertEmail({
        kind: runStatus === "PROVIDER_ERROR" ? "PROVIDER_ERROR" : "REVIEW",
        buyerId,
        buyerEmail: buyer.user.email,
        decision: finalDecision,
        providerReason: result.reason,
        prequalApplicationId: prequal.id,
      });
    } catch (err) {
      logger.error("[admin-prequal] Failed to send admin alert email:", err);
    }
  }

  return {
    status: runStatus,
    prequal: {
      id: prequal.id,
      decision: prequal.decision,
      tier: prequal.tier,
      maxOtdAmountCents: prequal.maxOtdAmountCents,
      expiresAt: prequal.expiresAt.toISOString(),
      checkOfacAlert: prequal.checkOfacAlert,
    },
    mocked: result.mocked,
    providerReason: result.reason,
    approvalEmailSent,
    adverseActionSent,
    auditLogId: auditEntry.id,
    ranAt: ranAt.toISOString(),
    adminId,
    adminEmail,
    consentSource,
    consentTimestamp,
    authorizationSummary,
    authorizationReference,
  };
}

