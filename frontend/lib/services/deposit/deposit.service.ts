// lib/services/deposit/deposit.service.ts
// System 3 — Stripe deposit management

import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { DEPOSIT_AMOUNT_CENTS, DEPOSIT_AMOUNT_USD } from "@/lib/constants";
import { inviteDealersToAuction } from "@/lib/services/auction/dealer-invitation.service";
import { launchAuction } from "@/lib/services/auction/auction.service";

export async function createDepositIntent(buyerId: string, auctionId?: string) {
  const paymentIntent = await getStripe().paymentIntents.create({
    amount: DEPOSIT_AMOUNT_CENTS, // Hardcoded — never from client
    currency: "usd",
    metadata: { buyerId, type: "deposit", ...(auctionId && { auctionId }) },
  });

  await prisma.deposit.create({
    data: {
      buyerId,
      amountCents: DEPOSIT_AMOUNT_CENTS,
      status: "PENDING",
      stripePaymentIntentId: paymentIntent.id,
    },
  });

  return { clientSecret: paymentIntent.client_secret, paymentIntentId: paymentIntent.id };
}

export async function handleDepositPaid(paymentIntentId: string): Promise<void> {
  // D3: idempotency — check before processing
  const existing = await prisma.paymentProviderEvent.findUnique({
    where: { eventId: `deposit-${paymentIntentId}` },
  });
  if (existing?.processed) return;

  const deposit = await prisma.deposit.findFirst({ where: { stripePaymentIntentId: paymentIntentId } });
  if (!deposit) return;

  await prisma.deposit.update({ where: { id: deposit.id }, data: { status: "PAID" } });

  // Create and launch auction
  const auction = await prisma.auction.create({
    data: { buyerId: deposit.buyerId, depositId: deposit.id, status: "PENDING" },
  });

  await launchAuction(auction.id);
  await inviteDealersToAuction(auction.id, deposit.buyerId);

  await prisma.notification.create({
    data: {
      buyerId: deposit.buyerId,
      title: "Your auction is live!",
      body: `Your ${DEPOSIT_AMOUNT_USD} deposit was received. Your private auction is now active.`,
      type: "AUCTION_STARTED",
    },
  }).catch(() => {});

  // Mark event processed
  await prisma.paymentProviderEvent.upsert({
    where: { eventId: `deposit-${paymentIntentId}` },
    create: { eventId: `deposit-${paymentIntentId}`, eventType: "deposit_paid", payload: {}, processed: true, processedAt: new Date() },
    update: { processed: true, processedAt: new Date() },
  });
}

// Issues a real Stripe refund for a deposit. POLICY: the $99 Auction Access
// Deposit is never refunded automatically — refunds must be manually requested
// by the buyer and manually processed by an admin. Do NOT call this from any
// cron, webhook, or automated workflow; wire it only behind admin-authenticated
// manual refund actions.
export async function refundDeposit(depositId: string, reason: string): Promise<void> {
  const deposit = await prisma.deposit.findUnique({ where: { id: depositId } });
  if (!deposit?.stripePaymentIntentId) throw new Error("Deposit not found or no payment");
  if (deposit.status === "REFUNDED") return; // Already refunded

  await getStripe().refunds.create({ payment_intent: deposit.stripePaymentIntentId });
  await prisma.deposit.update({ where: { id: depositId }, data: { status: "REFUNDED", refundedAt: new Date() } });
}
