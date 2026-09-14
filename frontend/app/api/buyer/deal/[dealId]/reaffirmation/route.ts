// GET  /api/buyer/deal/[dealId]/reaffirmation — what the dealership confirmed, and any change.
// POST /api/buyer/deal/[dealId]/reaffirmation — §Stage 10's two buyer actions.
//
// TWO ACTIONS, AND THE ORDER BETWEEN THEM MATTERS:
//
//   ACKNOWLEDGE   §Stage 10: "The buyer acknowledges the condition disclosure before the
//                 transaction proceeds to recap. This is a single explicit acknowledgment, not a
//                 stack of screens."
//   DECIDE        §10a: one accept, one reject, on a change the dealership proposed.
//
// Whichever completes the conjunction advances the deal — the service checks all four exit clauses
// (§Stage 10's three plus §10b's outside-winner gate) rather than either action assuming it was
// the last one needed.
//
// THE CEILING IS NEVER IN THIS RESPONSE. The GET returns what the dealership confirmed and what
// changed; it does not return the buyer's approved amount, because §10a's above-ceiling case is
// refused at the DEALERSHIP (`submitReaffirmation`) and never reaches the buyer as a choice. A
// buyer who cannot be shown an above-ceiling option has no need to be shown the ceiling.
import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import {
  acknowledgeConditionDisclosure,
  decideMaterialChange,
  reaffirmationExitSatisfied,
  ReaffirmationError,
} from "@/lib/services/deal/dealer-reaffirmation.service";
import type { MaterialDifference } from "@/lib/services/deal/material-change";

interface Props { params: Promise<{ dealId: string }> }

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ACKNOWLEDGE_DISCLOSURE") }),
  z.object({ action: z.literal("DECIDE_CHANGE"), accept: z.boolean() }),
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
      vehicleHoldUntil: true,
      conditionDisclosureAcknowledgedAt: true,
      otdCentsConfirmed: true,
      vin: true,
      offer: {
        select: {
          otdPriceCents: true,
          vin: true,
          odometer: true,
          vehicleYear: true,
          vehicleMake: true,
          vehicleModel: true,
          vehicleTrim: true,
        },
      },
    },
  });
  if (!deal) return errorResponse("NOT_FOUND", "Deal not found", 404);

  const reaffirmation = await prisma.dealerReaffirmation.findFirst({
    where: { dealId },
    orderBy: { createdAt: "desc" },
  });

  const proposal = reaffirmation?.materialChangeProposal as
    | { differences?: MaterialDifference[]; autoApplied?: boolean; savingCents?: number }
    | null
    | undefined;

  const exit = await reaffirmationExitSatisfied(dealId);

  return successResponse({
    dealId: deal.id,
    dealStatus: deal.status,
    reaffirmationStatus: reaffirmation?.status ?? null,
    dueAt: reaffirmation?.dueAt ?? null,
    holdUntil: deal.vehicleHoldUntil ?? null,
    acknowledgedAt: deal.conditionDisclosureAcknowledgedAt,
    disclosureArtifactUrls: reaffirmation?.disclosureArtifactUrls ?? [],
    confirmed: {
      vin: reaffirmation?.confirmedVin ?? deal.vin ?? deal.offer?.vin ?? null,
      odometer: reaffirmation?.confirmedOdometer ?? deal.offer?.odometer ?? null,
      otdCents: reaffirmation?.confirmedOtdCents ?? deal.otdCentsConfirmed ?? deal.offer?.otdPriceCents ?? null,
      deliveryTerms: reaffirmation?.confirmedDeliveryTerms ?? null,
      outOfStateHandling: reaffirmation?.outOfStateHandling ?? null,
    },
    accepted: deal.offer,
    // §10a's side-by-side payload. Empty unless a decision is genuinely owed.
    materialChange:
      reaffirmation?.status === "MATERIAL_CHANGE_PENDING"
        ? { differences: proposal?.differences ?? [], decisionRequired: true }
        : null,
    // Recorded so the buyer is TOLD about a saving applied in their favour rather than finding a
    // different number (§10a: "applies automatically in the buyer's favor").
    autoApplied:
      proposal?.autoApplied === true ? { savingCents: proposal.savingCents ?? 0 } : null,
    // What is still outstanding, in the buyer's own words. An empty array means the stage is done.
    outstanding: exit.missing,
  });
}

export async function POST(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }

  try {
    if (parsed.data.action === "ACKNOWLEDGE_DISCLOSURE") {
      const result = await acknowledgeConditionDisclosure({ dealId, buyerId: buyer.id });
      return successResponse({ dealId, ...result });
    }
    const result = await decideMaterialChange({ dealId, buyerId: buyer.id, accept: parsed.data.accept });
    return successResponse({ dealId, ...result });
  } catch (err) {
    if (err instanceof ReaffirmationError) {
      return errorResponse(err.code, err.message, err.code === "NOT_FOUND" ? 404 : 409);
    }
    throw err;
  }
}
