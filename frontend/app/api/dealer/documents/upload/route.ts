// POST /api/dealer/documents/upload — upload dealer document to Supabase Storage.
// Accepts multipart/form-data with a "file" field (PDF, JPG, PNG, WEBP).
// Uploads to bucket "dealer-documents", creates a Document record for the dealer.
import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { createServiceSupabaseClient } from "@/lib/supabase";
import { DocumentType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeDealerAudit } from "@/lib/services/audit/dealer-audit.service";

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB
const BUCKET = "dealer-documents";
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const MIME_TO_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

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
  if (!file) return errorResponse("VALIDATION_ERROR", "File is required", 400);

  if (!ALLOWED_TYPES.has(file.type)) {
    return errorResponse("VALIDATION_ERROR", "Only PDF, JPG, PNG, or WEBP files accepted", 400);
  }
  if (file.size > MAX_BYTES) {
    return errorResponse("VALIDATION_ERROR", "File must be under 20 MB", 400);
  }

  const supabase = createServiceSupabaseClient();
  const ext = MIME_TO_EXT[file.type] ?? "bin";
  const path = `${dealer.id}/${crypto.randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: file.type, upsert: false });

  if (uploadError) {
    console.error("[dealer/documents/upload]", uploadError);
    return errorResponse("STORAGE_ERROR", "File upload failed. Please try again.", 500);
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(BUCKET).getPublicUrl(path);

  const doc = await prisma.document.create({
    data: {
      dealerId:  dealer.id,
      type:      DocumentType.OTHER,
      name:      file.name,
      url:       publicUrl,
      mimeType:  file.type,
      sizeBytes: file.size,
    },
  });

  await writeDealerAudit({
    action: "DEALER_DOCUMENT_UPLOADED",
    dealerId: dealer.id,
    entityType: "Document",
    entityId: doc.id,
    metadata: {
      name: doc.name,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
      type: doc.type,
      storagePath: path,
    },
  });

  return successResponse({ documentId: doc.id, name: doc.name, type: doc.type });
}
