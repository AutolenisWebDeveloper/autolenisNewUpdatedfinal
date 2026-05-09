import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { uploadDealerContract } from "@/lib/services/dealer/dealer-contract.service";
import { z } from "zod";

const schema = z.object({ dealId: z.string(), documentUrl: z.string().url(), mimeType: z.string().optional(), sizeBytes: z.number().int().optional() });

export async function POST(request: NextRequest) {
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorResponse("VALIDATION_ERROR", parsed.error.message, 400);
  const cv = await uploadDealerContract(parsed.data.dealId, dealer.id, parsed.data.documentUrl);
  return successResponse({ contractVersion: cv }, 201);
}
