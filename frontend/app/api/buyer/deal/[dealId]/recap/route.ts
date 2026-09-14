// GET  /api/buyer/deal/[dealId]/recap — §Stage 11's consolidated recap.
// POST /api/buyer/deal/[dealId]/recap — decide an optional product, confirm, or dispute.
//
// §11a IS ENFORCED AT CONFIRM, NOT AT RENDER. "An optional product may never first appear in the
// contract" — so the buyer cannot confirm while any product is still undecided, and
// `confirmRecap` refuses rather than defaulting. Defaulting either way is the failure mode:
// defaulting to declined loses a product the buyer wanted, defaulting to accepted charges them for
// one they did not.
//
// THE DEALERSHIP CONFIRMS THROUGH ITS OWN SURFACE. Both confirmations land on the same recap row
// and whichever is second exits the stage.
import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import {
  currentRecap,
  buildRecap,
  decideOptionalProduct,
  confirmRecap,
  disputeRecap,
  allProductsDecided,
  RecapError,
} from "@/lib/services/deal/deal-recap.service";

interface Props { params: Promise<{ dealId: string }> }

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("DECIDE_PRODUCT"),
    productKey: z.string().min(1).max(120),
    accepted: z.boolean(),
  }),
  z.object({ action: z.literal("CONFIRM") }),
  z.object({
    action: z.literal("DISPUTE"),
    reason: z.string().trim().min(10, "Say which figure is wrong so the dealership can correct it."),
  }),
]);

export async function GET(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const deal = await prisma.deal.findFirst({
    where: { id: dealId, buyerId: buyer.id },
    select: {
      id: true,
      status: true,
      vin: true,
      offer: {
        select: {
          vehicleYear: true,
          vehicleMake: true,
          vehicleModel: true,
          vehicleTrim: true,
          odometer: true,
          vehicleCondition: true,
        },
      },
      coBuyer: { select: { legalFirstName: true, legalLastName: true, isRequiredSigner: true } },
      tradeInSubmissions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { year: true, make: true, model: true, mileage: true, condition: true, vin: true },
      },
    },
  });
  if (!deal) return errorResponse("NOT_FOUND", "Deal not found", 404);

  // Build on read where the deal is at RECAP_PENDING and the arrival hook did not land one — a
  // hook failure is repairable and must not leave a buyer on a stage with nothing to confirm.
  let recap = await currentRecap(dealId);
  if (!recap && deal.status === "RECAP_PENDING") {
    recap = await buildRecap({ dealId }).catch(() => null);
  }
  if (!recap) return errorResponse("NO_RECAP", "There is no recap for this deal yet.", 404);

  const reaffirmation = await prisma.dealerReaffirmation.findFirst({
    where: { dealId, status: "CONFIRMED" },
    orderBy: { createdAt: "desc" },
    select: { confirmedVin: true, confirmedOdometer: true, confirmedDeliveryTerms: true },
  });

  return successResponse({
    dealId: deal.id,
    dealStatus: deal.status,
    recap,
    productsAllDecided: allProductsDecided(recap),
    vehicle: {
      ...deal.offer,
      vin: reaffirmation?.confirmedVin ?? deal.vin ?? null,
      odometer: reaffirmation?.confirmedOdometer ?? deal.offer?.odometer ?? null,
    },
    coBuyer: deal.coBuyer,
    trade: deal.tradeInSubmissions[0] ?? null,
    deliveryTerms: reaffirmation?.confirmedDeliveryTerms ?? null,
  });
}

export async function POST(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const owned = await prisma.deal.findFirst({
    where: { id: dealId, buyerId: buyer.id },
    select: { id: true },
  });
  if (!owned) return errorResponse("NOT_FOUND", "Deal not found", 404);

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }

  try {
    if (parsed.data.action === "DECIDE_PRODUCT") {
      const recap = await decideOptionalProduct({
        dealId,
        buyerId: buyer.id,
        productKey: parsed.data.productKey,
        accepted: parsed.data.accepted,
      });
      return successResponse({ dealId, recap, productsAllDecided: allProductsDecided(recap) });
    }
    if (parsed.data.action === "CONFIRM") {
      const result = await confirmRecap({ dealId, actor: "BUYER", actorId: buyer.id });
      return successResponse({ dealId, ...result });
    }
    const result = await disputeRecap({
      dealId,
      actor: "BUYER",
      actorId: buyer.id,
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
