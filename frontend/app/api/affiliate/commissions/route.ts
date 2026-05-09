import { NextRequest } from "next/server";
import { getRequestAffiliate, successResponse, errorResponse } from "@/lib/auth/affiliate-api";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const affiliate = await getRequestAffiliate(request);
  if (!affiliate) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  const commissions = await prisma.commission.findMany({ where: { affiliateId: affiliate.id }, orderBy: { createdAt: "desc" }, take: 50 });
  return successResponse({ commissions });
}
