import { NextRequest } from "next/server";
import { getRequestAffiliate, successResponse, errorResponse } from "@/lib/auth/affiliate-api";
import { uploadAffiliateDocument } from "@/lib/services/affiliate/document-upload.service";

// O11 — thin handler over the shared upload service (this route and the
// portal document-center route previously duplicated the logic with drifted
// allowlists). Onboarding accepts the identity/banking evidence types.
const ALLOWED_TYPES = ["GOVERNMENT_ID", "W9", "VOIDED_CHECK", "BUSINESS_LICENSE", "OTHER"] as const;

export async function POST(request: NextRequest) {
  const affiliate = await getRequestAffiliate(request);
  if (!affiliate) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  let formData: FormData;
  try { formData = await request.formData(); } catch { return errorResponse("VALIDATION_ERROR", "Invalid form data", 400); }

  const result = await uploadAffiliateDocument({
    affiliateId: affiliate.id,
    file: formData.get("file"),
    type: formData.get("type"),
    allowedTypes: ALLOWED_TYPES,
    initialStatus: "UPLOADED",
  });

  if (!result.ok) return errorResponse(result.code, result.message, result.httpStatus);
  return successResponse({ documentId: result.document.id, type: result.document.type, status: result.document.status }, 201);
}
