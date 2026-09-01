import { requirePermissionStrict } from "@/lib/auth/permissions";
import { NextRequest } from "next/server";
import { adminError, adminSuccess } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

interface Props { params: Promise<{ commissionId: string }> }
const schema = z.object({ reason: z.string().min(10, "Reason must be at least 10 characters") });

export async function POST(request: NextRequest, { params }: Props) {
  const { commissionId } = await params;
  const adminCheck = await requirePermissionStrict(request, "finance.commissions.settle");
  // Enforced directly (not via the shadow flag): this route had no role
  // check at all, so every authenticated admin could reach it.
  if (!adminCheck.ok) return adminError(adminCheck.code, adminCheck.message, adminCheck.status);
  const admin = adminCheck.admin;

  const commission = await prisma.commission.findUnique({
    where: { id: commissionId },
  });
  if (!commission) return adminError("NOT_FOUND", "Commission not found", 404);
  if (commission.status !== "PENDING")
    return adminError("INVALID_STATUS", `Commission is ${commission.status}, not PENDING`, 400);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  await prisma.commission.update({
    where: { id: commissionId },
    data: { status: "REJECTED" },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId, adminEmail: admin.email,
      action: "COMMISSION_REJECTED", entityType: "Commission", entityId: commissionId,
      reason: parsed.data.reason,
      metadata: { affiliateId: commission.affiliateId, amountCents: commission.amountCents },
    },
  }).catch(() => {});

  return adminSuccess({ commissionId, status: "REJECTED" });
}
