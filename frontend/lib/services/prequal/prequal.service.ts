// lib/services/prequal/prequal.service.ts
// Buyer prequalification orchestrator.
// - OFAC gate is hard: ofacFlagged === true → MANUAL_REVIEW + admin queue,
//   internal status OFAC_REVIEW, no buyer-visible explanation.
// - maxOtdAmountCents is set ONCE on APPROVED via fallback chain
//   (recommended → max → buyer's stated budget) and is immutable thereafter.
// - Stores employment fields (AutoLenis-internal only) and the EXACT FCRA
//   consent text on PrequalConsent for legal audit.

import { prisma } from "@/lib/prisma";
import { PreQualDecision, PreQualTier } from "@prisma/client";
import {
  callIPredict,
  FCRA_CONSENT_TEXT,
  type MicroBiltBuyerPII,
} from "./microbilt.service";
import {
  sendPrequalApprovedEmail,
  sendAdverseActionEmail,
  sendPrequalUnderReviewEmail,
  sendAdminPrequalAlertEmail,
} from "@/lib/services/email/resend.service";

const PROVIDER_ERROR_REASONS = new Set([
  "TIMEOUT",
  "NETWORK_ERROR",
  "OAUTH_FAILED",
  "IPREDICT_ERROR",
  "CONFIG_ERROR",
]);

function isProviderErrorReason(reason: string | undefined): boolean {
  if (!reason) return false;
  return PROVIDER_ERROR_REASONS.has(reason) || reason.startsWith("HTTP_");
}

// Single source of truth for prequal approval gating across the platform.
// A prequal is "valid" only when the buyer is currently approved AND that
// approval has not expired. Any other decision state (DECLINED / PENDING /
// MANUAL_REVIEW / OFAC_REVIEW / OFAC_ESCALATED) returns false so the buyer
// remains gated to the prequal step and can re-apply if applicable.
export function isPrequalValid(
  prequal: { decision: string; expiresAt: Date } | null,
): boolean {
  if (!prequal) return false;
  return prequal.decision === "APPROVED" && prequal.expiresAt > new Date();
}

// Buyer-safe summary — never expose raw iPredict scores or OFAC flag.
export function toBuyerSafePrequal(prequal: {
  decision: string;
  tier: string | null;
  maxOtdAmountCents: number;
  expiresAt: Date;
  checkOfacAlert: boolean;
}) {
  return {
    approved: prequal.decision === "APPROVED",
    // OFAC paths surface as "pending manual review" — buyer never learns the cause.
    pending:
      prequal.decision === "MANUAL_REVIEW" ||
      prequal.decision === "OFAC_ESCALATED" ||
      prequal.decision === "OFAC_REVIEW",
    declined: prequal.decision === "DECLINED",
    tier: prequal.tier,
    // Immutable — no client component may modify or exceed this value.
    maxOtdAmountCents: prequal.maxOtdAmountCents,
    expiresAt: prequal.expiresAt,
  };
}

export interface PrequalSubmission {
  // Required (Section 1)
  firstName: string;
  lastName: string;
  dateOfBirth: string; // MM/DD/YYYY
  address: string;
  city: string;
  state: string;
  zip: string;
  fcraConsent: boolean;

  // Optional (Section 2) — AutoLenis-internal only, never sent to MicroBilt.
  employmentStatus?: string;
  employerName?: string;
  monthlyIncomeCents?: number;
  lengthOfEmployment?: string;

  // Audit
  ipAddress?: string;
  userAgent?: string;
}

interface BuyerForPrequal {
  id: string;
  /** Buyer's stated budget in cents — used as fallback when iPredict returns no amount. */
  maxOtdAmountCents?: number | null;
  user: { email: string };
}

export async function initiatePrsequal(buyer: BuyerForPrequal, input: PrequalSubmission) {
  if (!input.fcraConsent) throw new Error("FCRA consent required");

  // Reuse only a still-valid APPROVED prequal — never re-pull MicroBilt for an
  // active approval. A DECLINED / PENDING / MANUAL_REVIEW / OFAC record (even
  // before expiresAt) is NOT treated as valid, so the buyer is allowed to
  // re-apply through this code path and we pull a fresh report.
  const existing = await prisma.preQualification.findUnique({
    where: { buyerId: buyer.id },
  });
  if (existing && isPrequalValid(existing)) {
    return { prequal: existing, mocked: false };
  }

  const pii: MicroBiltBuyerPII = {
    firstName: input.firstName,
    lastName: input.lastName,
    dateOfBirth: input.dateOfBirth,
    address: input.address,
    city: input.city,
    state: input.state,
    zip: input.zip,
  };

  const result = await callIPredict({
    buyer: pii,
    monthlyIncomeCents:  input.monthlyIncomeCents ?? null,
    employmentStatus:    input.employmentStatus ?? null,
    lengthOfEmployment:  input.lengthOfEmployment ?? null,
    statedBudgetCents:   buyer.maxOtdAmountCents ?? null,
  });

  // ── OFAC gate ──────────────────────────────────────────────────────────────
  // If ofacFlagged === true, NEVER approve, regardless of decision code.
  // Internal status OFAC_REVIEW; admin queue item created; buyer sees pending.
  let finalDecision: PreQualDecision = result.decision;
  if (result.ofacFlagged) {
    finalDecision = PreQualDecision.OFAC_REVIEW;
    await prisma.notification
      .create({
        data: {
          title: "OFAC Alert — Manual Review Required",
          body: `Buyer prequalification flagged for OFAC review. Buyer ID: ${buyer.id}. Do NOT auto-approve.`,
          type: "SYSTEM_ALERT",
        },
      })
      .catch(() => {});
  }

  // ── maxOtdAmountCents assignment ───────────────────────────────────────────
  // Only set on APPROVED. callIPredict already applies the two-gate minimum
  // (income gate vs credit gate). Field is immutable once written — never allow
  // client to overwrite it.
  const maxOtdAmountCents =
    finalDecision === PreQualDecision.APPROVED ? result.maxOtdAmountCents : 0;

  const tier: PreQualTier | null = result.tier;

  // Persist application + consent atomically so we never have a prequal record
  // without its FCRA audit trail (or vice versa).
  const prequal = await prisma.$transaction(async (tx) => {
    const upserted = await tx.preQualification.upsert({
      where: { buyerId: buyer.id },
      create: {
        buyerId: buyer.id,
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
      },
      update: {
        decision: finalDecision,
        tier,
        // Re-pulls only ever overwrite the existing maxOtdAmountCents when a
        // new decision arrives; the buyer-facing API never accepts this value.
        maxOtdAmountCents,
        checkOfacAlert: result.ofacFlagged === true,
        expiresAt: result.expiresAt,
        rawResponse: result.rawResponse,
        employmentStatus: input.employmentStatus ?? null,
        employerName: input.employerName ?? null,
        monthlyIncomeCents: input.monthlyIncomeCents ?? null,
        lengthOfEmployment: input.lengthOfEmployment ?? null,
      },
    });

    await tx.prequalConsent.create({
      data: {
        prequalId: upserted.id,
        buyerId: buyer.id,
        consentText: FCRA_CONSENT_TEXT,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        termsVersion: process.env.CURRENT_TERMS_VERSION ?? "2026-01-01",
      },
    });

    return upserted;
  });

  // Send congratulations email and log compliance event for APPROVED decisions.
  // Email failure must never block the approval — catch and log only.
  if (finalDecision === PreQualDecision.APPROVED) {
    const decisionDate = new Date();
    const expiryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    try {
      await sendPrequalApprovedEmail({
        to: buyer.user.email,
        firstName: input.firstName,
        maxOtdAmountCents: result.maxOtdAmountCents,
        tier: result.tier,
        decisionDate,
        expiryDate,
      });
    } catch (emailErr) {
      console.error("[prequal] Failed to send approval email:", emailErr);
    }

    try {
      await prisma.complianceEvent.create({
        data: {
          eventType: "PREQUAL_APPROVAL_NOTICE_SENT",
          buyerId: buyer.id,
          prequalApplicationId: prequal.id,
          metadata: {
            sentTo: buyer.user.email,
            sentAt: decisionDate.toISOString(),
            maxOtdAmountCents: result.maxOtdAmountCents,
            tier: result.tier,
            expiresAt: expiryDate.toISOString(),
          },
        },
      });
    } catch (logErr) {
      console.error("[prequal] Failed to log compliance event:", logErr);
    }
  }

  // FCRA § 615: Send adverse action notice on DECLINED decisions.
  // Required by law whenever a consumer report contributed to the denial.
  // Email failure must never block the response — catch and log only.
  //
  // The compliance event must reflect TRUE send status. A duplicate-suppressed
  // send (sent === false) is logged as ADVERSE_ACTION_NOTICE_SUPPRESSED_DUPLICATE
  // so the audit trail is honest. A thrown error logs no "SENT" event.
  if (finalDecision === PreQualDecision.DECLINED) {
    const decisionDate = new Date().toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    let adverseActionStatus: "sent" | "duplicate" | "error" = "error";
    let adverseActionErrorMessage: string | null = null;
    try {
      const result = await sendAdverseActionEmail({
        to: buyer.user.email,
        firstName: input.firstName,
        decisionDate,
        prequalApplicationId: prequal.id,
        decisionTimestamp: prequal.updatedAt.toISOString(),
      });
      adverseActionStatus = result.sent ? "sent" : "duplicate";
    } catch (emailErr) {
      console.error("[prequal] Failed to send adverse action email:", emailErr);
      adverseActionErrorMessage =
        emailErr instanceof Error ? emailErr.message : String(emailErr);
    }

    try {
      const eventType =
        adverseActionStatus === "sent"
          ? "ADVERSE_ACTION_NOTICE_SENT"
          : adverseActionStatus === "duplicate"
            ? "ADVERSE_ACTION_NOTICE_SUPPRESSED_DUPLICATE"
            : "ADVERSE_ACTION_NOTICE_SEND_FAILED";
      await prisma.complianceEvent.create({
        data: {
          eventType,
          buyerId: buyer.id,
          prequalApplicationId: prequal.id,
          metadata: {
            sentTo: buyer.user.email,
            sentAt: new Date().toISOString(),
            decisionTimestamp: prequal.updatedAt.toISOString(),
            ...(adverseActionErrorMessage
              ? { errorMessage: adverseActionErrorMessage }
              : {}),
          },
        },
      });
    } catch (logErr) {
      console.error("[prequal] Failed to log adverse action compliance event:", logErr);
    }
  }

  // OFAC-silent buyer notice + ops alert when the decision needs manual
  // attention (MANUAL_REVIEW / OFAC_REVIEW / OFAC_ESCALATED).
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
    } catch (emailErr) {
      console.error("[prequal] Failed to send under-review email:", emailErr);
    }
    try {
      await prisma.complianceEvent.create({
        data: {
          eventType: "PREQUAL_UNDER_REVIEW_NOTICE_SENT",
          buyerId: buyer.id,
          prequalApplicationId: prequal.id,
          metadata: {
            sentTo: buyer.user.email,
            sentAt: new Date().toISOString(),
            decision: finalDecision,
          },
        },
      });
    } catch (logErr) {
      console.error("[prequal] Failed to log under-review compliance event:", logErr);
    }
  }

  // Admin ops alert: needs-review OR upstream provider error. Failure to send
  // must never block the buyer response.
  const isProviderError = isProviderErrorReason(result.reason);
  if (needsReview || isProviderError) {
    try {
      await sendAdminPrequalAlertEmail({
        kind: isProviderError ? "PROVIDER_ERROR" : "REVIEW",
        buyerId: buyer.id,
        buyerEmail: buyer.user.email,
        decision: finalDecision,
        providerReason: result.reason,
        prequalApplicationId: prequal.id,
      });
    } catch (emailErr) {
      console.error("[prequal] Failed to send admin alert email:", emailErr);
    }
  }

  return { prequal, mocked: result.mocked };
}
