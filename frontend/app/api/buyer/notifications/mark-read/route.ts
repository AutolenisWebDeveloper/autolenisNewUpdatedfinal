import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { markAllRead, getUnreadCount } from "@/lib/services/notifications/notification.service";

export async function POST(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  const count = await markAllRead(buyer.id);
  return successResponse({ marked: count });
}
