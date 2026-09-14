// POST /api/dealer/deals/[dealId]/hold — §10c, the dealership extends or releases its hold.
//
// "If the contract has not been requested before the hold expires, the dealership is asked to
// extend or release. A released hold returns the buyer to the remaining valid offers."
//
// BOTH ACTIONS ON ONE ROUTE because they are one decision with two answers, and splitting them
// makes it possible to build one and forget the other — which is how a hold expiry becomes a deal
// that simply stops.
//
// RELEASE IS DESTRUCTIVE TO THE DEAL and is treated as such: it stands the deal down, revokes the
// identity-firewall release, returns the buyer to the remaining valid offers, and records the
// failure on the dealership's record. It therefore requires an explicit reason, the same way every
// other consequential dealer action does.
import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { z } from "zod";
import {
  extendVehicleHold,
  releaseVehicleHold,
  ReaffirmationError,
} from "@/lib/services/deal/dealer-reaffirmation.service";

interface Props { params: Promise<{ dealId: string }> }

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("EXTEND"), holdUntil: z.coerce.date() }),
  z.object({
    action: z.literal("RELEASE"),
    reason: z.string().trim().min(10, "Say why the hold is being released — the buyer is told the reason."),
  }),
]);

export async function POST(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }

  try {
    if (parsed.data.action === "EXTEND") {
      if (parsed.data.holdUntil.getTime() <= Date.now()) {
        return errorResponse("HOLD_IN_PAST", "The new hold-until date and time must be in the future.", 400);
      }
      await extendVehicleHold({ dealId, dealerId: dealer.id, holdUntil: parsed.data.holdUntil });
      return successResponse({ dealId, action: "EXTEND", holdUntil: parsed.data.holdUntil });
    }

    await releaseVehicleHold({ dealId, actorId: dealer.id, reason: parsed.data.reason });
    return successResponse({ dealId, action: "RELEASE" });
  } catch (err) {
    if (err instanceof ReaffirmationError) {
      // FORBIDDEN answers 404: a dealership must not learn that a deal exists but is not theirs.
      const status = err.code === "NOT_FOUND" || err.code === "FORBIDDEN" ? 404 : 409;
      return errorResponse(err.code, err.message, status);
    }
    throw err;
  }
}
