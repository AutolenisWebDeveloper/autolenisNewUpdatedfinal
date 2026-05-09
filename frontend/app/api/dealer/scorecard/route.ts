import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { computeDealerScorecard } from "@/lib/services/dealer/dealer-scorecard.service";

// F4 — GET /api/dealer/scorecard
export async function GET(request: NextRequest) {
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const scorecard = await computeDealerScorecard(dealer.id, 90);
  return successResponse(scorecard);
}
