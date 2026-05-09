import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { interpretSearchQuery, filtersToSearchParams } from "@/lib/services/ai/search-interpreter";
import { isAiEnabled } from "@/lib/ai/kill-switch";

// POST /api/buyer/search/interpret — System 2 ENH Natural Language Search
// Groq ONLY — returns null gracefully when AI unavailable
export async function POST(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const { query } = await request.json() as { query: string };
  if (!query?.trim()) return errorResponse("VALIDATION_ERROR", "query is required", 400);

  // Check kill switch
  if (!isAiEnabled()) {
    return successResponse({ interpretation: query, params: { q: query }, confidence: "low", aiUsed: false });
  }

  const filters = await interpretSearchQuery(query);
  if (!filters) {
    // Graceful fallback — plain text search
    return successResponse({ interpretation: query, params: { q: query }, confidence: "low", aiUsed: false });
  }

  // Convert filters to API params
  const params: Record<string, string> = {};
  if (filters.make) params.make = filters.make;
  if (filters.model) params.model = filters.model;
  if (filters.yearMin) params.yearMin = filters.yearMin.toString();
  if (filters.yearMax) params.yearMax = filters.yearMax.toString();
  if (filters.maxPriceDollars) params.maxPrice = Math.round(filters.maxPriceDollars * 100).toString();
  if (filters.mileageMax) params.mileageMax = filters.mileageMax.toString();

  return successResponse({
    interpretation: filters.interpretation,
    params,
    confidence: filters.confidence,
    aiUsed: true,
  });
}
