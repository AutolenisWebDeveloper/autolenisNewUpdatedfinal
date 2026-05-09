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
} from "@/lib/services/email/resend.service";

// Auction gating uses expiresAt > now() — never .status / .decision.
export function isPrequalValid(prequal: { expiresAt: Date } | null): boolean {
  if (!prequal) return false;
  return prequal.expiresAt > new Date();
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

  // Reuse a still-valid existing prequal — never re-pull MicroBilt unnecessarily.
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
  if (finalDecision === PreQualDecision.DECLINED) {
    const decisionDate = new Date().toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    try {
      await sendAdverseActionEmail({
        to: buyer.user.email,
        firstName: input.firstName,
        decisionDate,
        prequalApplicationId: prequal.id,
      });
    } catch (emailErr) {
      console.error("[prequal] Failed to send adverse action email:", emailErr);
    }

    try {
      await prisma.complianceEvent.create({
        data: {
          eventType: "ADVERSE_ACTION_NOTICE_SENT",
          buyerId: buyer.id,
          prequalApplicationId: prequal.id,
          metadata: {
            sentTo: buyer.user.email,
            sentAt: new Date().toISOString(),
          },
        },
      });
    } catch (logErr) {
      console.error("[prequal] Failed to log adverse action compliance event:", logErr);
    }
  }

  return { prequal, mocked: result.mocked };
}
