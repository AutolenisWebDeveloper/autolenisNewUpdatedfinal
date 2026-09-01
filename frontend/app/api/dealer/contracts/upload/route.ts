import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { uploadDealerContract, DealOwnershipError } from "@/lib/services/dealer/dealer-contract.service";
import { z } from "zod";
import { contractDocumentPathSchema } from "@/lib/services/contract-shield/contract-document-ref";

// documentUrl is a bare storage path in the private contracts bucket, NOT a URL —
// see contract-document-ref for why `.url()` was inverted here (and an SSRF).
const schema = z.object({ dealId: z.string(), documentUrl: contractDocumentPathSchema, mimeType: z.string().optional(), sizeBytes: z.number().int().optional() });

export async function POST(request: NextRequest) {
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse("INVALID_JSON", "Request body must be valid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorResponse("VALIDATION_ERROR", parsed.error.message, 400);
  try {
    const cv = await uploadDealerContract(parsed.data.dealId, dealer.id, parsed.data.documentUrl);
    return successResponse({ contractVersion: cv }, 201);
  } catch (err) {
    if (err instanceof DealOwnershipError) {
      return errorResponse("FORBIDDEN", err.message, 403);
    }
    throw err;
  }
}
