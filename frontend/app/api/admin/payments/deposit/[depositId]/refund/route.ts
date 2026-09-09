// POST /api/admin/payments/deposit/[depositId]/refund
// Admin processes a deposit refund via Stripe.
// Updates depositStatus = REFUNDED. Buyer notified. AuditLog entry.

import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getAdminWithRole, adminSuccess, adminError, getClientIp } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { DEPOSIT_AMOUNT_USD } from "@/lib/constants";
import { refundDepositCharge } from "@/lib/services/payment/refund.service";

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
  // MONEY-PATH DEFECT 3, the consolidation. Everything that used to be written out
  // inline here — the has-a-real-charge test, the succeeded precheck, the
  // deposit-scoped idempotency key, the charge_already_refunded sync and the
  // status-guarded flip — now lives in the one primitive, and the other two refund
  // paths call the same thing. This route was the ONLY one of the three that checked
  // the PaymentIntent had actually succeeded, so consolidating meant promoting that
  // check rather than dropping it.
  let outcome: Awaited<ReturnType<typeof refundDepositCharge>>["outcome"];
  let stripeRefundId: string | null = null;
  try {
    ({ outcome, stripeRefundId } = await refundDepositCharge(deposit, reason));
  } catch (stripeErr) {
    const msg = (stripeErr as { message?: string } | null)?.message ?? "Unknown Stripe error";
    logger.error("[deposit/refund] Stripe refund failed:", { msg, depositId });
    return adminError("STRIPE_REFUND_FAILED", `Stripe refund failed: ${msg}`, 502);
  }

  if (outcome === "NO_CHARGE") {
    return adminError(
      "NO_STRIPE_CHARGE",
      "This deposit has no captured Stripe charge (admin-seeded or comped) — there is nothing to refund. It must be reconciled out of band.",
      400,
    );
  }
  if (outcome === "NOT_SUCCEEDED") {
    return adminError(
      "STRIPE_PI_NOT_SUCCEEDED",
      "Cannot refund: Stripe reports this PaymentIntent never succeeded, so there is no captured money to return.",
      400,
    );
  }
  if (outcome === "ALREADY_REFUNDED") {
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
