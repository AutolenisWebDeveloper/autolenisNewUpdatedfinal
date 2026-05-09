// POST /api/dealer/contracts/upload-file — upload contract PDF to Supabase Storage.
// Accepts multipart/form-data: file (PDF) + dealId (string).
// Uploads to bucket "dealer-contracts" using service role client.
// Returns { documentUrl, mimeType, sizeBytes }.
import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { createServiceSupabaseClient } from "@/lib/supabase";

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB
const BUCKET = "dealer-contracts";

export async function POST(request: NextRequest) {
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse("INVALID_REQUEST", "Invalid form data", 400);
  }

  const file = form.get("file") as File | null;
  const dealId = (form.get("dealId") as string | null)?.trim();

  if (!file) return errorResponse("VALIDATION_ERROR", "File is required", 400);
  if (!dealId) return errorResponse("VALIDATION_ERROR", "dealId is required", 400);

  if (file.type !== "application/pdf") {
    return errorResponse("VALIDATION_ERROR", "Only PDF files are accepted", 400);
  }
  if (file.size > MAX_BYTES) {
    return errorResponse("VALIDATION_ERROR", "File must be under 20 MB", 400);
  }

  const supabase = createServiceSupabaseClient();
  const path = `${dealer.id}/${dealId}/${crypto.randomUUID()}.pdf`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: "application/pdf", upsert: false });

  if (uploadError) {
    console.error("[dealer/contracts/upload-file]", uploadError);
    return errorResponse("STORAGE_ERROR", "File upload failed. Please try again.", 500);
  }

  const {
    data: { publicUrl: documentUrl },
  } = supabase.storage.from(BUCKET).getPublicUrl(path);

  return successResponse({
    documentUrl,
    mimeType: "application/pdf",
    sizeBytes: file.size,
  });
}
