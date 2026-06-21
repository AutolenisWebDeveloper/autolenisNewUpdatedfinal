import { NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { createDealerEnvelopeFromTemplate } from "@/lib/services/esign/envelope-template.service";
import { advanceDealStatus, DealTransitionError } from "@/lib/services/deal/deal.service";

// Sentinel value stored by old sandbox mock path — used to detect stale mock envelopes
const MOCK_ENVELOPE_SENTINEL = "mock-envelope-id";

interface Props { params: Promise<{ dealId: string }> }

export async function GET(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  const deal = await prisma.deal.findFirst({ where: { id: dealId, buyerId: buyer.id }, include: { eSignEnvelope: true } });
  if (!deal) return errorResponse("NOT_FOUND", "Deal not found", 404);
  return successResponse({ envelope: deal.eSignEnvelope, dealStatus: deal.status });
}

// POST /api/buyer/esign/[dealId] — create a DocuSign envelope for the deal.
export async function POST(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const deal = await prisma.deal.findFirst({
    where:   { id: dealId, buyerId: buyer.id },
    include: { eSignEnvelope: true },
  });
  if (!deal) return errorResponse("NOT_FOUND", "Deal not found", 404);

  // If envelope already created and has a valid DocuSign ID, generate a fresh signing URL
  if (
    deal.eSignEnvelope?.docusignEnvelopeId &&
    deal.eSignEnvelope.docusignEnvelopeId !== MOCK_ENVELOPE_SENTINEL &&
    deal.eSignEnvelope.status !== "COMPLETED"
  ) {
    try {
      const result = await createDealerEnvelopeFromTemplate(dealId);
      if (result.signingUrl) {
        return successResponse({
          envelopeId: result.envelopeId,
          signingUrl:  result.signingUrl,
          mock:        false,
        });
      }
    } catch {
      // Fall through to create new envelope
    }
  }

  // Contract Shield hard gate: a deal can only reach SIGNING_PENDING once it has
  // been CONTRACT_APPROVED. advanceDealStatus rejects any other source state.
  if (deal.status !== "CONTRACT_APPROVED" && deal.status !== "SIGNING_PENDING") {
    return errorResponse(
      "CONTRACT_NOT_APPROVED",
      "This contract has not been approved yet. Signing becomes available after Contract Shield review passes.",
      409,
    );
  }

  try {
    const result = await createDealerEnvelopeFromTemplate(dealId);

    if (result.error && !result.envelopeId) {
      return errorResponse("DOCUSIGN_ERROR", result.error, 503);
    }

    try {
      await advanceDealStatus(dealId, "SIGNING_PENDING", { actorRole: "BUYER" });
    } catch (err) {
      if (err instanceof DealTransitionError) {
        return errorResponse("CONTRACT_NOT_APPROVED", "Signing is not available from the current deal state.", 409);
      }
      throw err;
    }

    return successResponse({
      envelopeId: result.envelopeId,
      signingUrl:  result.signingUrl,
      error:       result.error,
      mock:        false,
    });
  } catch (err) {
    logger.error("[buyer/esign] failed to create signing envelope:", err);
    return errorResponse("INTERNAL_ERROR", "We couldn't start the signing process. Please try again.", 500);
  }
}
