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

import { NextRequest } from "next/server";
import { z } from "zod";
import { getAdminWithRole, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { PreQualDecision, PreQualTier } from "@prisma/client";
import {
  sendPrequalApprovedEmail,
  sendAdverseActionEmail,
} from "@/lib/services/email/resend.service";

const APPROVAL_EMAIL_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
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

  // Only the four review states are eligible for manual decision via this route.
  const ACTIONABLE: PreQualDecision[] = ["MANUAL_REVIEW", "OFAC_REVIEW", "OFAC_ESCALATED", "PENDING"];
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

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.preQualification.update({
      where: { id },
      data: {
        decision: newDecision,
        tier: newTier,
        maxOtdAmountCents: newMaxCents,
      },
    });

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
  });

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
        expiryDate: new Date(Date.now() + APPROVAL_EMAIL_EXPIRY_MS),
      });
    } catch (err) {
      console.error("[admin/prequal/decide] approval email failed:", err);
    }
  } else if (newDecision === PreQualDecision.DECLINED) {
    try {
      await sendAdverseActionEmail({
        to: existing.buyer.user.email,
        firstName: existing.buyer.firstName,
        decisionDate: new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
        prequalApplicationId: id,
        decisionTimestamp: updated.updatedAt.toISOString(),
      });
    } catch (err) {
      console.error("[admin/prequal/decide] adverse-action email failed:", err);
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
