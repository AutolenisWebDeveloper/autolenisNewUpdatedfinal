// lib/services/payment/refund.service.ts
import { prisma } from "@/lib/prisma";
import { refundPaymentIntent } from "./stripe.service";
import { DEPOSIT_AMOUNT_USD } from "@/lib/constants";

export async function processRefund(depositId: string, reason: string): Promise<boolean> {
  const deposit = await prisma.deposit.findUnique({ where: { id: depositId } });
  if (!deposit || deposit.status !== "PAID" || !deposit.stripePaymentIntentId) return false;

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
