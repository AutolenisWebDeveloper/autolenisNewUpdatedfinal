// PATCH /api/buyer/deal/financing — the buyer records their financing PATH. Nothing else.
// GET   /api/buyer/deal/financing — what the buyer's financing screen renders.
//
// PHASE 7 CLOSED A SELF-ADVANCE HERE, and it is worth stating what it was.
//
// Before this phase the PATCH handler did:
//
//     const deal = await prisma.deal.findFirst({ where: { buyerId: buyer.id }, orderBy: { createdAt: "desc" } });
//     await advanceDealStatus(deal.id, "FEE_PENDING", { actorRole: "BUYER", data: { financingPath } });
//
// — three defects in five lines. A BUYER advanced their own deal past the financing stage with NO
// financing record of any kind, no evidence, and no verifier; the deal was chosen by `findFirst`
// on `buyerId` with no `dealId`, so with two deals open it acted on whichever was newest; and the
// `DealTransitionError` from an illegal hop was caught and the path written anyway, so the failure
// was invisible.
//
// §12c is explicit: "The buyer can never mark financing completed. Only an authorized Finance or
// Operations administrator records completion, and only against external dealership or lender
// evidence." That is a rule about WHO THE VERIFIER IS, not about one status — a buyer who can
// advance past the checkpoint has satisfied it themselves whatever the status column says.
//
// So: the buyer's action records the path and `IN_PROGRESS` (or `NOT_REQUIRED_CASH` for cash,
// which §12d settles at this stage), through the single writer. It advances nothing. The deal
// leaves Stage 12 when Finance or Operations locks the terms against evidence.
import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { FinancingPath } from "@prisma/client";
import { z } from "zod";
import { PREMIUM_FEE_CENTS } from "@/lib/constants";
import {
  recordBuyerFinancingPath,
  FinancingCheckpointError,
} from "@/lib/services/financing/financing-checkpoint.service";

const schema = z.object({
  financingPath: z.enum(["DEALER", "EXTERNAL", "CASH"]),
  /**
   * REQUIRED where the buyer has more than one live deal. The old handler's `findFirst` on
   * `buyerId` alone is the defect this closes: a buyer with two deals had their path written to
   * whichever was newest, which is not necessarily the one on screen.
   */
  dealId: z.string().min(1).optional(),
});

export async function PATCH(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }

  const deal = await resolveTargetDeal(buyer.id, parsed.data.dealId);
  if (deal.error) return deal.error;

  try {
    const result = await recordBuyerFinancingPath({
      dealId: deal.id,
      buyerId: buyer.id,
      path: parsed.data.financingPath as FinancingPath,
    });
    return successResponse({
      deal: { id: deal.id, financingPath: parsed.data.financingPath, status: deal.status },
      financing: { status: result.status },
    });
  } catch (err) {
    if (err instanceof FinancingCheckpointError) {
      return errorResponse(err.code, err.message, 409);
    }
    throw err;
  }
}

export async function GET(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const { searchParams } = new URL(request.url);
  const deal = await resolveTargetDeal(buyer.id, searchParams.get("dealId") ?? undefined);
  if (deal.error) return deal.error;

  const full = await prisma.deal.findUnique({
    where: { id: deal.id },
    select: {
      id: true,
      status: true,
      financingPath: true,
      otdCentsConfirmed: true,
      financingTermsLockedAt: true,
      offer: { select: { otdPriceCents: true, aprRate: true, termMonths: true } },
      financing: {
        select: {
          status: true,
          path: true,
          lenderName: true,
          approvedAmountCents: true,
          aprRate: true,
          termMonths: true,
          monthlyPaymentCents: true,
          expiresAt: true,
          failureReason: true,
        },
      },
    },
  });
  if (!full) return errorResponse("NOT_FOUND", "No active deal", 404);

  return successResponse({
    dealId: full.id,
    status: full.status,
    financingPath: full.financingPath,
    // The CONFIRMED out-the-door where Stage 10 produced one; the offer's otherwise.
    otdPriceCents: full.otdCentsConfirmed ?? full.offer?.otdPriceCents ?? 0,
    // maxOtdAmountCents is READ-ONLY from prequal — never accepted from the client.
    maxOtdAmountCents: buyer.preQualification?.maxOtdAmountCents,
    feeCents: PREMIUM_FEE_CENTS,
    termsLockedAt: full.financingTermsLockedAt,
    financing: full.financing,
  });
}

/**
 * Resolve WHICH deal this request is about.
 *
 * Explicit `dealId` wins and is scoped to the buyer. Without one, a buyer with exactly one live
 * deal gets it; a buyer with several is asked which, rather than having the newest chosen for
 * them. Answering "which one?" is better than acting on the wrong deal and saying nothing.
 */
async function resolveTargetDeal(
  buyerId: string,
  dealId?: string,
): Promise<{ id: string; status: string; error?: undefined } | { id: never; status: never; error: Response }> {
  const LIVE = ["DEALER_CONFIRMATION", "RECAP_PENDING", "FINANCING_PENDING", "FEE_PENDING"] as const;

  if (dealId) {
    const deal = await prisma.deal.findFirst({
      where: { id: dealId, buyerId },
      select: { id: true, status: true },
    });
    if (!deal) {
      return { error: errorResponse("NOT_FOUND", "No active deal", 404) } as never;
    }
    return { id: deal.id, status: deal.status };
  }

  const live = await prisma.deal.findMany({
    where: { buyerId, status: { in: [...LIVE] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true },
    take: 5,
  });
  if (live.length === 0) {
    return { error: errorResponse("NOT_FOUND", "No active deal", 404) } as never;
  }
  if (live.length > 1) {
    return {
      error: errorResponse(
        "DEAL_AMBIGUOUS",
        "You have more than one deal in progress. Tell us which one by passing dealId.",
        409,
      ),
    } as never;
  }
  return { id: live[0]!.id, status: live[0]!.status };
}
