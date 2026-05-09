import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { reviseOffer } from "@/lib/services/offer/offer.service";
import { z } from "zod";

interface Props { params: Promise<{ offerId: string }> }

const schema = z.object({ otdPriceCents: z.number().int().optional(), aprRate: z.number().optional(), feesCents: z.number().int().optional() });

export async function PATCH(request: NextRequest, { params }: Props) {
  const { offerId } = await params;
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorResponse("VALIDATION_ERROR", parsed.error.message, 400);

  try {
    const revised = await reviseOffer(offerId, dealer.id, parsed.data);
    return successResponse({ offer: revised });
  } catch (err) {
    return errorResponse("SERVICE_ERROR", String(err), 400);
  }
}
