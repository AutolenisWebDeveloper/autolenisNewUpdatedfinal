import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { getDealForBuyer } from "@/lib/services/deal/deal.service";
import { toBuyerEnvelopeSummary } from "@/lib/services/esign/esign-dto";
import { withBuyerGatedDefaults } from "@/lib/services/esign/esign-schema-gate";

interface Props { params: Promise<{ dealId: string }> }

export async function GET(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  const deal = await getDealForBuyer(buyer.id, dealId);
  if (!deal) return errorResponse("NOT_FOUND", "Deal not found", 404);
  // §11: the buyer receives the safe envelope SUMMARY, never the raw signing
  // record. Enforced by shaping here, matching /api/buyer/esign/[dealId].
  return successResponse({
    deal: {
      ...deal,
      eSignEnvelope: deal.eSignEnvelope
        ? toBuyerEnvelopeSummary(withBuyerGatedDefaults(deal.eSignEnvelope))
        : null,
    },
  });
}
