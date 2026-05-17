import { NextRequest, NextResponse } from "next/server";
import { requireDealerFromRequest } from "@/lib/auth/dealer-session";

export function successResponse<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

export function errorResponse(code: string, message: string, status = 400, debug?: Record<string, unknown>) {
  return NextResponse.json(
    { error: { code, message, ...(debug ? { debug } : {}) }, correlationId: crypto.randomUUID() },
    { status }
  );
}

// Resolve current dealer from the dealer_token JWT cookie.
// Returns null if not authenticated.
export async function getRequestDealer(request: NextRequest) {
  return requireDealerFromRequest(request);
}
