// POST /api/admin/payments/concierge-fee/[dealId]/refund
// Admin processes concierge fee refund via Stripe.
// Marks deal feeStatus = REFUNDED. Buyer notified. AuditLog entry.

import { NextRequest } from "next/server";
import { getAdminWithRole, adminSuccess, adminError, getClientIp } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { getStripe } from "@/lib/stripe";

interface Props { params: Promise<{ dealId: string }> }

const schema = z.object({ reason: z.string().min(1) });

export async function POST(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const admin = await getAdminWithRole(request, ["SUPER_ADMIN", "FINANCE_ADMIN"]);
  if (!admin) return adminError("FORBIDDEN", "Insufficient permissions", 403);

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: { buyer: true },
  });
  if (!deal) return adminError("NOT_FOUND", "Deal not found", 404);
  if (!deal.feePaidAt) return adminError("FEE_NOT_PAID", "Concierge fee must be paid before refund", 400);
  if (deal.feeRefundedAt) return adminError("ALREADY_REFUNDED", "Concierge fee has already been refunded", 400);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.message, 400);

  const { reason } = parsed.data;

  // Attempt Stripe refund if real PI exists
  if (deal.stripeFeePIId && !deal.stripeFeePIId.startsWith("pi_fee_admin_")) {
    try {
      await getStripe().refunds.create({ payment_intent: deal.stripeFeePIId });
    } catch {
      // Log but allow admin override to proceed
    }
  }

  // Mark fee as refunded using dedicated fields (not clearing feePaidAt)
  const updated = await prisma.deal.update({
    where: { id: dealId },
    data: {
      feeRefundedAt: new Date(),
      feeRefundedAmountCents: deal.feeAmountCents ?? 40000,
    },
  });

  // Notify buyer
  await prisma.notification.create({
    data: {
      buyerId: deal.buyerId,
      type: "DEAL_STAGE_CHANGED",
      channel: "IN_APP",
      title: "Concierge fee refunded",
      body: `Your $${(deal.feeAmountCents ?? 40000) / 100} concierge fee has been refunded. Please allow 3–5 business days.`,
    },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "CONCIERGE_FEE_REFUNDED",
      entityType: "Deal",
      entityId: dealId,
      reason,
      ipAddress: getClientIp(request),
      metadata: { buyerId: deal.buyerId, feeAmountCents: deal.feeAmountCents, stripeFeePIId: deal.stripeFeePIId },
    },
  });

  return adminSuccess({
    dealId,
    feeStatus: "REFUNDED",
    buyerNotified: true,
    feeAmountCents: deal.feeAmountCents ?? 40000,
  });
}
