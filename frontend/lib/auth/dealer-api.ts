import { NextRequest, NextResponse } from "next/server";
import { requireDealerFromRequest } from "@/lib/auth/dealer-session";
import { dealerScope, isOnboardingApiPath } from "@/lib/auth/dealer-scope";

export function successResponse<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

export function errorResponse(code: string, message: string, status = 400) {
  return NextResponse.json(
    { error: { code, message }, correlationId: crypto.randomUUID() },
    { status }
  );
}

// Resolve current dealer from the dealer_token JWT cookie.
// Returns null if not authenticated OR if the dealer's scope does not reach this
// route.
//
// SCOPE BACKSTOP. PENDING dealers are no longer blocked outright (they must be
// able to finish onboarding), so requireDealerFromRequest admits them. proxy.ts
// confines an onboarding-scoped session at the edge, but the edge must not be
// the ONLY gate: every dealer API re-checks here, which is the single helper all
// ~40 dealer routes already call. An onboarding-scoped dealer therefore resolves
// to null on any non-onboarding API and the route returns its normal 401, even
// if the edge is bypassed.
export async function getRequestDealer(request: NextRequest) {
  const dealer = await requireDealerFromRequest(request);
  if (!dealer) return null;

  if (
    dealerScope(dealer) === "ONBOARDING" &&
    !isOnboardingApiPath(request.nextUrl.pathname)
  ) {
    return null;
  }

  return dealer;
}
