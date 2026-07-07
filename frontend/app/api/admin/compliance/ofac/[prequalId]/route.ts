// POST /api/admin/compliance/ofac/[prequalId]
// Admin OFAC review actions on a PreQualification: CLEAR | ESCALATE.
// CLEAR resets the OFAC flag and resumes the buyer (APPROVED when the record
// carries a usable amount/tier, otherwise MANUAL_REVIEW for a proper decision).
// ESCALATE routes the hit to legal (decision → OFAC_ESCALATED). Both are
// audit-logged AND recorded as ComplianceEvents (previously only the audit
// log was written, and CLEAR left checkOfacAlert=true so cleared buyers
// stayed pinned in every OFAC queue).
import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { sendPrequalApprovedEmail } from "@/lib/services/email/resend.service";

interface Props { params: Promise<{ prequalId: string }> }

export async function POST(request: NextRequest, { params }: Props) {
  const { prequalId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  if (!["SUPER_ADMIN", "OPERATIONS_ADMIN", "COMPLIANCE_ADMIN"].includes(admin.role)) {
    return adminError("FORBIDDEN", "Insufficient permissions — COMPLIANCE_ADMIN, OPERATIONS_ADMIN or SUPER_ADMIN required", 403);
  }

  const { action, reason } = await request.json().catch(() => ({})) as { action?: string; reason?: string };
  if (!reason?.trim()) return adminError("REASON_REQUIRED", "A reason is required for OFAC review actions", 400);
  if (action !== "CLEAR" && action !== "ESCALATE") {
    return adminError("UNKNOWN_ACTION", "Unknown action — expected CLEAR or ESCALATE", 400);
  }

  const prequal = await prisma.preQualification.findUnique({
    where: { id: prequalId },
    include: { buyer: { include: { user: { select: { email: true } } } } },
  });
  if (!prequal) return adminError("NOT_FOUND", "Pre-qualification not found", 404);
  if (!["OFAC_REVIEW", "OFAC_ESCALATED"].includes(prequal.decision)) {
    return adminError("INVALID_STATE", `Pre-qualification is not under OFAC review (current: ${prequal.decision})`, 400);
  }

  // CLEAR only auto-approves when the record already carries a usable
  // amount/tier; otherwise it lands in MANUAL_REVIEW so the amount decision
  // happens on the decide rail rather than approving a $0 budget.
  const clearedDecision =
    prequal.maxOtdAmountCents > 0 && prequal.tier != null ? "APPROVED" as const : "MANUAL_REVIEW" as const;
  const newDecision = action === "CLEAR" ? clearedDecision : ("OFAC_ESCALATED" as const);

  const applied = await prisma.$transaction(async (tx) => {
    // Race-safe: conditional on the state we validated.
    const res = await tx.preQualification.updateMany({
      where: { id: prequalId, decision: prequal.decision },
      data: {
        decision: newDecision,
        // The flag resets ONLY on clearance; escalation keeps it set.
        ...(action === "CLEAR" ? { checkOfacAlert: false } : {}),
      },
    });
    if (res.count === 0) return false;

    await tx.adminAuditLog.create({
      data: {
        adminId: admin.adminId,
        adminEmail: admin.email,
        action: `OFAC_${action}`,
        entityType: "PreQualification",
        entityId: prequalId,
        reason,
        metadata: { buyerId: prequal.buyerId, previousDecision: prequal.decision, newDecision },
      },
    });

    // Sanctions-screening dispositions are compliance events, not just admin ops.
    await tx.complianceEvent.create({
      data: {
        eventType: action === "CLEAR" ? "OFAC_REVIEW_CLEARED" : "OFAC_REVIEW_ESCALATED",
        buyerId: prequal.buyerId,
        prequalApplicationId: prequalId,
        metadata: {
          adminId: admin.adminId,
          adminEmail: admin.email,
          previousDecision: prequal.decision,
          newDecision,
          reason,
        },
      },
    });

    return true;
  });

  if (!applied) {
    return adminError("CONFLICT", "This record was actioned by another admin a moment ago. Refresh to see the current state.", 409);
  }

  if (action === "CLEAR" && newDecision === "APPROVED") {
    await prisma.notification.create({
      data: {
        buyerId: prequal.buyerId,
        type: "PREQUAL_APPROVED",
        title: "You're pre-qualified",
        body: "Your application review is complete and you're approved. You can continue to your auction.",
        actionUrl: "/buyer/dashboard",
      },
    }).catch((err) => logger.error("[ofac] cleared approval notification failed:", err));

    const email = prequal.buyer.user?.email;
    if (email) {
      await sendPrequalApprovedEmail({
        to: email,
        firstName: prequal.buyer.firstName ?? "there",
        maxOtdAmountCents: prequal.maxOtdAmountCents,
        tier: prequal.tier ?? null,
        decisionDate: new Date(),
        expiryDate: prequal.expiresAt,
      }).catch(err => logger.error("[ofac] cleared approval email failed:", err));
    }
  }
  // ESCALATE and CLEAR→MANUAL_REVIEW are buyer-silent (OFAC-silent handling).

  return adminSuccess(
    action === "CLEAR" ? { cleared: true, decision: newDecision } : { escalated: true },
  );
}
