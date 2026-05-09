// POST /api/admin/external-preapprovals/[id]/reject
// Rejects an external pre-approval submission.
// Body: { reason: string }
// Updates ExternalPreApproval.status = "REJECTED"
// Sends rejection email to buyer
// Writes AuditLog: EXTERNAL_PREQUAL_REJECTED
// Requires reason (min 10 chars)

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { sendAdverseActionEmail } from "@/lib/services/email/resend.service";

interface Props { params: Promise<{ id: string }> }

const schema = z.object({
  reason: z.string().min(10, "Reason must be at least 10 characters"),
});

export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const submission = await prisma.externalPreApproval.findUnique({
    where: { id },
    include: { buyer: { include: { user: true } } },
  });
  if (!submission) return adminError("NOT_FOUND", "External pre-approval not found", 404);
  if (submission.status !== "SUBMITTED") return adminError("INVALID_STATE", "Only SUBMITTED pre-approvals can be rejected", 400);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const { reason } = parsed.data;
  const now = new Date();

  await prisma.externalPreApproval.update({
    where: { id },
    data: {
      status: "REJECTED",
      reviewedAt: now,
      reviewedBy: admin.adminId,
      rejectionReason: reason,
    },
  });

  const ipAddress = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? undefined;

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "EXTERNAL_PREQUAL_REJECTED",
      entityType: "ExternalPreApproval",
      entityId: id,
      reason,
      ipAddress: ipAddress ?? null,
      metadata: { buyerId: submission.buyerId, lenderName: submission.lenderName },
    },
  });

  // Send rejection email — failure must not block the response
  try {
    const buyer = submission.buyer;
    if (buyer?.user?.email) {
      const firstName = buyer.firstName ?? buyer.user.email.split("@")[0];
      const decisionDate = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
      await sendAdverseActionEmail({
        to: buyer.user.email,
        firstName,
        decisionDate,
      });
    }
  } catch (err) {
    console.error("[external-preapprovals/reject] email failed:", err);
  }

  return adminSuccess({ rejected: true });
}
