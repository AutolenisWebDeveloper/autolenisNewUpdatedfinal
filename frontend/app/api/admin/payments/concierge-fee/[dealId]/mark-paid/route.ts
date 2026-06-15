// POST /api/admin/payments/concierge-fee/[dealId]/mark-paid
// Admin manually marks concierge fee as PAID.
// Deal advances past fee stage. AuditLog entry.

import { NextRequest } from "next/server";
import { getAdminWithRole, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { advanceDealStatus } from "@/lib/services/deal/deal.service";
import { z } from "zod";

interface Props { params: Promise<{ dealId: string }> }

const schema = z.object({ reason: z.string().min(1) });

export async function POST(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const admin = await getAdminWithRole(request, ["SUPER_ADMIN", "FINANCE_ADMIN"]);
  if (!admin) return adminError("FORBIDDEN", "Insufficient permissions", 403);

  const deal = await prisma.deal.findUnique({ where: { id: dealId } });
  if (!deal) return adminError("NOT_FOUND", "Deal not found", 404);
  if (deal.feePaidAt) return adminError("ALREADY_PAID", "Concierge fee is already paid", 400);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.message, 400);

  const { reason } = parsed.data;

  // Admin override: record the fee as paid and advance to FEE_PAID through the
  // guarded seam (force, audit-logged below + DealStatusHistory).
  await advanceDealStatus(dealId, "FEE_PAID", {
    actorId: admin.adminId,
    actorRole: "ADMIN",
    reason,
    force: true,
    data: { feePaidAt: new Date() },
  });
  const updated = (await prisma.deal.findUnique({ where: { id: dealId } }))!;

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "CONCIERGE_FEE_MARK_PAID_OVERRIDE",
      entityType: "Deal",
      entityId: dealId,
      reason,
      metadata: { buyerId: deal.buyerId, feeAmountCents: deal.feeAmountCents, feePaidAt: updated.feePaidAt?.toISOString() },
    },
  });

  return adminSuccess({
    dealId,
    feePaidAt: updated.feePaidAt,
    dealStatus: updated.status,
    feeStatus: "PAID",
  });
}
