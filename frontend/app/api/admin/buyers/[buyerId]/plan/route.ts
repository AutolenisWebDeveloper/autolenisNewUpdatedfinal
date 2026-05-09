// POST /api/admin/buyers/[buyerId]/plan
// Changes buyer plan (STANDARD or PREMIUM).
// Validates buyer exists, updates plan and planUpgradedAt.
// Writes AuditLog: BUYER_PLAN_CHANGED with previousState/newState.
// Requires reason (min 10 chars).
// SUPER_ADMIN or FINANCE_ADMIN only.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

interface Props { params: Promise<{ buyerId: string }> }

const schema = z.object({
  plan: z.enum(["STANDARD", "PREMIUM"]),
  reason: z.string().min(10, "Reason must be at least 10 characters"),
});

const ALLOWED_ROLES = new Set(["SUPER_ADMIN", "FINANCE_ADMIN"]);

export async function POST(request: NextRequest, { params }: Props) {
  const { buyerId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  if (!ALLOWED_ROLES.has(admin.role)) return adminError("FORBIDDEN", "SUPER_ADMIN or FINANCE_ADMIN required", 403);

  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId }, include: { user: true } });
  if (!buyer) return adminError("NOT_FOUND", "Buyer not found", 404);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const { plan, reason } = parsed.data;
  const oldPlan = buyer.plan;

  if (oldPlan === plan) return adminError("NO_CHANGE", `Buyer is already on ${plan} plan`, 400);

  const now = new Date();
  const updated = await prisma.buyer.update({
    where: { id: buyerId },
    data: {
      plan,
      planUpgradedAt: plan === "PREMIUM" ? now : null,
    },
    select: { id: true, plan: true, planUpgradedAt: true },
  });

  const ipAddress = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? undefined;

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "BUYER_PLAN_CHANGED",
      entityType: "Buyer",
      entityId: buyerId,
      reason,
      previousState: { plan: oldPlan },
      newState: { plan },
      ipAddress: ipAddress ?? null,
      metadata: { buyerEmail: buyer.user.email },
    },
  });

  return adminSuccess({ buyer: { id: updated.id, plan: updated.plan, planUpgradedAt: updated.planUpgradedAt } });
}
