import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

interface Props { params: Promise<{ affiliateId: string }> }

const schema = z.object({
  decision:        z.enum(["APPROVE", "REJECT", "REQUEST_CORRECTION"]),
  note:            z.string().max(1000).optional(),
  correctionItems: z.array(z.string()).optional(),
});

const DECISION_TITLE_MAP = {
  APPROVE:             "Onboarding approved",
  REJECT:              "Onboarding rejected",
  REQUEST_CORRECTION:  "Correction required",
} as const;

const DECISION_BODY_MAP = {
  APPROVE:             "Your account is now fully verified.",
  REJECT:              "Please check the portal for details.",
  REQUEST_CORRECTION:  "Please check the portal for details.",
} as const;

const DECISION_STATUS_MAP = {
  APPROVE:             "APPROVED",
  REJECT:              "REJECTED",
  REQUEST_CORRECTION:  "NEEDS_CORRECTION",
} as const;

export async function POST(request: NextRequest, { params }: Props) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  if (!["SUPER_ADMIN", "COMPLIANCE_ADMIN", "OPERATIONS_ADMIN"].includes(admin.role)) {
    return adminError("FORBIDDEN", "Insufficient permissions", 403);
  }

  const { affiliateId } = await params;

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }

  const result = schema.safeParse(body);
  if (!result.success) return adminError("VALIDATION_ERROR", result.error.errors[0].message, 400);

  const { decision, note, correctionItems } = result.data;
  const newStatus = DECISION_STATUS_MAP[decision];

  const review = await prisma.affiliateOnboardingReview.upsert({
    where:  { affiliateId },
    create: {
      affiliateId,
      status:          newStatus as never,
      decisionNote:    note,
      correctionItems: correctionItems ?? [],
      reviewedBy:      admin.email,
      reviewedAt:      new Date(),
    },
    update: {
      status:          newStatus as never,
      decisionNote:    note,
      correctionItems: correctionItems ?? [],
      reviewedBy:      admin.email,
      reviewedAt:      new Date(),
    },
  });

  await prisma.notification.create({
    data: {
      affiliateId,
      type:      "SYSTEM_ALERT",
      title:     DECISION_TITLE_MAP[decision],
      body:      note ?? DECISION_BODY_MAP[decision],
      actionUrl: "/affiliate/portal/profile",
    },
  }).catch(() => {});

  await prisma.adminAuditLog.create({
    data: {
      adminId:    admin.adminId,
      adminEmail: admin.email,
      action:     `AFFILIATE_ONBOARDING_${decision}`,
      entityType: "Affiliate",
      entityId:   affiliateId,
      reason:     note,
      metadata:   { decision, correctionItems } as never,
    },
  }).catch(() => {});

  return adminSuccess({ reviewId: review.id, status: newStatus });
}
