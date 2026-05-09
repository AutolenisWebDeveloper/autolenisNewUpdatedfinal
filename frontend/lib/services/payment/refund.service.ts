// lib/services/payment/refund.service.ts
import { prisma } from "@/lib/prisma";
import { refundPaymentIntent } from "./stripe.service";

export async function processRefund(depositId: string, reason: string): Promise<boolean> {
  const deposit = await prisma.deposit.findUnique({ where: { id: depositId } });
  if (!deposit || deposit.status !== "PAID" || !deposit.stripePaymentIntentId) return false;

  await refundPaymentIntent(deposit.stripePaymentIntentId, reason);
  await prisma.deposit.update({ where: { id: depositId }, data: { status: "REFUNDED", refundedAt: new Date() } });

  await prisma.notification.create({ data: {
    buyerId: deposit.buyerId, type: "DEAL_STAGE_CHANGED",
    title: "Refund processed", body: "Your $99 deposit refund has been processed. Allow 3-5 business days.",
  }}).catch(() => {});

  return true;
}
