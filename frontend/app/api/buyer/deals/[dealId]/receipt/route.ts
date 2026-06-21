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
    where: { id: dealId, buyerId: buyer.id, status: "COMPLETED" },
    include: { offer: { include: { dealer: { select: { dealershipName: true, city: true, state: true } } } } },
  });
  if (!deal) return errorResponse("NOT_FOUND", "Completed deal not found", 404);

  return successResponse({
    receipt: {
      dealId, dealerName: deal.offer?.dealer?.dealershipName ?? "AutoLenis Concierge",
      otdPriceCents: deal.offer?.otdPriceCents ?? 0,
      // feeCents is GROSS for the "fee − deposit credit = net" receipt layout;
      // deal.feeAmountCents stores the NET charge, so add back the credit.
      feeCents: (deal.feeAmountCents ?? PREMIUM_FEE_REMAINING_CENTS) + DEPOSIT_AMOUNT_CENTS,
      depositCredit: DEPOSIT_AMOUNT_CENTS, completedAt: deal.updatedAt,
    },
  });
}
