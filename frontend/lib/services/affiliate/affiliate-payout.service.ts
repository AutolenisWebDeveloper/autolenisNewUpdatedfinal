// lib/services/affiliate/affiliate-payout.service.ts
import { prisma } from "@/lib/prisma";
import { PayoutStatus } from "@prisma/client";

const MINIMUM_PAYOUT_CENTS = 2500; // $25

export async function requestPayout(affiliateId: string) {
  const commissions = await prisma.commission.findMany({
    where: { affiliateId, status: "APPROVED", paidAt: null },
    select: { id: true, amountCents: true, createdAt: true },
  });

  if (commissions.length === 0) {
    throw new Error("No approved commissions available for payout.");
  }

  const amount = commissions.reduce((sum, c) => sum + c.amountCents, 0);
  if (amount < MINIMUM_PAYOUT_CENTS) {
    throw new Error(
      `Minimum payout is $${MINIMUM_PAYOUT_CENTS / 100}. ` +
      `Current eligible balance: $${(amount / 100).toFixed(2)}.`
    );
  }

  const dates = commissions.map(c => c.createdAt.getTime());
  const periodStart = new Date(Math.min(...dates));
  const periodEnd   = new Date(Math.max(...dates));
  const now         = new Date();

  return prisma.$transaction(async (tx) => {
    const payout = await tx.affiliatePayout.create({
      data: {
        affiliateId,
        amountCents: amount,
        status: PayoutStatus.PENDING,
        periodStart,
        periodEnd,
      },
    });

    await tx.commission.updateMany({
      where: { id: { in: commissions.map(c => c.id) } },
      data: { paidAt: now },
    });

    return payout;
  });
}

export async function getPayoutHistory(affiliateId: string) {
  return prisma.affiliatePayout.findMany({ where: { affiliateId }, orderBy: { requestedAt: "desc" } });
}

export async function processPayouts(): Promise<number> {
  // TODO [POST-LAUNCH]: Integrate with payment processor (Stripe Payouts/Gusto/ACH).
  // Until integrated: admin manually marks payouts PAID via
  // POST /api/admin/affiliates/payouts/[payoutId]/mark-paid.
  console.warn("[processPayouts] Payment processor not integrated. Payouts must be settled manually via admin dashboard.");
  return 0;
}
