import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { prisma } from "@/lib/prisma";

// GET /api/dealer/notifications/unread-count
// Returns the dealer's unread notification count.
// Lightweight — safe to poll from client components for badge updates.
export async function GET(request: NextRequest) {
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const count = await prisma.notification.count({
    where: { dealerId: dealer.id, readAt: null },
  });

  return successResponse({ count });
}
