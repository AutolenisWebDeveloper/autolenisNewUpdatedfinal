import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { PREMIUM_FEE_CENTS } from "@/lib/constants";
import { advanceDealStatus, DealTransitionError } from "@/lib/services/deal/deal.service";

// PATCH /api/buyer/deal/financing — save financing path choice
export async function PATCH(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const { financingPath } = await request.json() as { financingPath: string };
  const validPaths = ["DEALER", "EXTERNAL", "CASH"];
  if (!validPaths.includes(financingPath)) return errorResponse("VALIDATION_ERROR", "Invalid financing path", 400);

  const deal = await prisma.deal.findFirst({ where: { buyerId: buyer.id }, orderBy: { createdAt: "desc" } });
  if (!deal) return errorResponse("NOT_FOUND", "No active deal", 404);

  // Advance FINANCING_PENDING → FEE_PENDING through the guarded seam. If the deal
  // is already past financing, persist the choice without regressing the status.
  let status = deal.status;
  try {
    await advanceDealStatus(deal.id, "FEE_PENDING", { actorRole: "BUYER", data: { financingPath } });
    status = "FEE_PENDING";
  } catch (err) {
    if (!(err instanceof DealTransitionError)) throw err;
    await prisma.deal.update({ where: { id: deal.id }, data: { financingPath } });
  }

  return successResponse({ deal: { id: deal.id, financingPath, status } });
}

// GET /api/buyer/deal/financing
export async function GET(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const deal = await prisma.deal.findFirst({
    where: { buyerId: buyer.id },
    include: { offer: { select: { otdPriceCents: true, aprRate: true, termMonths: true } } },
    orderBy: { createdAt: "desc" },
  });
  if (!deal) return errorResponse("NOT_FOUND", "No active deal", 404);

  return successResponse({
    dealId: deal.id,
    financingPath: deal.financingPath,
    otdPriceCents: deal.offer?.otdPriceCents ?? 0,
    // maxOtdAmountCents is READ-ONLY from prequal — never accept from client
    maxOtdAmountCents: buyer.preQualification?.maxOtdAmountCents,
    feeCents: PREMIUM_FEE_CENTS,
  });
}
