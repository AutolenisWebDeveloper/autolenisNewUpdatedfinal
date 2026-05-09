// POST /api/admin/payments/deposit/[depositId]/mark-paid
// Admin manually marks a deposit as PAID without going through Stripe.
// Unblocks auction creation.
// AuditLog entry with override reason required.

import { NextRequest } from "next/server";
import { getAdminWithRole, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

interface Props { params: Promise<{ depositId: string }> }

const schema = z.object({ reason: z.string().min(1) });

export async function POST(request: NextRequest, { params }: Props) {
  const { depositId } = await params;
  const admin = await getAdminWithRole(request, ["SUPER_ADMIN", "FINANCE_ADMIN"]);
  if (!admin) return adminError("FORBIDDEN", "Insufficient permissions", 403);

  const deposit = await prisma.deposit.findUnique({ where: { id: depositId } });
  if (!deposit) return adminError("NOT_FOUND", "Deposit not found", 404);
  if (deposit.status === "PAID") return adminError("ALREADY_PAID", "Deposit is already marked PAID", 400);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.message, 400);

  const { reason } = parsed.data;

  const updated = await prisma.deposit.update({
    where: { id: depositId },
    data: { status: "PAID" },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "DEPOSIT_MARK_PAID_OVERRIDE",
      entityType: "Deposit",
      entityId: depositId,
      reason,
      metadata: { buyerId: deposit.buyerId, amountCents: deposit.amountCents, override: true },
    },
  });

  return adminSuccess({
    depositId,
    status: updated.status,
    buyerId: updated.buyerId,
    auctionUnblocked: true,
  });
}
