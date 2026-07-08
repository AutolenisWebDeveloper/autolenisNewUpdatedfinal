import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  // Data minimization: return only the anonymized auction fields the leads UI
  // needs. The full auction row exposes internal FKs (buyerId, depositId) that
  // a dealer must never receive — the auction detail route already strips them,
  // and this list route is brought into line with that contract.
  const leads = await prisma.auctionInvitation.findMany({
    where: { dealerId: dealer.id },
    select: {
      id: true,
      auctionId: true,
      sentAt: true,
      auction: {
        select: {
          id: true,
          status: true,
          endsAt: true,
          createdAt: true,
          _count: { select: { offers: true } },
        },
      },
    },
    orderBy: { sentAt: "desc" },
    take: 50,
  });
  return successResponse({ leads });
}
