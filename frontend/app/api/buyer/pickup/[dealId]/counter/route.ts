// POST /api/buyer/pickup/[dealId]/counter
// Buyer proposes another time in response to the dealer's counter
// (DEALER_COUNTERED → PROPOSED), constrained by the dealer's availability.
// Counter cap → EXCEPTION (admin). Ownership enforced inside counterAsBuyer.
import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { z } from "zod";
import { counterAsBuyer, coordHttp } from "@/lib/services/pickup/pickup-coordination.service";

interface Props { params: Promise<{ dealId: string }> }

const bodySchema = z.object({
  scheduledAt: z.string().refine((s) => !isNaN(Date.parse(s)), "Invalid date"),
  proposedAt: z.string().refine((s) => !isNaN(Date.parse(s)), "Invalid proposedAt"),
});

export async function POST(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  let body: unknown;
  try { body = await request.json(); }
  catch { return errorResponse("VALIDATION_ERROR", "Invalid JSON", 400); }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }

  const result = await counterAsBuyer(
    dealId,
    buyer.id,
    new Date(parsed.data.scheduledAt),
    new Date(parsed.data.proposedAt),
  );
  if (!result.ok) {
    const { errorCode, status } = coordHttp(result.code);
    return errorResponse(errorCode, result.reason, status);
  }
  return successResponse({ pickup: result.pickup });
}
