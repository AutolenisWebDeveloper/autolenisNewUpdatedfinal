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
  // Guard against duplicate charges: if the concierge fee has already been
  // recorded as paid we must not return a fresh client secret. The PI
  // service is idempotent at Stripe's layer, but this is the user-visible
  // backstop that prevents a "Pay" CTA from appearing post-payment.
  if (deal.feePaidAt) {
    return errorResponse("ALREADY_PAID", "Concierge fee already paid for this deal", 400);
  }
  const { createFeePaymentIntent } = await import("@/lib/services/deal/service-fee.service");
  const { clientSecret } = await createFeePaymentIntent(dealId, buyer.id);
  return successResponse({ clientSecret });
}
