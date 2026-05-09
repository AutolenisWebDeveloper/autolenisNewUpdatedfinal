import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";

interface Props { params: Promise<{ itemId: string }> }

export async function DELETE(request: NextRequest, { params }: Props) {
  const { itemId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  const shortlist = await prisma.shortlist.findUnique({ where: { buyerId: buyer.id } });
  if (!shortlist) return errorResponse("NOT_FOUND", "Shortlist not found", 404);
  await prisma.shortlistItem.deleteMany({ where: { id: itemId, shortlistId: shortlist.id } });
  return successResponse({ removed: true });
}
