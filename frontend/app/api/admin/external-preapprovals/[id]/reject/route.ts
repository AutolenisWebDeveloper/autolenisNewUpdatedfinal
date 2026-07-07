// POST /api/admin/external-preapprovals/[id]/reject
// Rejects an external pre-approval submission.
// Body: { reason: string }
// Updates ExternalPreApproval.status = "REJECTED"
// Sends rejection email to buyer
// Writes AuditLog: EXTERNAL_PREQUAL_REJECTED
// Requires reason (min 10 chars)

import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

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

  // Notify the buyer in-app with the reason. This is NOT an FCRA § 615
  // consumer-report adverse action — AutoLenis is declining to accept a
  // self-reported external lender letter, not denying credit on a MicroBilt
  // report. The previous code sent the MicroBilt adverse-action template,
  // which told the buyer (falsely) that the denial was "based on information
  // obtained from MicroBilt Corporation", and — lacking a per-submission
  // idempotency key — silently suppressed any second rejection for the buyer.
  await prisma.notification.create({
    data: {
      buyerId: submission.buyerId,
      type: "REQUEST_STATUS_UPDATE",
      title: "External pre-approval not accepted",
      body: `We were unable to accept your ${submission.lenderName ?? "external"} pre-approval. Reason: ${reason}`,
      actionUrl: "/buyer/prequal/manual-preapproval/status",
    },
  }).catch((err) => logger.error("[external-preapprovals/reject] notification failed:", err));

  return adminSuccess({ rejected: true });
}
