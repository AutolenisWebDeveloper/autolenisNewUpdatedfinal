// GET /api/admin/buyers/[buyerId]/payment-history
// Returns all financial events for a buyer:
// deposits, concierge fees, refunds — with amount, timestamp, Stripe ID, status.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";

interface Props { params: Promise<{ buyerId: string }> }

export async function GET(request: NextRequest, { params }: Props) {
  const { buyerId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId } });
  if (!buyer) return adminError("NOT_FOUND", "Buyer not found", 404);

  const [deposits, deals] = await Promise.all([
    prisma.deposit.findMany({
      where: { buyerId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.deal.findMany({
      where: { buyerId },
      select: {
        id: true,
        status: true,
        feeAmountCents: true,
        feePaidAt: true,
        stripeFeePIId: true,
        createdAt: true,
        offer: { select: { otdPriceCents: true, dealerId: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const events = [
    ...deposits.map(d => ({
      type: "deposit",
      id: d.id,
      amountCents: d.amountCents,
      status: d.status,
      stripeIntentId: d.stripePaymentIntentId ?? null,
      refundedAt: d.refundedAt ?? null,
      timestamp: d.createdAt.toISOString(),
    })),
    ...deals.flatMap(d => {
      const events = [];
      if (d.feeAmountCents) {
        events.push({
          type: "concierge_fee",
          id: `fee-${d.id}`,
          dealId: d.id,
          amountCents: d.feeAmountCents,
          status: d.feePaidAt ? "PAID" : "PENDING",
          stripeIntentId: d.stripeFeePIId ?? null,
          timestamp: (d.feePaidAt ?? d.createdAt).toISOString(),
        });
      }
      return events;
    }),
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return adminSuccess({ buyerId, events, totalCount: events.length });
}
