import { NextRequest } from "next/server";
import { getRequestAffiliate, errorResponse } from "@/lib/auth/affiliate-api";

// F-002/F-003 — self-serve payout requests are DISABLED.
//
// The previous implementation created an AffiliatePayout(PENDING) that nothing
// could ever settle and prematurely stamped Commission.paidAt while leaving
// status APPROVED, corrupting balances. Until a real payout processor is
// integrated (Stripe Connect / ACH — F-049), approved commissions are settled
// by AutoLenis directly via the admin per-commission mark-paid rail. Return a
// clear, non-error-y "not available yet" state instead of creating bad data.
export async function POST(request: NextRequest) {
  const affiliate = await getRequestAffiliate(request);
  if (!affiliate) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  return errorResponse(
    "PAYOUTS_UNAVAILABLE",
    "Self-serve payouts aren't available yet. Your approved commissions are tracked and will be paid out by AutoLenis directly — no action needed.",
    503,
  );
}
