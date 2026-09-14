// POST /api/dealer/deals/[dealId]/reaffirm — §Stage 10, the winning dealership's answer.
// GET  /api/dealer/deals/[dealId]/reaffirm — what the dealership must confirm, and the deadline.
//
// AUTHORIZATION IS OWNERSHIP, RESOLVED THROUGH THE OFFER, exactly as every other dealer deal route
// does it: the deal is reachable only through `offer.dealerId === dealer.id` (or `Deal.dealerId`
// once §13-D20's outside-winner claim has set it), so a mismatched id returns 404 and never
// another dealership's deal. `submitReaffirmation` re-checks ownership itself rather than trusting
// this route — the service is callable from a cron and an admin repair too, and a gate that lives
// only at one caller is a gate one caller has.
//
// NOTHING HERE RELEASES BUYER IDENTITY. The GET returns the vehicle, the figures and the deadline.
// §25.1's release happens at CONFIRMATION, through `secureHandoffPacket`, on the dealer deal page
// — not in the payload a dealership reads while deciding whether to confirm.
import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import {
  submitReaffirmation,
  ReaffirmationError,
  REAFFIRMATION_WINDOW_HOURS,
} from "@/lib/services/deal/dealer-reaffirmation.service";

interface Props { params: Promise<{ dealId: string }> }

const lineItem = z.object({
  label: z.string().min(1).max(120),
  amountCents: z.number().int().nullable(),
});

const schema = z.object({
  // §Stage 10's confirmation list, in the order the document states it.
  vehicleAvailable: z.boolean(),
  confirmedVin: z.string().trim().min(11).max(17),
  confirmedOdometer: z.number().int().nonnegative().max(1_000_000),
  confirmedOtdCents: z.number().int().positive(),
  confirmedFeeItems: z.array(lineItem).max(50).default([]),
  confirmedIncentiveItems: z.array(lineItem).max(50).default([]),
  confirmedAddOnItems: z.array(lineItem).max(50).default([]),
  confirmedDeliveryTerms: z.string().max(500).nullable().default(null),
  outOfStateHandling: z.string().max(500).nullable().default(null),
  canProceed: z.boolean(),
  tradeSubjectToAppraisalAck: z.boolean(),
  /** §10c — the hold-until date and time. Required: a confirmation with no hold is not one. */
  holdUntil: z.coerce.date(),
  /** Condition report, history report, current photographs. */
  disclosureArtifactUrls: z.array(z.string().url()).max(30).default([]),
  aprRate: z.number().min(0).max(100).nullable().optional(),
  termMonths: z.number().int().min(1).max(120).nullable().optional(),
  monthlyPaymentCents: z.number().int().nonnegative().nullable().optional(),
  deliveryDate: z.coerce.date().nullable().optional(),
  vehicleYear: z.number().int().min(1900).max(2100).nullable().optional(),
  vehicleTrim: z.string().max(120).nullable().optional(),
  vehicleCondition: z.string().max(120).nullable().optional(),
  drivetrain: z.string().max(60).nullable().optional(),
  requiredFeatures: z.array(z.string().max(120)).max(50).optional(),
});

export async function GET(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const deal = await prisma.deal.findFirst({
    where: { id: dealId, OR: [{ offer: { dealerId: dealer.id } }, { dealerId: dealer.id }] },
    select: {
      id: true,
      status: true,
      vehicleHoldUntil: true,
      offer: {
        select: {
          otdPriceCents: true,
          vin: true,
          odometer: true,
          vehicleYear: true,
          vehicleMake: true,
          vehicleModel: true,
          vehicleTrim: true,
          aprRate: true,
          termMonths: true,
          deliveryTerms: true,
        },
      },
    },
  });
  if (!deal) return errorResponse("NOT_FOUND", "Deal not found", 404);

  const reaffirmation = await prisma.dealerReaffirmation.findFirst({
    where: { dealId },
    orderBy: { createdAt: "desc" },
    select: { status: true, dueAt: true, holdUntil: true, materialChangeProposal: true, decidedAt: true },
  });

  return successResponse({
    dealId: deal.id,
    dealStatus: deal.status,
    windowHours: REAFFIRMATION_WINDOW_HOURS,
    dueAt: reaffirmation?.dueAt ?? null,
    reaffirmationStatus: reaffirmation?.status ?? null,
    holdUntil: deal.vehicleHoldUntil ?? reaffirmation?.holdUntil ?? null,
    awaitingBuyerDecision: reaffirmation?.status === "MATERIAL_CHANGE_PENDING",
    accepted: deal.offer,
  });
}

export async function POST(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }
  if (parsed.data.holdUntil.getTime() <= Date.now()) {
    return errorResponse("HOLD_IN_PAST", "The hold-until date and time must be in the future.", 400);
  }

  try {
    const result = await submitReaffirmation({
      dealId,
      dealerId: dealer.id,
      submission: parsed.data,
    });
    return successResponse(result);
  } catch (err) {
    if (err instanceof ReaffirmationError) {
      const status =
        err.code === "NOT_FOUND" ? 404 : err.code === "FORBIDDEN" ? 404 : err.code === "VALIDATION" ? 400 : 409;
      // FORBIDDEN answers 404 on purpose: telling a dealership that a deal exists but is not
      // theirs is a state oracle for anyone with a dealer session and an id.
      return errorResponse(err.code, err.message, status);
    }
    throw err;
  }
}
