import { NextRequest } from "next/server";
import { getRequestAffiliate, successResponse, errorResponse } from "@/lib/auth/affiliate-api";
import { getPayoutHistory } from "@/lib/services/affiliate/affiliate-payout.service";

export async function GET(request: NextRequest) {
  const affiliate = await getRequestAffiliate(request);
  if (!affiliate) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  // D15 — bounded page; pass ?cursor=<payoutId> for the next page.
  const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
  const payouts = await getPayoutHistory(affiliate.id, { take: 50, cursor });
  const nextCursor = payouts.length === 50 ? payouts[payouts.length - 1].id : null;
  return successResponse({ payouts, nextCursor });
}
