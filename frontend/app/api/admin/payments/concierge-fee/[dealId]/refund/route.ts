// POST /api/admin/payments/concierge-fee/[dealId]/refund
// Admin processes concierge fee refund via Stripe.
// Marks deal feeStatus = REFUNDED. Buyer notified. AuditLog entry.

import { NextRequest } from "next/server";
import { getAdminWithRole, adminSuccess, adminError, getClientIp } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { getStripe } from "@/lib/stripe";
import { PREMIUM_FEE_REMAINING_CENTS } from "@/lib/constants";

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

  // Verify the PI is in `succeeded` state before issuing a refund. Without
  // this guard a misclick on a pending or failed deal would either error out
  // of Stripe (leaving us with a confusing 4xx) or — worse — mark the deal as
  // refunded in our DB while the money never moved.
  let stripeRefundId: string | null = null;
  if (deal.stripeFeePIId && !deal.stripeFeePIId.startsWith("pi_fee_admin_")) {
    try {
      const pi = await getStripe().paymentIntents.retrieve(deal.stripeFeePIId);
      if (pi.status !== "succeeded") {
        return adminError(
          "STRIPE_PI_NOT_SUCCEEDED",
          `Cannot refund: Stripe PaymentIntent status is "${pi.status}", expected "succeeded".`,
          400,
        );
      }
      const refund = await getStripe().refunds.create(
        { payment_intent: deal.stripeFeePIId },
        { idempotencyKey: `refund-concierge-fee-${dealId}` },
      );
      stripeRefundId = refund.id;
    } catch (stripeErr) {
      const code = (stripeErr as { code?: string } | null)?.code;
      const msg = (stripeErr as { message?: string } | null)?.message ?? "Unknown Stripe error";
      if (code !== "charge_already_refunded") {
        console.error("[concierge-fee/refund] Stripe refund failed:", { code, msg, dealId });
        return adminError("STRIPE_REFUND_FAILED", `Stripe refund failed: ${msg}`, 502);
      }
      console.warn("[concierge-fee/refund] charge already refunded out-of-band — syncing DB only:", { dealId });
    }
  }

  // Mark fee as refunded using dedicated fields (not clearing feePaidAt).
  // Fall back to the net charged amount (PREMIUM_FEE_REMAINING_CENTS) when
  // the deal row predates feeAmountCents being recorded — never a hardcoded literal.
  const refundedAmountCents = deal.feeAmountCents ?? PREMIUM_FEE_REMAINING_CENTS;
  const updated = await prisma.deal.update({
    where: { id: dealId },
    data: {
      feeRefundedAt: new Date(),
      feeRefundedAmountCents: refundedAmountCents,
    },
  });

  // Notify buyer
  await prisma.notification.create({
    data: {
      buyerId: deal.buyerId,
      type: "DEAL_STAGE_CHANGED",
      channel: "IN_APP",
      title: "Concierge fee refunded",
      body: `Your $${refundedAmountCents / 100} concierge fee has been refunded. Please allow 3–5 business days.`,
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
      metadata: {
        buyerId: deal.buyerId,
        feeAmountCents: deal.feeAmountCents,
        stripeFeePIId: deal.stripeFeePIId,
        stripeRefundId,
        refundedAmountCents,
      },
    },
  });

  return adminSuccess({
    dealId,
    feeStatus: "REFUNDED",
    buyerNotified: true,
    feeAmountCents: refundedAmountCents,
    stripeRefundId,
  });
}
