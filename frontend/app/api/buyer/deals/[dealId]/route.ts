import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { getDealForBuyer } from "@/lib/services/deal/deal.service";

interface Props { params: Promise<{ dealId: string }> }

export async function GET(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  const deal = await getDealForBuyer(buyer.id, dealId);
  if (!deal) return errorResponse("NOT_FOUND", "Deal not found", 404);
  return successResponse({ deal });
}
