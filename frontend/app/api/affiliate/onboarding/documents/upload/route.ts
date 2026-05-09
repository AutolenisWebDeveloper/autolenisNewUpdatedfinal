import { NextRequest } from "next/server";
import { getRequestAffiliate, successResponse, errorResponse } from "@/lib/auth/affiliate-api";
import { prisma } from "@/lib/prisma";
import { createServiceSupabaseClient } from "@/lib/supabase";

const ALLOWED_TYPES = ["GOVERNMENT_ID", "W9", "VOIDED_CHECK", "BUSINESS_LICENSE", "OTHER"] as const;
const ALLOWED_MIME  = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const MAX_BYTES     = 10 * 1024 * 1024;
const BUCKET        = "affiliate-documents";
const MIME_TO_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg":      "jpg",
  "image/png":       "png",
  "image/webp":      "webp",
};

export async function POST(request: NextRequest) {
  const affiliate = await getRequestAffiliate(request);
  if (!affiliate) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  let formData: FormData;
  try { formData = await request.formData(); } catch { return errorResponse("VALIDATION_ERROR", "Invalid form data", 400); }

  const file = formData.get("file");
  const type = formData.get("type");

  if (!(file instanceof File)) return errorResponse("VALIDATION_ERROR", "File is required", 400);
  if (typeof type !== "string" || !ALLOWED_TYPES.includes(type as typeof ALLOWED_TYPES[number])) {
    return errorResponse("VALIDATION_ERROR", "Invalid document type", 400);
  }
  if (file.size > MAX_BYTES) return errorResponse("VALIDATION_ERROR", "File must be under 10 MB", 400);
  if (!ALLOWED_MIME.includes(file.type)) {
    return errorResponse("VALIDATION_ERROR", "Only PDF, JPEG, PNG, and WEBP files are allowed", 400);
  }

  const ext         = MIME_TO_EXT[file.type];
  if (!ext) return errorResponse("VALIDATION_ERROR", "Unsupported file type", 400);
  const storagePath = `${affiliate.id}/${type.toLowerCase()}/${crypto.randomUUID()}.${ext}`;

  const supabase = createServiceSupabaseClient();
  const bytes    = await file.arrayBuffer();

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, bytes, { contentType: file.type, upsert: false });

  if (uploadError) return errorResponse("UPLOAD_ERROR", "Storage upload failed", 500);

  const document = await prisma.affiliateDocument.create({
    data: {
      affiliateId:   affiliate.id,
      type,
      fileName:      file.name,
      fileUrl:       storagePath,
      fileSizeBytes: file.size,
      status:        "UPLOADED",
    },
  });

  return successResponse({ documentId: document.id, type: document.type, status: document.status }, 201);
}
