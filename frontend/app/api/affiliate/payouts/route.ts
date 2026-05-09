import { NextRequest } from "next/server";
import { getRequestAffiliate, successResponse, errorResponse } from "@/lib/auth/affiliate-api";
import { getPayoutHistory } from "@/lib/services/affiliate/affiliate-payout.service";

export async function GET(request: NextRequest) {
  const affiliate = await getRequestAffiliate(request);
  if (!affiliate) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  const payouts = await getPayoutHistory(affiliate.id);
  return successResponse({ payouts });
}
