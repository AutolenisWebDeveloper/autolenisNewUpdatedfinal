// POST /api/buyer/insurance — legacy stub
// The active insurance quote request flow is now at /api/buyer/insurance/request-quote
// This route is kept for backward compatibility
import { NextRequest } from "next/server";
import { getRequestBuyer, errorResponse } from "@/lib/auth/api";

export async function POST(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  return errorResponse(
    "USE_NEW_ENDPOINT",
    "Insurance quote requests are now handled at POST /api/buyer/insurance/request-quote",
    410,
  );
}
