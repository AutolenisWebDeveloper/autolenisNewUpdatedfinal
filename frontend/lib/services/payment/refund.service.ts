// lib/services/payment/refund.service.ts
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { refundPaymentIntent } from "./stripe.service";
import { DEPOSIT_AMOUNT_USD } from "@/lib/constants";

export type DepositRefundOutcome = "REFUNDED" | "ALREADY_REFUNDED" | "NO_CHARGE";

// FS-K — the ONE shared "refund a deposit's real charge" primitive, so every
// admin refund path treats a no-real-charge deposit identically. A deposit
// seeded by an admin-override path took no money: it carries either no
// PaymentIntent or a synthetic `pi_admin_` id (created when Stripe is
// unreachable). Refunding + flipping those to REFUNDED and telling the buyer a
// refund is on the way is a fake success — no money ever moves. This returns
// NO_CHARGE for them (no Stripe call, no status flip); callers MUST gate their
// "your refund has been processed" messaging on a REFUNDED result.
//
// Real charge → issues one idempotency-keyed Stripe refund (deposit-scoped key,
// so concurrent paths collapse to a single refund; charge_already_refunded is
// treated as money-already-gone) and flips PAID→REFUNDED via a status-guarded
// updateMany (never the findFirst+unconditional-update anti-pattern). ALREADY_
// REFUNDED means a concurrent path won the flip.
export async function refundDepositCharge(
  deposit: { id: string; stripePaymentIntentId: string | null },
): Promise<DepositRefundOutcome> {
  const hasRealCharge =
    !!deposit.stripePaymentIntentId && !deposit.stripePaymentIntentId.startsWith("pi_admin_");
  if (!hasRealCharge) return "NO_CHARGE";

  try {
    await refundPaymentIntent(deposit.stripePaymentIntentId!, "admin refund", `refund-deposit-${deposit.id}`);
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    // Money already left Stripe out of band — safe to sync our DB state.
    // Anything else means the refund did NOT happen; do not flip.
    if (code !== "charge_already_refunded") throw err;
    logger.warn("[refund] charge already refunded out-of-band — syncing DB only:", { depositId: deposit.id });
  }

  const flipped = await prisma.deposit.updateMany({
    where: { id: deposit.id, status: "PAID" },
    data: { status: "REFUNDED", refundedAt: new Date() },
  });
  return flipped.count > 0 ? "REFUNDED" : "ALREADY_REFUNDED";
}

export async function processRefund(depositId: string, reason: string): Promise<boolean> {
  const deposit = await prisma.deposit.findUnique({ where: { id: depositId } });
  // FS-K: only a PAID deposit with a REAL captured charge (not a synthetic
  // pi_admin_ id) can be refunded — otherwise there is no money to return.
  if (
    !deposit ||
    deposit.status !== "PAID" ||
    !deposit.stripePaymentIntentId ||
    deposit.stripePaymentIntentId.startsWith("pi_admin_")
  ) {
    return false;
  }

  await refundPaymentIntent(deposit.stripePaymentIntentId, reason, `refund-deposit-${depositId}`);
  // Status-guarded flip so a concurrent refund path can't double-write.
  const flipped = await prisma.deposit.updateMany({
    where: { id: depositId, status: "PAID" },
    data: { status: "REFUNDED", refundedAt: new Date() },
  });
  if (flipped.count === 0) return false;

  await prisma.notification.create({ data: {
    buyerId: deposit.buyerId, type: "DEAL_STAGE_CHANGED",
    title: "Refund processed", body: `Your ${DEPOSIT_AMOUNT_USD} deposit refund has been processed. Allow 3-5 business days.`,
  }}).catch(() => {});

  return true;
}
