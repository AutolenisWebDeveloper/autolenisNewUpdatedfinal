import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";

interface Props { params: Promise<{ dealId: string }> }

export async function POST(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  const deal = await prisma.deal.findFirst({ where: { id: dealId, buyerId: buyer.id } });
  if (!deal) return errorResponse("NOT_FOUND", "Deal not found", 404);
  const { createFeePaymentIntent } = await import("@/lib/services/deal/service-fee.service");
  const { clientSecret } = await createFeePaymentIntent(dealId, buyer.id);
  return successResponse({ clientSecret });
}
