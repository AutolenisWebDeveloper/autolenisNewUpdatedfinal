import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { DEPOSIT_AMOUNT_CENTS, PREMIUM_FEE_CENTS } from "@/lib/constants";

interface Props { params: Promise<{ dealId: string }> }

export async function GET(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const deal = await prisma.deal.findFirst({
    where: { id: dealId, buyerId: buyer.id },
    include: { offer: { select: { otdPriceCents: true, vehiclePriceCents: true, taxCents: true, feesCents: true } } },
  });
  if (!deal) return errorResponse("NOT_FOUND", "Deal not found", 404);

  const wallet = {
    otdPriceCents: deal.offer.otdPriceCents,
    depositCents: DEPOSIT_AMOUNT_CENTS,
    feeCents: deal.feePaidAt ? (deal.feeAmountCents ?? PREMIUM_FEE_CENTS) : 0,
    netFeeCents: deal.feePaidAt ? (deal.feeAmountCents ?? PREMIUM_FEE_CENTS) - DEPOSIT_AMOUNT_CENTS : 0,
    totalPayableCents: deal.offer.otdPriceCents + (deal.feePaidAt ? (deal.feeAmountCents ?? PREMIUM_FEE_CENTS) - DEPOSIT_AMOUNT_CENTS : 0),
  };

  return successResponse({ wallet });
}
