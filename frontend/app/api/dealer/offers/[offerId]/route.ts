import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { prisma } from "@/lib/prisma";

interface Props { params: Promise<{ offerId: string }> }

export async function GET(request: NextRequest, { params }: Props) {
  const { offerId } = await params;
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  const offer = await prisma.offer.findFirst({ where: { id: offerId, dealerId: dealer.id }, include: { auction: true } });
  if (!offer) return errorResponse("NOT_FOUND", "Offer not found", 404);
  return successResponse({ offer });
}
