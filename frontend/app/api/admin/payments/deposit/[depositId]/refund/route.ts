// POST /api/admin/payments/deposit/[depositId]/refund
// Admin processes a deposit refund via Stripe.
// Updates depositStatus = REFUNDED. Buyer notified. AuditLog entry.

import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getAdminWithRole, adminSuccess, adminError, getClientIp } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { getStripe } from "@/lib/stripe";
import { DEPOSIT_AMOUNT_USD } from "@/lib/constants";

interface Props { params: Promise<{ depositId: string }> }

const schema = z.object({ reason: z.string().min(1) });

export async function POST(request: NextRequest, { params }: Props) {
  const { depositId } = await params;
  const admin = await getAdminWithRole(request, ["SUPER_ADMIN", "FINANCE_ADMIN"]);
  if (!admin) return adminError("FORBIDDEN", "Insufficient permissions", 403);

  const deposit = await prisma.deposit.findUnique({ where: { id: depositId } });
  if (!deposit) return adminError("NOT_FOUND", "Deposit not found", 404);
  if (deposit.status === "REFUNDED") return adminError("ALREADY_REFUNDED", "Deposit is already refunded", 400);
  if (deposit.status !== "PAID") return adminError("NOT_PAID", "Deposit must be PAID to refund", 400);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.message, 400);

  const { reason } = parsed.data;

  // FS-K — a refund can only be issued against a REAL captured Stripe charge.
  // Deposits seeded by an admin-override path took no money: they carry either no
  // PaymentIntent or a synthetic `pi_admin_` id. Marking those REFUNDED and
  // telling the buyer "your refund has been processed, allow 3–5 business days"
  // is a fake success — no money ever moves. Reject them here so the DB never
  // records a refund that did not happen; a comped/admin-seeded deposit is
  // reconciled out of band, not through the Stripe refund path.
  const hasRealCharge =
    !!deposit.stripePaymentIntentId && !deposit.stripePaymentIntentId.startsWith("pi_admin_");
  if (!hasRealCharge) {
    return adminError(
      "NO_STRIPE_CHARGE",
      "This deposit has no captured Stripe charge (admin-seeded or comped) — there is nothing to refund. It must be reconciled out of band.",
      400,
    );
  }

  // Verify the PI is actually in `succeeded` state before issuing a refund —
  // refunding a non-succeeded PI is an error path Stripe returns 4xx for, and
  // we'd rather catch the divergence here than mark the deposit REFUNDED in our
  // DB while the money never actually leaves Stripe.
  let stripeRefundId: string | null = null;
  try {
    const pi = await getStripe().paymentIntents.retrieve(deposit.stripePaymentIntentId!);
    if (pi.status !== "succeeded") {
      return adminError(
        "STRIPE_PI_NOT_SUCCEEDED",
        `Cannot refund: Stripe PaymentIntent status is "${pi.status}", expected "succeeded".`,
        400,
      );
    }
    const refund = await getStripe().refunds.create(
      { payment_intent: deposit.stripePaymentIntentId! },
      { idempotencyKey: `refund-deposit-${depositId}` },
    );
    stripeRefundId = refund.id;
  } catch (stripeErr) {
    const code = (stripeErr as { code?: string } | null)?.code;
    const msg = (stripeErr as { message?: string } | null)?.message ?? "Unknown Stripe error";
    // `charge_already_refunded` means the money already left Stripe — safe to
    // sync our DB state. Any other error means the refund did NOT happen and
    // we must NOT mark the deposit as refunded.
    if (code !== "charge_already_refunded") {
      logger.error("[deposit/refund] Stripe refund failed:", { code, msg, depositId });
      return adminError("STRIPE_REFUND_FAILED", `Stripe refund failed: ${msg}`, 502);
    }
    logger.warn("[deposit/refund] charge already refunded out-of-band — syncing DB only:", { depositId });
  }

  // Status-guarded flip (only a still-PAID deposit) so a concurrent refund path
  // collapses to one write and a REFUNDED/FAILED deposit is never resurrected.
  const flip = await prisma.deposit.updateMany({
    where: { id: depositId, status: "PAID" },
    data: { status: "REFUNDED", refundedAt: new Date() },
  });
  if (flip.count === 0) {
    return adminError("ALREADY_REFUNDED", "Deposit was already refunded by a concurrent action", 409);
  }
  const updated = await prisma.deposit.findUnique({ where: { id: depositId } });

  // Notify buyer via in-app notification
  await prisma.notification.create({
    data: {
      buyerId: deposit.buyerId,
      type: "DEAL_STAGE_CHANGED",
      channel: "IN_APP",
      title: "Deposit refund processed",
      body: `Your ${DEPOSIT_AMOUNT_USD} deposit refund has been processed. Please allow 3–5 business days.`,
    },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "DEPOSIT_REFUNDED",
      entityType: "Deposit",
      entityId: depositId,
      reason,
      ipAddress: getClientIp(request),
      metadata: {
        buyerId: deposit.buyerId,
        amountCents: deposit.amountCents,
        refundedAt: updated?.refundedAt?.toISOString(),
        stripeRefundId,
      },
    },
  });

  return adminSuccess({
    depositId,
    status: "REFUNDED",
    refundedAt: updated?.refundedAt ?? null,
    buyerNotified: true,
  });
}
