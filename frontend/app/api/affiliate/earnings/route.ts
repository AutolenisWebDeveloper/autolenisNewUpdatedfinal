import { NextRequest } from "next/server";
import { getRequestAffiliate, successResponse, errorResponse } from "@/lib/auth/affiliate-api";
import { getCommissionSummary } from "@/lib/services/affiliate/commission.service";

export async function GET(request: NextRequest) {
  const affiliate = await getRequestAffiliate(request);
  if (!affiliate) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  const summary = await getCommissionSummary(affiliate.id);
  return successResponse({ summary });
}
