// POST /api/buyer/requests/financing/upload-letter
// Uploads a pre-approval letter (PDF or image) to Supabase Storage.
// Returns a URL to be included in the main request submission body.
// Max file size: 10MB. Accepted: PDF, JPEG, PNG, WebP.

import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { createServiceSupabaseClient } from "@/lib/supabase";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
// Bucket must be created in Supabase Storage before use.
// Required configuration:
//   - Bucket name: "prequal-letters"
//   - Access: public (so uploaded URLs are accessible to admins)
//   - RLS policy: authenticated buyers can INSERT; only service role can SELECT
const BUCKET = "prequal-letters";

export async function POST(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return errorResponse("BAD_REQUEST", "Request must be multipart/form-data", 400);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse("BAD_REQUEST", "Could not parse form data", 400);
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return errorResponse("BAD_REQUEST", "No file provided", 400);
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return errorResponse("BAD_REQUEST", "File must be a PDF, JPEG, PNG, or WebP image", 400);
  }

  if (file.size > MAX_BYTES) {
    return errorResponse("BAD_REQUEST", "File exceeds 10 MB limit", 400);
  }

  const supabase = createServiceSupabaseClient();
  const ext = file.type === "application/pdf" ? "pdf" : file.type.split("/")[1];
  const path = `${buyer.id}/${Date.now()}.${ext}`;

  const buffer = Buffer.from(await file.arrayBuffer());

  const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: file.type,
    upsert: false,
  });

  if (error) {
    logger.error("[upload-letter] Supabase storage error:", error);
    return errorResponse("UPLOAD_FAILED", "Document upload failed. Please try again or contact support.", 500);
  }

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);

  return successResponse({ url: urlData.publicUrl }, 201);
}
