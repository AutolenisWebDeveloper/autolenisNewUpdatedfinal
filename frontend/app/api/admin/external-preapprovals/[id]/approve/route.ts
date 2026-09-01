// POST /api/admin/external-preapprovals/[id]/approve
// Approves an external pre-approval submission.
// Body: { reason: string }
// Updates ExternalPreApproval.status = "APPROVED"
// Creates or updates PreQualification for the buyer using submitted data
// Sends prequal-approved email to buyer via Resend
// Writes AuditLog: EXTERNAL_PREQUAL_APPROVED
// Requires reason (min 10 chars)

import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { adminSuccess, adminError } from "@/lib/auth/admin-api";
import { requirePermissionStrict } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { sendPrequalApprovedEmail } from "@/lib/services/email/resend.service";

interface Props { params: Promise<{ id: string }> }

const schema = z.object({
  reason: z.string().min(10, "Reason must be at least 10 characters"),
  // Sanctions gate: external pre-approvals skip the MicroBilt OFAC screen that
  // every iPredict approval runs, so the approving admin must explicitly attest
  // an OFAC/sanctions check was performed. Recorded as a ComplianceEvent.
  ofacAttested: z.literal(true, {
    errorMap: () => ({ message: "You must confirm an OFAC/sanctions check was completed before approving" }),
  }),
});

export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  // Tier 1 (Finding 5): enforced directly from PERMISSION_ROLES.
  // A credit decision on a buyer's external pre-approval.
  const adminCheck = await requirePermissionStrict(request, "finance.preapproval.decide");
  if (!adminCheck.ok) return adminError(adminCheck.code, adminCheck.message, adminCheck.status);
  const admin = adminCheck.admin;

  const submission = await prisma.externalPreApproval.findUnique({
    where: { id },
    include: { buyer: { include: { user: true } } },
  });
  if (!submission) return adminError("NOT_FOUND", "External pre-approval not found", 404);
  if (submission.status !== "SUBMITTED") return adminError("INVALID_STATE", "Only SUBMITTED pre-approvals can be approved", 400);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const { reason } = parsed.data;
  const now = new Date();

  // Record the admin's OFAC attestation as a compliance event before the
  // approval takes effect — this is the sanctions-screening audit trail for the
  // external path (which has no automated bureau OFAC screen).
  await prisma.complianceEvent.create({
    data: {
      eventType: "EXTERNAL_PREQUAL_OFAC_ATTESTED",
      buyerId: submission.buyerId,
      metadata: {
        adminId: admin.adminId,
        adminEmail: admin.email,
        externalPreApprovalId: id,
        attestedAt: now.toISOString(),
      },
    },
  }).catch((err) => logger.error("[external-preapprovals/approve] OFAC attestation event failed:", err));

  // Update external pre-approval status
  await prisma.externalPreApproval.update({
    where: { id },
    data: { status: "APPROVED", reviewedAt: now, reviewedBy: admin.adminId },
  });

  // Create or update PreQualification using submission data
  const expiresAt = submission.expiryDate ?? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  const prequal = await prisma.preQualification.upsert({
    where: { buyerId: submission.buyerId },
    create: {
      buyerId: submission.buyerId,
      decision: "APPROVED",
      tier: null,
      maxOtdAmountCents: submission.approvedAmountCents ?? 0,
      expiresAt,
      checkOfacAlert: false,
      isExternal: true,
      rawResponse: JSON.stringify({
        source: "external_prequal",
        lenderName: submission.lenderName,
        aprRate: submission.aprRate,
        termMonths: submission.termMonths,
        adminId: admin.adminId,
      }),
    },
    update: {
      decision: "APPROVED",
      maxOtdAmountCents: submission.approvedAmountCents ?? 0,
      expiresAt,
      isExternal: true,
      rawResponse: JSON.stringify({
        source: "external_prequal",
        lenderName: submission.lenderName,
        aprRate: submission.aprRate,
        termMonths: submission.termMonths,
        adminId: admin.adminId,
      }),
    },
  });

  const ipAddress = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? undefined;

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "EXTERNAL_PREQUAL_APPROVED",
      entityType: "ExternalPreApproval",
      entityId: id,
      reason,
      ipAddress: ipAddress ?? null,
      metadata: {
        buyerId: submission.buyerId,
        lenderName: submission.lenderName,
        approvedAmountCents: submission.approvedAmountCents,
        prequalId: prequal.id,
      },
    },
  });

  // Send approval email — failure must not block the response
  try {
    const buyer = submission.buyer;
    if (buyer?.user?.email) {
      const firstName = buyer.firstName ?? buyer.user.email.split("@")[0];
      await sendPrequalApprovedEmail({
        to: buyer.user.email,
        firstName,
        maxOtdAmountCents: submission.approvedAmountCents ?? 0,
        tier: null,
        decisionDate: now,
        expiryDate: expiresAt,
      });
    }
  } catch (err) {
    logger.error("[external-preapprovals/approve] email failed:", err);
  }

  return adminSuccess({ approved: true, prequalId: prequal.id });
}
