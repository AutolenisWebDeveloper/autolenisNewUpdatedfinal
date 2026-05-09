import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { submitTradeIn } from "@/lib/services/trade-in/trade-in.service";
import { z } from "zod";

const schema = z.object({
  vin: z.string().optional(), year: z.number().int().min(1980).max(new Date().getFullYear() + 1),
  make: z.string().min(1), model: z.string().min(1), trim: z.string().optional(),
  mileage: z.number().int().optional(), condition: z.enum(["EXCELLENT", "GOOD", "FAIR", "POOR"]),
  loanStatus: z.string().optional(), loanBalanceCents: z.number().int().optional(), notes: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorResponse("VALIDATION_ERROR", parsed.error.message, 400);
  const submission = await submitTradeIn(buyer.id, parsed.data);
  return successResponse({ submission }, 201);
}

export async function GET(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  const { getBuyerTradeIns } = await import("@/lib/services/trade-in/trade-in.service");
  const tradeIns = await getBuyerTradeIns(buyer.id);
  return successResponse({ tradeIns });
}
