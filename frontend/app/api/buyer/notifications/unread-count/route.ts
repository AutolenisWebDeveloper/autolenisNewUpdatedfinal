import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { getUnreadCount } from "@/lib/services/notifications/notification.service";

export async function GET(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  const count = await getUnreadCount(buyer.id);
  return successResponse({ count });
}
