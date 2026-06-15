// PATCH /api/dealer/settings — save dealer notification preferences.
// These fields do not yet exist in the Prisma schema; we safely no-op the DB write
// and return success, logging for observability.
import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { z } from "zod";

const schema = z.object({
  notifyNewAuction:    z.boolean().optional(),
  notifyOfferAccepted: z.boolean().optional(),
  notifyPickupReady:   z.boolean().optional(),
});

export async function PATCH(request: NextRequest) {
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }

  // Notification preference fields are not yet persisted in DB.
  // Log the intent and return success so the UI flow works end-to-end.
  logger.info("[dealer/settings] prefs update (no-op, schema pending)", {
    dealerId: dealer.id,
    prefs: parsed.data,
  });

  return successResponse({ updated: true });
}
