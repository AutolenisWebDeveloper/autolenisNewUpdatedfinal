import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  const leads = await prisma.auctionInvitation.findMany({
    where: { dealerId: dealer.id },
    include: { auction: { include: { _count: { select: { offers: true } } } } },
    orderBy: { sentAt: "desc" },
    take: 50,
  });
  return successResponse({ leads });
}
