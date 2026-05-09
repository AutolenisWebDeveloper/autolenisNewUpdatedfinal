import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { computeProfileCompleteness } from "@/lib/services/buyer/profile-completeness.service";

export async function GET(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  const result = await computeProfileCompleteness(buyer.id);
  return successResponse(result);
}
