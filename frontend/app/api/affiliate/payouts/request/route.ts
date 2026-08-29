import { NextRequest } from "next/server";
import { getRequestAffiliate, successResponse, errorResponse } from "@/lib/auth/affiliate-api";
import { requestPayout, PayoutRequestError, CommissionNotClaimableError } from "@/lib/services/affiliate/affiliate-payout.service";
import { logger } from "@/lib/logger";

// Decision 3 — the rebuilt self-serve payout request rail (replaces the 503
// stub that disabled the corrupting original). One transactional CAS claim in
// the service; typed errors map to specific, actionable client messages.
// Settlement stays admin-gated and recorded-only (no real money movement).
const ERROR_STATUS: Record<PayoutRequestError["code"], number> = {
  NO_PAYOUT_METHOD: 409,
  TAX_REQUIRED: 409,
  REQUEST_PENDING: 409,
  NOTHING_TO_PAY: 409,
  BELOW_MINIMUM: 409,
};

export async function POST(request: NextRequest) {
  const affiliate = await getRequestAffiliate(request);
  if (!affiliate) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  try {
    const result = await requestPayout(affiliate.id);
    return successResponse(
      {
        payoutId: result.payoutId,
        amountCents: result.amountCents,
        commissionCount: result.commissionCount,
        status: "PENDING",
      },
      201,
    );
  } catch (err) {
    if (err instanceof PayoutRequestError) {
      return errorResponse(err.code, err.message, ERROR_STATUS[err.code]);
    }
    if (err instanceof CommissionNotClaimableError) {
      // A concurrent request claimed the same commissions; nothing was written.
      return errorResponse("CONFLICT", "Your balance changed while requesting — please try again.", 409);
    }
    // P2-1 (review) — the DB-enforced one-PENDING-payout-per-affiliate partial
    // unique index (migration 001) rejects the loser of a concurrent
    // double-request with P2002. That is the same condition as REQUEST_PENDING,
    // not a server error.
    if ((err as { code?: string })?.code === "P2002") {
      return errorResponse("REQUEST_PENDING", "You already have a payout request awaiting settlement.", 409);
    }
    logger.error("[affiliate/payouts/request] failed:", err);
    return errorResponse("INTERNAL", "Payout request failed — nothing was created. Please try again.", 500);
  }
}
