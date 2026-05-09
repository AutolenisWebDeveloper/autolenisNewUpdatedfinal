import { NextRequest } from "next/server";
import { getRequestAffiliate, successResponse, errorResponse } from "@/lib/auth/affiliate-api";
import { prisma } from "@/lib/prisma";
import { createServiceSupabaseClient } from "@/lib/supabase";
import { AFFILIATE_DOCUMENT_MAX_BYTES } from "@/lib/constants";

const ALLOWED_TYPES = ["W9", "GOVERNMENT_ID", "AGREEMENT", "OTHER"] as const;
const ALLOWED_MIME = ["application/pdf", "image/jpeg", "image/png"];
const BUCKET = "affiliate-documents";

// Derive extension from validated MIME type — never trust user-provided filename extension
const MIME_TO_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};

export async function POST(request: NextRequest) {
  const affiliate = await getRequestAffiliate(request);
  if (!affiliate) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse("VALIDATION_ERROR", "Invalid form data", 400);
  }

  const file = formData.get("file");
  const type = formData.get("type");

  if (!(file instanceof File)) return errorResponse("VALIDATION_ERROR", "File is required", 400);
  if (typeof type !== "string" || !ALLOWED_TYPES.includes(type as typeof ALLOWED_TYPES[number])) {
    return errorResponse("VALIDATION_ERROR", "Invalid document type", 400);
  }
  if (file.size > AFFILIATE_DOCUMENT_MAX_BYTES) return errorResponse("VALIDATION_ERROR", "File must be under 10 MB", 400);
  if (!ALLOWED_MIME.includes(file.type)) {
    return errorResponse("VALIDATION_ERROR", "Only PDF, JPEG, and PNG files are allowed", 400);
  }

  // Derive extension from validated MIME type
  const ext = MIME_TO_EXT[file.type] ?? "bin";
  const storagePath = `${affiliate.id}/${Date.now()}-${type.toLowerCase()}.${ext}`;

  const supabase = createServiceSupabaseClient();
  const bytes = await file.arrayBuffer();

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, bytes, { contentType: file.type, upsert: false });

  if (uploadError) {
    return errorResponse("UPLOAD_ERROR", "Storage upload failed", 500);
  }

  const document = await prisma.affiliateDocument.create({
    data: {
      affiliateId: affiliate.id,
      type,
      fileName: file.name,
      fileUrl: storagePath, // Storage path — never returned raw to browser
      fileSizeBytes: file.size,
      status: "PENDING",
    },
  });

  return successResponse(
    { documentId: document.id, status: document.status, fileName: document.fileName, fileSizeBytes: document.fileSizeBytes },
    201
  );
}
