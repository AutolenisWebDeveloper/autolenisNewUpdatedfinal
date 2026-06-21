import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { DEPOSIT_AMOUNT_CENTS, PREMIUM_FEE_REMAINING_CENTS } from "@/lib/constants";

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

  const otdPriceCents = deal.offer?.otdPriceCents ?? 0;
  // deal.feeAmountCents is the NET fee charged (already net of the $99 deposit
  // credit). Gross display = net + deposit credit; nothing is subtracted twice.
  const netFeeCents = deal.feePaidAt ? (deal.feeAmountCents ?? PREMIUM_FEE_REMAINING_CENTS) : 0;
  const wallet = {
    otdPriceCents,
    depositCents: DEPOSIT_AMOUNT_CENTS,
    feeCents: netFeeCents ? netFeeCents + DEPOSIT_AMOUNT_CENTS : 0,
    netFeeCents,
    totalPayableCents: otdPriceCents + netFeeCents,
  };

  return successResponse({ wallet });
}
