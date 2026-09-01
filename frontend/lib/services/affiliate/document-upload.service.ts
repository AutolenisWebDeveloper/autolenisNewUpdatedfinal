// O11 — the ONE affiliate document upload path. Two routes previously
// duplicated this logic with drifted type/MIME allowlists and different
// storage-path schemes; both now call this service (golden rule 2: business
// logic lives in lib/services, handlers stay thin).

import { prisma } from "@/lib/prisma";
import { createServiceSupabaseClient } from "@/lib/supabase";
import { AFFILIATE_DOCUMENT_MAX_BYTES } from "@/lib/constants";

const BUCKET = "affiliate-documents";

// Union of both routes' previous allowlists; extension always derives from
// the validated MIME type, never from the user-supplied filename.
const MIME_TO_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type AffiliateDocumentUploadResult =
  | {
      ok: true;
      document: { id: string; type: string; status: string; fileName: string; fileSizeBytes: number };
    }
  | { ok: false; code: string; message: string; httpStatus: number };

export async function uploadAffiliateDocument(params: {
  affiliateId: string;
  file: unknown;
  type: unknown;
  allowedTypes: readonly string[];
  // Onboarding uploads land as UPLOADED (the submit gate checks presence);
  // portal document-center uploads land as PENDING (admin review queue).
  initialStatus: "UPLOADED" | "PENDING";
}): Promise<AffiliateDocumentUploadResult> {
  const { affiliateId, file, type, allowedTypes, initialStatus } = params;

  if (!(file instanceof File)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "File is required", httpStatus: 400 };
  }
  if (typeof type !== "string" || !allowedTypes.includes(type)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Invalid document type", httpStatus: 400 };
  }
  if (file.size > AFFILIATE_DOCUMENT_MAX_BYTES) {
    return { ok: false, code: "VALIDATION_ERROR", message: "File must be under 10 MB", httpStatus: 400 };
  }
  const ext = MIME_TO_EXT[file.type];
  if (!ext) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Only PDF, JPEG, PNG, and WEBP files are allowed", httpStatus: 400 };
  }

  const storagePath = `${affiliateId}/${type.toLowerCase()}/${crypto.randomUUID()}.${ext}`;
  const supabase = createServiceSupabaseClient();
  const bytes = await file.arrayBuffer();

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, bytes, { contentType: file.type, upsert: false });
  if (uploadError) {
    return { ok: false, code: "UPLOAD_ERROR", message: "Storage upload failed", httpStatus: 500 };
  }

  const document = await prisma.affiliateDocument.create({
    data: {
      affiliateId,
      type,
      fileName: file.name,
      fileUrl: storagePath, // storage path — never returned raw to the browser
      fileSizeBytes: file.size,
      status: initialStatus,
    },
  });

  return {
    ok: true,
    document: {
      id: document.id,
      type: document.type,
      status: document.status,
      fileName: document.fileName,
      fileSizeBytes: document.fileSizeBytes,
    },
  };
}
