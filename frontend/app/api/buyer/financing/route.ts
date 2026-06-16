// POST /api/buyer/financing — save a financing scenario for the buyer's active deal.
// Server-side enforces the OTD cap from prequal (maxOtdAmountCents). The client must
// never supply maxOtdAmountCents — it is read from buyer.preQualification only.

import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { FinancingPath, FinancingStatus } from "@prisma/client";
import { advanceDealStatus, DealTransitionError } from "@/lib/services/deal/deal.service";
import { z } from "zod";

const schema = z.object({
  otdAmountCents: z.number().int().positive(),
  downPaymentCents: z.number().int().nonnegative().default(0),
  termMonths: z.number().int().min(12).max(96),
  aprDecimal: z.number().min(0).max(0.4),
  financingPath: z.enum(["DEALER", "EXTERNAL", "CASH"]),
});

export async function POST(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }
  const { otdAmountCents, downPaymentCents, termMonths, aprDecimal, financingPath } = parsed.data;

  // Read OTD cap from prequal — never trust the client
  const prequal = buyer.preQualification;
  if (!prequal || prequal.expiresAt <= new Date()) {
    return errorResponse("PREQUAL_REQUIRED", "Valid prequalification required before financing", 400);
  }

  if (otdAmountCents > prequal.maxOtdAmountCents) {
    return new Response(
      JSON.stringify({
        error: "BUDGET_EXCEEDED",
        maxOtdAmountCents: prequal.maxOtdAmountCents,
      }),
      { status: 422, headers: { "Content-Type": "application/json" } },
    );
  }

  const deal = await prisma.deal.findFirst({
    where: { buyerId: buyer.id },
    orderBy: { createdAt: "desc" },
  });
  if (!deal) return errorResponse("NOT_FOUND", "No active deal", 404);

  // Compute monthly payment for stored scenario (simple amortization)
  const loanAmountCents = Math.max(0, otdAmountCents - downPaymentCents);
  const monthlyRate = aprDecimal / 12;
  const monthlyPaymentCents = monthlyRate === 0
    ? Math.round(loanAmountCents / termMonths)
    : Math.round(
        (loanAmountCents * monthlyRate * Math.pow(1 + monthlyRate, termMonths)) /
          (Math.pow(1 + monthlyRate, termMonths) - 1),
      );

  await prisma.financing.upsert({
    where: { dealId: deal.id },
    create: {
      dealId: deal.id,
      path: financingPath as FinancingPath,
      aprRate: aprDecimal,
      termMonths,
      approvedAmountCents: otdAmountCents,
      monthlyPaymentCents,
      status: FinancingStatus.SELECTED,
    },
    update: {
      path: financingPath as FinancingPath,
      aprRate: aprDecimal,
      termMonths,
      approvedAmountCents: otdAmountCents,
      monthlyPaymentCents,
      status: FinancingStatus.SELECTED,
    },
  });

  // Advance FINANCING_PENDING → FEE_PENDING through the guarded seam. If the deal
  // is already past financing, persist the choice without regressing the status.
  try {
    await advanceDealStatus(deal.id, "FEE_PENDING", { actorRole: "BUYER", data: { financingPath } });
  } catch (err) {
    if (!(err instanceof DealTransitionError)) throw err;
    await prisma.deal.update({ where: { id: deal.id }, data: { financingPath } });
  }

  return successResponse({
    dealId: deal.id,
    financingPath,
    otdAmountCents,
    downPaymentCents,
    termMonths,
    aprDecimal,
    monthlyPaymentCents,
  });
}
