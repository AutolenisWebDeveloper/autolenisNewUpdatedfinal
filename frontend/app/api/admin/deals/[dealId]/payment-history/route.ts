// GET /api/admin/deals/[dealId]/payment-history
// Returns all financial events scoped to a specific deal:
// deposit (linked via auction), concierge fee, refunds — with amounts, timestamps, Stripe IDs.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";

interface Props { params: Promise<{ dealId: string }> }

export async function GET(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      offer: { include: { auction: { include: { deposit: true } } } },
    },
  });
  if (!deal) return adminError("NOT_FOUND", "Deal not found", 404);

  const deposit = deal.offer?.auction?.deposit ?? null;
  const events = [];

  if (deposit) {
    events.push({
      type: "deposit",
      id: deposit.id,
      amountCents: deposit.amountCents,
      status: deposit.status,
      stripeIntentId: deposit.stripePaymentIntentId ?? null,
      refundedAt: deposit.refundedAt ?? null,
      timestamp: deposit.createdAt.toISOString(),
    });
  }

  if (deal.feeAmountCents) {
    events.push({
      type: "concierge_fee",
      id: `fee-${deal.id}`,
      dealId: deal.id,
      amountCents: deal.feeAmountCents,
      status: deal.feePaidAt ? "PAID" : "PENDING",
      stripeIntentId: deal.stripeFeePIId ?? null,
      paidAt: deal.feePaidAt ?? null,
      timestamp: (deal.feePaidAt ?? deal.createdAt).toISOString(),
    });
  }

  return adminSuccess({
    dealId,
    events,
    totalCount: events.length,
    totalCharged: events.reduce((s, e) => s + (e.status !== "REFUNDED" ? e.amountCents : 0), 0),
    totalRefunded: events
      .filter(e => e.status === "REFUNDED")
      .reduce((s, e) => s + e.amountCents, 0),
  });
}
