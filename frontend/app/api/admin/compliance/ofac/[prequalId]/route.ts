// POST /api/admin/compliance/ofac/[prequalId]
// Admin OFAC review actions on a PreQualification: CLEAR | ESCALATE.
// CLEAR resumes the buyer's progress (decision → APPROVED) and notifies them.
// ESCALATE routes the hit to legal (decision → OFAC_ESCALATED). Both audit-logged.
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { sendPrequalApprovedEmail } from "@/lib/services/email/resend.service";

interface Props { params: Promise<{ prequalId: string }> }

export async function POST(request: NextRequest, { params }: Props) {
  const { prequalId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  if (!["SUPER_ADMIN", "OPERATIONS_ADMIN"].includes(admin.role)) {
    return adminError("FORBIDDEN", "Insufficient permissions — OPERATIONS_ADMIN or SUPER_ADMIN required", 403);
  }

  const { action, reason } = await request.json().catch(() => ({})) as { action?: string; reason?: string };
  if (!reason?.trim()) return adminError("REASON_REQUIRED", "A reason is required for OFAC review actions", 400);

  const prequal = await prisma.preQualification.findUnique({
    where: { id: prequalId },
    include: { buyer: { include: { user: { select: { email: true } } } } },
  });
  if (!prequal) return adminError("NOT_FOUND", "Pre-qualification not found", 404);
  if (!["OFAC_REVIEW", "OFAC_ESCALATED"].includes(prequal.decision)) {
    return adminError("INVALID_STATE", `Pre-qualification is not under OFAC review (current: ${prequal.decision})`, 400);
  }

  let result: Record<string, unknown> = {};

  switch (action) {
    case "CLEAR": {
      // Clearing OFAC resumes buyer progress automatically — the prequal gate
      // unblocks once the decision is APPROVED.
      await prisma.preQualification.update({ where: { id: prequalId }, data: { decision: "APPROVED" } });

      await prisma.notification.create({
        data: {
          buyerId: prequal.buyerId,
          type: "PREQUAL_APPROVED",
          title: "You're pre-qualified",
          body: "Your application review is complete and you're approved. You can continue to your auction.",
          actionUrl: "/buyer/dashboard",
        },
      }).catch(() => {});

      const email = prequal.buyer.user?.email;
      if (email) {
        await sendPrequalApprovedEmail({
          to: email,
          firstName: prequal.buyer.firstName ?? "there",
          maxOtdAmountCents: prequal.maxOtdAmountCents,
          tier: prequal.tier ?? null,
          decisionDate: new Date(),
          expiryDate: prequal.expiresAt,
        }).catch(err => console.error("[ofac] cleared approval email failed:", err));
      }

      result = { cleared: true };
      break;
    }

    case "ESCALATE": {
      await prisma.preQualification.update({ where: { id: prequalId }, data: { decision: "OFAC_ESCALATED" } });
      // Escalation is internal to the legal team — the buyer is not notified
      // (OFAC-silent), and their progress remains frozen.
      result = { escalated: true };
      break;
    }

    default:
      return adminError("UNKNOWN_ACTION", "Unknown action — expected CLEAR or ESCALATE", 400);
  }

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: `OFAC_${action}`,
      entityType: "PreQualification",
      entityId: prequalId,
      reason,
      metadata: JSON.parse(JSON.stringify({ buyerId: prequal.buyerId, ...result })),
    },
  });

  return adminSuccess(result);
}
