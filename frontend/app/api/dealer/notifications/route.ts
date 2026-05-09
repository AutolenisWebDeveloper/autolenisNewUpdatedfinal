import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { prisma } from "@/lib/prisma";

// F13 — GET /api/dealer/notifications
export async function GET(request: NextRequest) {
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const notifications = await prisma.notification.findMany({
    where: { dealerId: dealer.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const unreadCount = await prisma.notification.count({ where: { dealerId: dealer.id, readAt: null } });
  return successResponse({ notifications, unreadCount });
}
