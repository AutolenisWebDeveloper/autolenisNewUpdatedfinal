// POST /api/dealer/pickup/[dealId]/confirm
// Dealer confirms the buyer's proposed pickup time (PROPOSED → SCHEDULED).
// Portal-session auth; isolation (offer.dealerId === dealer.id) is enforced
// inside confirmPickup, which returns NOT_FOUND for a foreign deal.
import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { z } from "zod";
import { confirmPickup, coordHttp } from "@/lib/services/pickup/pickup-coordination.service";

interface Props { params: Promise<{ dealId: string }> }

// The client echoes the proposedAt it observed — the CAS token that guards
// against confirming a proposal the buyer has since changed.
const bodySchema = z.object({
  proposedAt: z.string().refine((s) => !isNaN(Date.parse(s)), "Invalid proposedAt"),
});

export async function POST(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  let body: unknown;
  try { body = await request.json(); }
  catch { return errorResponse("VALIDATION_ERROR", "Invalid JSON", 400); }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }

  const result = await confirmPickup(dealId, dealer.id, new Date(parsed.data.proposedAt));
  if (!result.ok) {
    const { errorCode, status } = coordHttp(result.code);
    return errorResponse(errorCode, result.reason, status);
  }
  return successResponse({ pickup: result.pickup });
}
