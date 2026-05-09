import { NextRequest } from "next/server";
import { getRequestAffiliate, successResponse, errorResponse } from "@/lib/auth/affiliate-api";
import { prisma } from "@/lib/prisma";

// POST /api/affiliate/notifications/mark-all-read
export async function POST(request: NextRequest) {
  const affiliate = await getRequestAffiliate(request);
  if (!affiliate) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const result = await prisma.notification.updateMany({
    where: { affiliateId: affiliate.id, readAt: null },
    data: { readAt: new Date() },
  });

  return successResponse({ updated: result.count });
}
