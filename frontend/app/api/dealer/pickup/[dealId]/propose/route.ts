// POST /api/dealer/pickup/[dealId]/propose
// Dealer proposes an alternative pickup time (PROPOSED → DEALER_COUNTERED),
// constrained by the dealer's own availability. Counter cap → EXCEPTION (admin).
// Portal-session auth; isolation enforced inside counterAsDealer.
import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { z } from "zod";
import { counterAsDealer, coordHttp } from "@/lib/services/pickup/pickup-coordination.service";

interface Props { params: Promise<{ dealId: string }> }

const bodySchema = z.object({
  scheduledAt: z.string().refine((s) => !isNaN(Date.parse(s)), "Invalid date"),
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

  const result = await counterAsDealer(
    dealId,
    dealer.id,
    new Date(parsed.data.scheduledAt),
    new Date(parsed.data.proposedAt),
  );
  if (!result.ok) {
    const { errorCode, status } = coordHttp(result.code);
    return errorResponse(errorCode, result.reason, status);
  }
  return successResponse({ pickup: result.pickup });
}
