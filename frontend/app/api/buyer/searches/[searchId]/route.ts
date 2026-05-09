import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";

interface Props { params: Promise<{ searchId: string }> }

export async function DELETE(request: NextRequest, { params }: Props) {
  const { searchId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  await prisma.savedSearch.deleteMany({ where: { id: searchId, buyerId: buyer.id } });
  return successResponse({ deleted: true });
}
