// GET /api/admin/payments/fee-check
// Returns the fee structure for a buyer based on their plan.
// Standard plan: $0 concierge fee. Premium plan: PREMIUM_FEE_CENTS total / PREMIUM_FEE_REMAINING_CENTS due after deposit credit.
// Amount is ALWAYS from lib/constants.ts — NEVER from client input.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import {
  DEPOSIT_AMOUNT_CENTS,
  DEPOSIT_AMOUNT_USD,
  PREMIUM_FEE_CENTS,
  PREMIUM_FEE_USD,
  PREMIUM_FEE_REMAINING_CENTS,
  PREMIUM_FEE_REMAINING_USD,
  STANDARD_FEE_CENTS,
} from "@/lib/constants";

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { searchParams } = new URL(request.url);
  const buyerId = searchParams.get("buyerId");
  if (!buyerId) return adminError("VALIDATION_ERROR", "buyerId query param is required", 400);

  const buyer = await prisma.buyer.findUnique({
    where: { id: buyerId },
    select: { id: true, plan: true, firstName: true, lastName: true },
  });
  if (!buyer) return adminError("NOT_FOUND", "Buyer not found", 404);

  const isStandard = buyer.plan === "STANDARD";

  return adminSuccess({
    buyerId,
    planType: buyer.plan,
    feeAmount: isStandard ? STANDARD_FEE_CENTS : PREMIUM_FEE_REMAINING_CENTS,
    totalFeeAmount: isStandard ? STANDARD_FEE_CENTS : PREMIUM_FEE_CENTS,
    depositCredit: isStandard ? 0 : DEPOSIT_AMOUNT_CENTS,
    displayMessage: isStandard
      ? "Standard plan: no concierge fee"
      : `${PREMIUM_FEE_USD} total — ${DEPOSIT_AMOUNT_USD} deposit credited = ${PREMIUM_FEE_REMAINING_USD} due`,
    requiresPayment: !isStandard,
  });
}
