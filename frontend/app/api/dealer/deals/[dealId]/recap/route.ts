// GET  /api/dealer/deals/[dealId]/recap — §Stage 11's recap, the dealership's half.
// POST /api/dealer/deals/[dealId]/recap — the dealership confirms, or disputes a figure.
//
// §Stage 11: "One consolidated recap is presented to BOTH buyer and dealership ... Buyer confirms.
// Dealership confirms." Both confirmations land on the same `deal_recaps` row and whichever is
// second exits the stage, so this route and the buyer's are two doors into one record rather than
// two records that have to be reconciled.
//
// WHAT A DEALERSHIP SEES HERE IS GATED BY §25.1. The recap carries the buyer's and co-buyer's
// names — §Stage 11's first line — and those are released only through the identity-firewall
// predicate. A dealership that has not reaffirmed cannot reach this stage at all (the deal is
// still at DEALER_CONFIRMATION), but the gate is applied rather than assumed: a `force`d admin
// transition could put a deal here without a confirmation behind it, and the recap must not be the
// surface that then leaks the buyer.
import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import {
  currentRecap,
  confirmRecap,
  disputeRecap,
  RecapError,
} from "@/lib/services/deal/deal-recap.service";
import { dealerIdentityVisible } from "@/lib/services/deal/identity-firewall.service";

interface Props { params: Promise<{ dealId: string }> }

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CONFIRM") }),
  z.object({
    action: z.literal("DISPUTE"),
    reason: z.string().trim().min(10, "Say which figure is wrong so it can be corrected."),
  }),
]);

/** Ownership through the offer, or through §13-D20's claimed-dealer lineage. 404 on a mismatch. */
async function ownedDeal(dealId: string, dealerId: string) {
  return prisma.deal.findFirst({
    where: { id: dealId, OR: [{ offer: { dealerId } }, { dealerId } ] },
    select: {
      id: true,
      status: true,
      buyer: { select: { firstName: true, lastName: true } },
      coBuyer: { select: { legalFirstName: true, legalLastName: true, isRequiredSigner: true } },
    },
  });
}

export async function GET(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const deal = await ownedDeal(dealId, dealer.id);
  if (!deal) return errorResponse("NOT_FOUND", "Deal not found", 404);

  const recap = await currentRecap(dealId);
  if (!recap) return errorResponse("NO_RECAP", "There is no recap for this deal yet.", 404);

  // §25.1 — names only once the firewall is open. Withheld reads as null rather than as an empty
  // string, so a surface rendering it shows nothing instead of a blank where a name should be.
  const firewall = await dealerIdentityVisible(dealId, dealer.id);
  const parties = firewall.visible
    ? {
        buyer: deal.buyer ? `${deal.buyer.firstName} ${deal.buyer.lastName}` : null,
        coBuyer: deal.coBuyer
          ? {
              name: [deal.coBuyer.legalFirstName, deal.coBuyer.legalLastName].filter(Boolean).join(" ") || null,
              isRequiredSigner: deal.coBuyer.isRequiredSigner,
            }
          : null,
      }
    : { buyer: null, coBuyer: null, withheldReason: firewall.reason };

  return successResponse({ dealId: deal.id, dealStatus: deal.status, recap, parties });
}

export async function POST(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const deal = await ownedDeal(dealId, dealer.id);
  if (!deal) return errorResponse("NOT_FOUND", "Deal not found", 404);

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }

  try {
    if (parsed.data.action === "CONFIRM") {
      const result = await confirmRecap({ dealId, actor: "DEALER", actorId: dealer.id });
      return successResponse({ dealId, ...result });
    }
    const result = await disputeRecap({
      dealId,
      actor: "DEALER",
      actorId: dealer.id,
      reason: parsed.data.reason,
    });
    return successResponse({ dealId, ...result });
  } catch (err) {
    if (err instanceof RecapError) {
      return errorResponse(err.code, err.message, err.code === "NOT_FOUND" ? 404 : 409);
    }
    throw err;
  }
}
