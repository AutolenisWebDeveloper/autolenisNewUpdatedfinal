import { NextRequest } from "next/server";
import { getRequestAffiliate, successResponse, errorResponse } from "@/lib/auth/affiliate-api";
import { prisma } from "@/lib/prisma";

// GET /api/affiliate/notifications/unread-count
// Returns the affiliate's unread notification count for the sidebar badge.
export async function GET(request: NextRequest) {
  const affiliate = await getRequestAffiliate(request);
  if (!affiliate) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const count = await prisma.notification.count({
    where: { affiliateId: affiliate.id, readAt: null },
  });

  return successResponse({ count });
}
