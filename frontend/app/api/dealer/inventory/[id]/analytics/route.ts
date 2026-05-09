import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { prisma } from "@/lib/prisma";

interface Props { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  const item = await prisma.inventoryItem.findFirst({ where: { id, dealerId: dealer.id } });
  if (!item) return errorResponse("NOT_FOUND", "Not found", 404);
  // Inventory analytics
  const analytics = { views: 0, shortlistAdds: 0, auctionRate: 0, qualityScore: null }; // ENH-data from quality service
  return successResponse({ analytics, inventoryId: id });
}
