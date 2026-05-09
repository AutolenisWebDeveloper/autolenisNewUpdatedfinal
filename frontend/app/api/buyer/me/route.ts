// GET /api/buyer/me — lightweight session-validity probe.
// Returns 401 when the buyer session is invalid/expired so the SessionExpiryWatcher
// can flip the modal. Returns minimal identity payload otherwise (no PII beyond
// what the buyer already sees in their own UI).

import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  return successResponse({
    id: buyer.id,
    firstName: buyer.firstName,
    lastName: buyer.lastName,
    email: buyer.user.email,
    plan: buyer.plan,
    onboardingComplete: buyer.onboardingComplete,
  });
}
