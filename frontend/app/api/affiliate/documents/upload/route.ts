import { NextRequest } from "next/server";
import { getRequestAffiliate, successResponse, errorResponse } from "@/lib/auth/affiliate-api";
import { uploadAffiliateDocument } from "@/lib/services/affiliate/document-upload.service";

// O11 — thin handler over the shared upload service (see the onboarding
// upload route for the other caller). The portal document center accepts the
// ongoing-compliance types; uploads land PENDING for admin review.
const ALLOWED_TYPES = ["W9", "GOVERNMENT_ID", "AGREEMENT", "OTHER"] as const;

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
    initialStatus: "PENDING",
  });

  if (!result.ok) return errorResponse(result.code, result.message, result.httpStatus);
  return successResponse(
    {
      documentId: result.document.id,
      status: result.document.status,
      fileName: result.document.fileName,
      fileSizeBytes: result.document.fileSizeBytes,
    },
    201,
  );
}
