// POST /api/admin/buyers/[buyerId]/prequal/manual-override
//
// CANONICAL admin manual-override endpoint. This is the ONLY route that
// performs a manual override — the base /prequal route holds GET only.
// All admin UIs and integrations must POST here.
//
// Admin manual prequalification override — sets decision, tier, maxOtdAmountCents,
// and expiresAt directly WITHOUT calling MicroBilt.
//
// This is intentionally SEPARATE from the iPredict run endpoint:
//   - No consumer report is pulled.
//   - Label "manual" must be used in the UI — never implied to be iPredict.
//   - OFAC hard gate is MANDATORY and enforced here: if checkOfacAlert is true
//     the decision is overridden to OFAC_REVIEW and an admin notification is
//     created. Any future override path must preserve this gate.
//   - AdminAuditLog + ComplianceEvent written on every action.
//   - Adverse-action email sent when decision is DECLINED (FCRA § 615).

import { NextRequest } from "next/server";
import { z } from "zod";
import { getAdminWithRole, OPERATIONAL_ROLES, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { PreQualDecision, PreQualTier } from "@prisma/client";
import {
  sendPrequalApprovedEmail,
  sendAdverseActionEmail,
} from "@/lib/services/email/resend.service";

// Manual overrides are valid for 90 days (longer than iPredict's 30-day window).
const MANUAL_OVERRIDE_EXPIRY_MS = 90 * 24 * 60 * 60 * 1000;
// Approval emails always display a 30-day expiry window regardless of prequal source.
const APPROVAL_EMAIL_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

interface Props { params: Promise<{ buyerId: string }> }

const schema = z.object({
  decision:          z.nativeEnum(PreQualDecision),
  tier:              z.nativeEnum(PreQualTier).optional(),
  maxOtdAmountCents: z.number().int().positive("Max OTD amount must be positive"),
  reason:            z.string().trim().min(1, "Reason note is required").max(1000),
  checkOfacAlert:    z.boolean().default(false),
});

export async function POST(request: NextRequest, { params }: Props) {
  const { buyerId } = await params;
  const admin = await getAdminWithRole(request, OPERATIONAL_ROLES);
  if (!admin) return adminError("FORBIDDEN", "OPERATIONS_ADMIN or higher required for prequal overrides.", 403);

  const buyer = await prisma.buyer.findUnique({
    where: { id: buyerId },
    include: { user: true },
  });
  if (!buyer) return adminError("NOT_FOUND", "Buyer not found", 404);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return adminError("VALIDATION_ERROR", "Invalid JSON", 400);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return adminError(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Invalid input",
      400
    );
  }

  const { decision: rawDecision, tier, maxOtdAmountCents, reason, checkOfacAlert } =
    parsed.data;

  // OFAC hard gate — if the admin flags OFAC, the decision MUST escalate to
  // OFAC_REVIEW regardless of what the admin submitted. Previously only
  // APPROVED was overridden, allowing flagged buyers to be set to PENDING or
  // DECLINED without escalation.
  let decision: PreQualDecision = rawDecision;
  if (checkOfacAlert) {
    decision = PreQualDecision.OFAC_REVIEW;
    await prisma.notification
      .create({
        data: {
          title: "OFAC Alert — Manual Override Flagged",
          body: `Admin ${admin.email} submitted a manual override with OFAC alert for buyer ${buyerId}. Decision set to OFAC_REVIEW.`,
          type: "SYSTEM_ALERT",
        },
      })
      .catch(() => {});
  }

  const expiresAt = new Date(Date.now() + MANUAL_OVERRIDE_EXPIRY_MS);

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
      metadata: { decision, maxOtdAmountCents, tier: tier ?? null, buyerId },
    },
  });

  if (decision === PreQualDecision.APPROVED) {
    const decisionDate = new Date();
    const emailExpiryDate = new Date(Date.now() + APPROVAL_EMAIL_EXPIRY_MS);

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
      console.error("[admin/prequal/manual-override] Failed to send approval email:", emailErr);
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
            source: "admin_manual",
          },
        },
      });
    } catch (logErr) {
      console.error("[admin/prequal/manual-override] Failed to log compliance event:", logErr);
    }
  }

  // FCRA § 615: adverse action notice on DECLINED decisions.
  // ComplianceEvent reflects true send status — duplicate-suppressed sends
  // are logged as ADVERSE_ACTION_NOTICE_SUPPRESSED_DUPLICATE so the audit
  // trail does not falsely claim a notice was delivered.
  if (decision === PreQualDecision.DECLINED) {
    const decisionDateStr = new Date().toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });

    // See prequal.service.ts for the SENT/DUPLICATE/FAILED/DEV_SKIPPED contract —
    // we map on the discriminated outcome, not on the boolean `sent`.
    let outcome: "SENT" | "DUPLICATE" | "FAILED" | "DEV_SKIPPED" | "THREW" = "THREW";
    let adverseActionErrorMessage: string | null = null;
    try {
      const sendResult = await sendAdverseActionEmail({
        to: buyer.user.email,
        firstName: buyer.firstName,
        decisionDate: decisionDateStr,
        prequalApplicationId: prequal.id,
        decisionTimestamp: prequal.updatedAt.toISOString(),
      });
      outcome = sendResult.outcome;
    } catch (emailErr) {
      console.error("[admin/prequal/manual-override] Failed to send adverse action email:", emailErr);
      adverseActionErrorMessage =
        emailErr instanceof Error ? emailErr.message : String(emailErr);
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
          buyerId: buyer.id,
          prequalApplicationId: prequal.id,
          metadata: {
            sentTo: buyer.user.email,
            sentAt: new Date().toISOString(),
            decisionTimestamp: prequal.updatedAt.toISOString(),
            sendOutcome: outcome,
            source: "admin_manual",
            ...(adverseActionErrorMessage
              ? { errorMessage: adverseActionErrorMessage }
              : {}),
          },
        },
      });
    } catch (logErr) {
      console.error("[admin/prequal/manual-override] Failed to log adverse action event:", logErr);
    }
  }

  return adminSuccess(
    {
      prequal: {
        id: prequal.id,
        buyerId: prequal.buyerId,
        decision: prequal.decision,
        tier: prequal.tier,
        maxOtdAmountCents: prequal.maxOtdAmountCents,
        expiresAt: prequal.expiresAt,
      },
    },
    201
  );
}
