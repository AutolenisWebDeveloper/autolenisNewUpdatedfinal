// POST /api/admin/buyers/[buyerId]/prequal/resend-email
//
// Admin action — re-send a prequal decision email (approval / adverse action)
// when a buyer asks for a copy or didn't receive the original. Operational
// roles only. Each resend is logged to AdminAuditLog.
//
// A manual admin resend exists specifically to bypass `sendIdempotent`'s
// permanent de-dup. We hand both email functions a fully-qualified
// `idempotencyKey` salted with the resend moment (millisecond precision), so
// every resend dispatches even when the buyer's prequal hasn't changed and
// the original send is preserved in EmailSendLog untouched.

import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { z } from "zod";
import {
  getAdminWithRole,
  OPERATIONAL_ROLES,
  adminSuccess,
  adminError,
  getClientIp,
} from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import {
  sendPrequalApprovedEmail,
  sendAdverseActionEmail,
} from "@/lib/services/email/resend.service";

interface Props { params: Promise<{ buyerId: string }> }

const schema = z.object({
  kind: z.enum(["APPROVED", "ADVERSE_ACTION"]),
});

export async function POST(request: NextRequest, { params }: Props) {
  const { buyerId } = await params;
  const admin = await getAdminWithRole(request, OPERATIONAL_ROLES);
  if (!admin) return adminError("FORBIDDEN", "Insufficient permissions", 403);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const buyer = await prisma.buyer.findUnique({
    where: { id: buyerId },
    include: { user: true, preQualification: true },
  });
  if (!buyer) return adminError("NOT_FOUND", "Buyer not found", 404);
  const prequal = buyer.preQualification;
  if (!prequal) return adminError("NOT_FOUND", "No prequalification on file", 404);

  const { kind } = parsed.data;
  const stamp = new Date();

  if (kind === "APPROVED" && prequal.decision !== "APPROVED") {
    return adminError("INVALID_STATE", "Buyer's current decision is not APPROVED", 400);
  }
  if (kind === "ADVERSE_ACTION" && prequal.decision !== "DECLINED") {
    return adminError("INVALID_STATE", "Buyer's current decision is not DECLINED", 400);
  }

  const resendIdempotencyKey =
    kind === "APPROVED"
      ? `prequal-approved-resend-${prequal.id}-${stamp.toISOString()}`
      : `adverse-action-resend-${prequal.id}-${stamp.toISOString()}`;

  try {
    if (kind === "APPROVED") {
      await sendPrequalApprovedEmail({
        to: buyer.user.email,
        firstName: buyer.firstName,
        // Resend uses the current persisted snapshot so the email matches what
        // the buyer sees on /buyer/prequal today.
        maxOtdAmountCents: prequal.maxOtdAmountCents,
        tier: prequal.tier,
        decisionDate: stamp,
        expiryDate: prequal.expiresAt,
        idempotencyKey: resendIdempotencyKey,
      });
    } else {
      await sendAdverseActionEmail({
        to: buyer.user.email,
        firstName: buyer.firstName,
        decisionDate: stamp.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
        prequalApplicationId: prequal.id,
        idempotencyKey: resendIdempotencyKey,
        adverseReasonCodes: prequal.adverseReasonCodes,
      });
    }
  } catch (err) {
    logger.error("[admin/prequal/resend-email] send failed:", err);
    return adminError("EMAIL_SEND_FAILED", "Failed to dispatch email", 500);
  }

  const audit = await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: kind === "APPROVED"
        ? "PREQUAL_APPROVAL_EMAIL_RESENT"
        : "PREQUAL_ADVERSE_ACTION_EMAIL_RESENT",
      entityType: "PreQualification",
      entityId: prequal.id,
      reason: `Admin resent ${kind === "APPROVED" ? "approval" : "adverse-action"} email`,
      ipAddress: getClientIp(request),
      metadata: { buyerId, recipient: buyer.user.email, decision: prequal.decision },
    },
  });

  return adminSuccess({ ok: true, auditLogId: audit.id });
}
