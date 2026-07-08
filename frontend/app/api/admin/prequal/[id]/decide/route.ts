// POST /api/admin/prequal/[id]/decide
//
// Admin manual decision on a single PreQualification record.
//
// Three actions:
//   APPROVE   — accept the existing maxOtdAmountCents + tier as-is, decision=APPROVED.
//   DECLINE   — decision=DECLINED, zero out maxOtdAmountCents, clear tier.
//               Triggers FCRA § 615 adverse-action notice.
//   OVERRIDE  — APPROVED with admin-supplied amount + tier.
//
// All paths:
//   - Atomic prisma.$transaction over PreQualification + AdminAuditLog + ComplianceEvent.
//   - Adverse-action email on DECLINE.
//   - Approval email on APPROVE / OVERRIDE.
//
// This complements (does not replace) /api/admin/buyers/[buyerId]/prequal/manual-override —
// that route upserts a brand-new prequal with OFAC gating. This route operates on an
// existing prequal id and is what the new /admin/prequal/[id] page calls.

import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { z } from "zod";
import { getAdminWithRole, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { PreQualDecision, PreQualTier } from "@prisma/client";
import {
  sendPrequalApprovedEmail,
  sendAdverseActionEmail,
} from "@/lib/services/email/resend.service";

// 90-day validity, matching the manual-override path so both admin decision
// rails stamp the same expiry window (the record AND the email agree).
const APPROVAL_VALIDITY_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_OTD_MIN_CENTS = 800000;   // $8,000
const MAX_OTD_MAX_CENTS = 8500000;  // $85,000

const schema = z.object({
  action: z.enum(["APPROVE", "DECLINE", "OVERRIDE"]),
  reason: z.string().trim().min(1, "Reason is required").max(2000),
  maxOtdAmountCents: z.number().int().min(MAX_OTD_MIN_CENTS).max(MAX_OTD_MAX_CENTS).optional(),
  tier: z.nativeEnum(PreQualTier).optional(),
}).superRefine((val, ctx) => {
  if (val.action === "OVERRIDE") {
    if (val.maxOtdAmountCents == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["maxOtdAmountCents"], message: "Override requires maxOtdAmountCents" });
    }
    if (val.tier == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tier"], message: "Override requires tier" });
    }
  }
});

/** Thrown when a concurrent decide already changed the record's state. */
class DecisionConflictError extends Error {
  constructor() { super("DECISION_CONFLICT"); }
}

interface Props { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const admin = await getAdminWithRole(request, ["SUPER_ADMIN", "COMPLIANCE_ADMIN", "OPERATIONS_ADMIN"]);
  if (!admin) return adminError("FORBIDDEN", "SUPER_ADMIN, COMPLIANCE_ADMIN, or OPERATIONS_ADMIN required.", 403);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return adminError("VALIDATION_ERROR", "Invalid JSON", 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }
  const { action, reason, maxOtdAmountCents, tier } = parsed.data;

  const existing = await prisma.preQualification.findUnique({
    where: { id },
    include: { buyer: { include: { user: true } } },
  });
  if (!existing) return adminError("NOT_FOUND", "Prequalification not found", 404);

  // OFAC hard gate: records with an uncleared OFAC alert (flag or state) are
  // NOT decidable here — neither approval (sanctions risk) nor decline (an
  // adverse-action notice could tip off a flagged individual). They must go
  // through the dedicated OFAC Review queue (CLEAR or ESCALATE) first; CLEAR
  // resets the flag and returns the record to this queue as approvable.
  const inOfacState =
    existing.decision === "OFAC_REVIEW" || existing.decision === "OFAC_ESCALATED";
  if (existing.checkOfacAlert || inOfacState) {
    return adminError(
      "OFAC_REVIEW_REQUIRED",
      "This record has an uncleared OFAC alert. Resolve it in Compliance → OFAC Review before making a decision.",
      409,
    );
  }

  // Only the review states are eligible for manual decision via this route.
  const ACTIONABLE: PreQualDecision[] = ["MANUAL_REVIEW", "PENDING"];
  if (!ACTIONABLE.includes(existing.decision)) {
    return adminError(
      "CONFLICT",
      `Prequal is already ${existing.decision}. Use a fresh manual override to change it.`,
      409,
    );
  }

  let newDecision: PreQualDecision;
  let newMaxCents: number;
  let newTier: PreQualTier | null;

  if (action === "APPROVE") {
    if (existing.maxOtdAmountCents <= 0 || existing.tier == null) {
      return adminError(
        "VALIDATION_ERROR",
        "Existing prequal has no usable amount/tier — use OVERRIDE with explicit values.",
        400,
      );
    }
    newDecision = PreQualDecision.APPROVED;
    newMaxCents = existing.maxOtdAmountCents;
    newTier = existing.tier;
  } else if (action === "DECLINE") {
    newDecision = PreQualDecision.DECLINED;
    newMaxCents = 0;
    newTier = null;
  } else {
    newDecision = PreQualDecision.APPROVED;
    newMaxCents = maxOtdAmountCents!;
    newTier = tier!;
  }

  const previousState = {
    decision: existing.decision,
    tier: existing.tier,
    maxOtdAmountCents: existing.maxOtdAmountCents,
  };

  // Approvals get a fresh 90-day validity window; previously this route left
  // expiresAt untouched, so a just-approved record could read as "Expired".
  const newExpiresAt =
    newDecision === PreQualDecision.APPROVED
      ? new Date(Date.now() + APPROVAL_VALIDITY_MS)
      : existing.expiresAt;

  const updated = await prisma.$transaction(async (tx) => {
    // Race-safe: the update is conditional on the decision we validated above,
    // so two concurrent decides can't both apply (the loser matches 0 rows).
    const applied = await tx.preQualification.updateMany({
      where: { id, decision: existing.decision },
      data: {
        decision: newDecision,
        tier: newTier,
        maxOtdAmountCents: newMaxCents,
        expiresAt: newExpiresAt,
      },
    });
    if (applied.count === 0) {
      throw new DecisionConflictError();
    }
    const next = await tx.preQualification.findUniqueOrThrow({ where: { id } });

    await tx.adminAuditLog.create({
      data: {
        adminId: admin.adminId,
        adminEmail: admin.email,
        action: action === "DECLINE" ? "PREQUAL_MANUAL_DECLINE" : action === "OVERRIDE" ? "PREQUAL_MANUAL_OVERRIDE" : "PREQUAL_MANUAL_APPROVE",
        entityType: "PreQualification",
        entityId: id,
        reason,
        metadata: { action, buyerId: existing.buyerId },
        previousState,
        newState: { decision: newDecision, tier: newTier, maxOtdAmountCents: newMaxCents },
      },
    });

    await tx.complianceEvent.create({
      data: {
        eventType: action === "DECLINE" ? "PREQUAL_MANUAL_DECLINED" : "PREQUAL_MANUAL_APPROVED",
        buyerId: existing.buyerId,
        prequalApplicationId: id,
        metadata: {
          adminId: admin.adminId,
          adminEmail: admin.email,
          action,
          previousDecision: existing.decision,
          newDecision,
          maxOtdAmountCents: newMaxCents,
          tier: newTier,
        },
      },
    });

    return next;
  }).catch((err) => {
    if (err instanceof DecisionConflictError) return null;
    throw err;
  });

  if (!updated) {
    return adminError(
      "CONFLICT",
      "This record was decided by another admin a moment ago. Refresh to see the current state.",
      409,
    );
  }

  // Email side effects — outside the transaction so a transient email failure
  // never rolls back the decision.
  if (newDecision === PreQualDecision.APPROVED) {
    try {
      await sendPrequalApprovedEmail({
        to: existing.buyer.user.email,
        firstName: existing.buyer.firstName,
        maxOtdAmountCents: newMaxCents,
        tier: newTier,
        decisionDate: new Date(),
        expiryDate: newExpiresAt,
      });
    } catch (err) {
      logger.error("[admin/prequal/decide] approval email failed:", err);
    }
  } else if (newDecision === PreQualDecision.DECLINED) {
    // FCRA § 615 adverse-action notice with the record's principal-reason
    // codes, and an honest send-outcome ComplianceEvent — parity with the
    // manual-override rail (SENT / SUPPRESSED_DUPLICATE / SEND_FAILED).
    let outcome: "SENT" | "DUPLICATE" | "FAILED" | "DEV_SKIPPED" | "THREW" = "THREW";
    let sendErrorMessage: string | null = null;
    try {
      const sendResult = await sendAdverseActionEmail({
        to: existing.buyer.user.email,
        firstName: existing.buyer.firstName,
        decisionDate: new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
        prequalApplicationId: id,
        decisionTimestamp: updated.updatedAt.toISOString(),
        adverseReasonCodes: existing.adverseReasonCodes,
      });
      outcome = sendResult.outcome;
    } catch (err) {
      logger.error("[admin/prequal/decide] adverse-action email failed:", err);
      sendErrorMessage = err instanceof Error ? err.message : String(err);
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
          buyerId: existing.buyerId,
          prequalApplicationId: id,
          metadata: {
            sentTo: existing.buyer.user.email,
            sentAt: new Date().toISOString(),
            decisionTimestamp: updated.updatedAt.toISOString(),
            sendOutcome: outcome,
            source: "admin_decide",
            ...(sendErrorMessage ? { errorMessage: sendErrorMessage } : {}),
          },
        },
      });
    } catch (logErr) {
      logger.error("[admin/prequal/decide] failed to log adverse-action event:", logErr);
    }
  }

  return adminSuccess({
    prequal: {
      id: updated.id,
      decision: updated.decision,
      tier: updated.tier,
      maxOtdAmountCents: updated.maxOtdAmountCents,
    },
  });
}
