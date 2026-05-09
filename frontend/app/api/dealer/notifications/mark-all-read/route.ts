// POST /api/dealer/notifications/mark-all-read — bulk mark all unread for this dealer.
import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const result = await prisma.notification.updateMany({
    where: { dealerId: dealer.id, readAt: null },
    data: { readAt: new Date() },
  });

  return successResponse({ markedRead: result.count, unreadCount: 0 });
}
