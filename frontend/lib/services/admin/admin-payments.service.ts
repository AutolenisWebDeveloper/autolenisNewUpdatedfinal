// lib/services/admin/admin-payments.service.ts
// Server-side data fetching for the admin payments page.
// Returns structured rows for deposits and concierge fees.

import { prisma } from "@/lib/prisma";

export interface DepositRow {
  depositId: string;
  buyerId: string;
  buyerName: string;
  buyerEmail: string;
  amountCents: number;
  status: string;
  createdAt: string;
  stripePaymentIntentId: string | null;
}

export interface ConciergeFeeRow {
  dealId: string;
  buyerId: string;
  buyerName: string;
  buyerEmail: string;
  amountCents: number;
  feePaidAt: string | null;
  feeStatus: "PENDING" | "PAID" | "REFUNDED";
  stripeFeePIId: string | null;
}

export async function getAdminDepositList(): Promise<DepositRow[]> {
  const deposits = await prisma.deposit.findMany({
    include: { buyer: { include: { user: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return deposits.map((d) => ({
    depositId: d.id,
    buyerId: d.buyerId,
    buyerName: `${d.buyer.firstName} ${d.buyer.lastName}`,
    buyerEmail: d.buyer.user.email,
    amountCents: d.amountCents,
    status: d.status,
    createdAt: d.createdAt.toISOString(),
    stripePaymentIntentId: d.stripePaymentIntentId ?? null,
  }));
}

export async function getAdminConciergeFeeList(): Promise<ConciergeFeeRow[]> {
  const deals = await prisma.deal.findMany({
    where: { buyer: { plan: "PREMIUM" } },
    include: { buyer: { include: { user: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return deals.map((d) => {
    let feeStatus: "PENDING" | "PAID" | "REFUNDED" = "PENDING";
    if (d.feeRefundedAt) feeStatus = "REFUNDED";
    else if (d.feePaidAt) feeStatus = "PAID";

    return {
      dealId: d.id,
      buyerId: d.buyerId,
      buyerName: `${d.buyer.firstName} ${d.buyer.lastName}`,
      buyerEmail: d.buyer.user.email,
      amountCents: d.feeAmountCents ?? 40000,
      feePaidAt: d.feePaidAt?.toISOString() ?? null,
      feeStatus,
      stripeFeePIId: d.stripeFeePIId ?? null,
    };
  });
}
