import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { getBuyerActivity } from "@/lib/services/activity/activity.service";

export async function GET(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  const events = await getBuyerActivity(buyer.id, 100);
  return successResponse({ events });
}
