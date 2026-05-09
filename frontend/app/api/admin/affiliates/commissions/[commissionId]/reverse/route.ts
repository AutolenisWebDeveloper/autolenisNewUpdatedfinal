// POST /api/admin/affiliates/commissions/[commissionId]/reverse
// Reverses an existing commission.
// Body: { reason: string }
// Validates commission is not already REVERSED or PAID
// Sets commission.status = REVERSED
// Writes AuditLog: COMMISSION_REVERSED with previousState={status: oldStatus}
// Requires reason (min 10 chars)
// FINANCE_ADMIN or SUPER_ADMIN only

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

interface Props { params: Promise<{ commissionId: string }> }

const schema = z.object({
  reason: z.string().min(10, "Reason must be at least 10 characters"),
});

const ALLOWED_ROLES = new Set(["SUPER_ADMIN", "FINANCE_ADMIN"]);

export async function POST(request: NextRequest, { params }: Props) {
  const { commissionId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  if (!ALLOWED_ROLES.has(admin.role)) return adminError("FORBIDDEN", "SUPER_ADMIN or FINANCE_ADMIN required", 403);

  const commission = await prisma.commission.findUnique({ where: { id: commissionId } });
  if (!commission) return adminError("NOT_FOUND", "Commission not found", 404);

  if (commission.status === "REVERSED") return adminError("ALREADY_REVERSED", "Commission is already reversed", 400);
  if (commission.status === "PAID") return adminError("ALREADY_PAID", "Cannot reverse a paid commission", 400);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const { reason } = parsed.data;
  const oldStatus = commission.status;

  const updated = await prisma.commission.update({
    where: { id: commissionId },
    data: { status: "REVERSED" },
    select: { id: true, status: true, affiliateId: true },
  });

  const ipAddress = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? undefined;

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "COMMISSION_REVERSED",
      entityType: "Commission",
      entityId: commissionId,
      reason,
      previousState: { status: oldStatus },
      newState: { status: "REVERSED" },
      ipAddress: ipAddress ?? null,
      metadata: { affiliateId: commission.affiliateId, dealId: commission.dealId, amountCents: commission.amountCents },
    },
  });

  return adminSuccess({ commission: { id: updated.id, status: updated.status } });
}
