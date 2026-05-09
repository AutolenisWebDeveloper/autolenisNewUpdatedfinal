// GET  /api/admin/buyers/[buyerId]/prequal
// Returns current prequal status, consent status, and buyer data readiness.
// Used by the admin prequalification panel to determine what actions are available.
//
// POST /api/admin/buyers/[buyerId]/prequal
// Admin manual override — sets decision, maxOtdAmountCents, tier, expiresAt directly.
// Does NOT call MicroBilt. For MicroBilt iPredict, use /prequal/run-ipredict.
// AuditLog entry created for every action.

import { NextRequest } from "next/server";
import { getAdminFromRequest, getAdminWithRole, adminSuccess, adminError, getClientIp } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { PreQualDecision, PreQualTier } from "@prisma/client";
import { sendPrequalApprovedEmail, sendAdverseActionEmail } from "@/lib/services/email/resend.service";

interface Props { params: Promise<{ buyerId: string }> }

const schema = z.object({
  decision:          z.nativeEnum(PreQualDecision),
  tier:              z.nativeEnum(PreQualTier).optional(),
  maxOtdAmountCents: z.number().int().positive(),
  reason:            z.string().min(1),
  checkOfacAlert:    z.boolean().default(false),
});

export async function GET(request: NextRequest, { params }: Props) {
  const { buyerId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  try {
    const { getAdminPrequalReadiness } = await import(
      "@/lib/services/prequal/admin-prequal.service"
    );
    const readiness = await getAdminPrequalReadiness(buyerId);
    return adminSuccess(readiness);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg === "Buyer not found") return adminError("NOT_FOUND", "Buyer not found", 404);
    console.error("[admin/prequal GET]", err);
    return adminError("SERVER_ERROR", "Failed to load prequal readiness", 500);
  }
}

export async function POST(request: NextRequest, { params }: Props) {
  const { buyerId } = await params;
  const admin = await getAdminWithRole(request, ["SUPER_ADMIN", "COMPLIANCE_ADMIN"]);
  if (!admin) return adminError("FORBIDDEN", "Insufficient permissions", 403);

  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId }, include: { user: true } });
  if (!buyer) return adminError("NOT_FOUND", "Buyer not found", 404);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const { decision, tier, maxOtdAmountCents, reason, checkOfacAlert } = parsed.data;
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 90 days

  const prequal = await prisma.preQualification.upsert({
    where: { buyerId },
    create: {
      buyerId,
      decision,
      tier: tier ?? null,
      maxOtdAmountCents,
      expiresAt,
      checkOfacAlert,
      isExternal: false,
      rawResponse: JSON.stringify({ source: "admin_manual", adminId: admin.adminId }),
    },
    update: {
      decision,
      tier: tier ?? undefined,
      maxOtdAmountCents,
      expiresAt,
      checkOfacAlert,
      rawResponse: JSON.stringify({ source: "admin_manual", adminId: admin.adminId }),
    },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "PREQUAL_MANUAL_OVERRIDE",
      entityType: "PreQualification",
      entityId: prequal.id,
      reason,
      ipAddress: getClientIp(request),
      metadata: { decision, maxOtdAmountCents, tier: tier ?? null, buyerId },
    },
  });

  // Send congratulations email and log compliance event when admin approves.
  // Email failure must never block the response.
  if (decision === PreQualDecision.APPROVED) {
    const decisionDate = new Date();
    const emailExpiryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    try {
      await sendPrequalApprovedEmail({
        to: buyer.user.email,
        firstName: buyer.firstName,
        maxOtdAmountCents,
        tier: tier ?? null,
        decisionDate,
        expiryDate: emailExpiryDate,
      });
    } catch (emailErr) {
      console.error("[admin/prequal] Failed to send approval email:", emailErr);
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
            maxOtdAmountCents,
            tier: tier ?? null,
            expiresAt: emailExpiryDate.toISOString(),
          },
        },
      });
    } catch (logErr) {
      console.error("[admin/prequal] Failed to log compliance event:", logErr);
    }
  }

  // FCRA § 615: Send adverse action notice on DECLINED decisions.
  if (decision === PreQualDecision.DECLINED) {
    const decisionDateStr = new Date().toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    try {
      await sendAdverseActionEmail({
        to: buyer.user.email,
        firstName: buyer.firstName,
        decisionDate: decisionDateStr,
        prequalApplicationId: prequal.id,
      });
    } catch (emailErr) {
      console.error("[admin/prequal] Failed to send adverse action email:", emailErr);
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
            source: "admin_manual",
          },
        },
      });
    } catch (logErr) {
      console.error("[admin/prequal] Failed to log adverse action compliance event:", logErr);
    }
  }

  return adminSuccess({
    prequal: {
      id: prequal.id,
      buyerId: prequal.buyerId,
      decision: prequal.decision,
      tier: prequal.tier,
      maxOtdAmountCents: prequal.maxOtdAmountCents,
      expiresAt: prequal.expiresAt,
    },
  }, 201);
}
