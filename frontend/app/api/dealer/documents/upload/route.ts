// POST /api/dealer/documents/upload — upload dealer document to Supabase Storage.
// Accepts multipart/form-data with a "file" field (PDF, JPG, PNG, WEBP).
// Uploads to bucket "dealer-documents", creates a Document record for the dealer.
import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { createServiceSupabaseClient } from "@/lib/supabase";
import { DocumentType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeDealerAudit } from "@/lib/services/audit/dealer-audit.service";
import { linkDealDocument, DealDocumentError } from "@/lib/services/dealer/deal-document-link.service";

/** Resolve a client-supplied document-type string to a valid enum member. */
function parseDocumentType(raw: string | null): DocumentType {
  if (raw && (Object.values(DocumentType) as string[]).includes(raw)) {
    return raw as DocumentType;
  }
  return DocumentType.OTHER;
}

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

  // Optional deal-association fields. When dealId is present the document is
  // linked to that deal through the validated linker (ownership + identifier
  // cross-checks + dedup). When absent it remains a dealer-scoped document.
  const dealId = (form.get("dealId") as string | null)?.trim() || null;
  const docType = parseDocumentType(form.get("type") as string | null);
  const expectedVin = (form.get("vin") as string | null)?.trim() || null;
  const expectedBuyerId = (form.get("buyerId") as string | null)?.trim() || null;
  const expectedTransactionId = (form.get("transactionId") as string | null)?.trim() || null;

  // Fail fast on an invalid/non-owned deal BEFORE consuming storage, so a
  // rejected association never leaves an orphaned object in the bucket.
  if (dealId) {
    try {
      const { resolveOwnedDealAssociation } = await import(
        "@/lib/services/dealer/deal-document-link.service"
      );
      await resolveOwnedDealAssociation(dealId, dealer.id);
    } catch (err) {
      if (err instanceof DealDocumentError) return errorResponse(err.code, err.message, err.status);
      throw err;
    }
  }

  const supabase = createServiceSupabaseClient();
  const ext = MIME_TO_EXT[file.type] ?? "bin";
  const path = `${dealer.id}/${crypto.randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: file.type, upsert: false });

  if (uploadError) {
    logger.error("[dealer/documents/upload]", uploadError);
    return errorResponse("STORAGE_ERROR", "File upload failed. Please try again.", 500);
  }

  // The bucket is private; persist the bare storage path (never a public URL).
  // Reads are served via short-lived signed URLs from an authorized route.

  // Deal-linked path: validated association + idempotent dedup + audit.
  if (dealId) {
    try {
      const { document, deduped, resolved } = await linkDealDocument({
        dealerId: dealer.id,
        dealerUserId: dealer.userId,
        dealId,
        type: docType,
        name: file.name,
        url: path,
        mimeType: file.type,
        sizeBytes: file.size,
        expectedVin,
        expectedBuyerId,
        expectedTransactionId,
      });
      // A deduped re-upload leaves the freshly uploaded object unreferenced —
      // remove it so storage mirrors the (single) document record.
      if (deduped) {
        await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
      }
      return successResponse({
        documentId: document.id,
        name: document.name,
        type: document.type,
        dealId: resolved.dealId,
        buyerId: resolved.buyerId,
        deduped,
      });
    } catch (err) {
      if (err instanceof DealDocumentError) {
        await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
        return errorResponse(err.code, err.message, err.status);
      }
      throw err;
    }
  }

  // Unlinked dealer-scoped document (compliance records, general uploads).
  const doc = await prisma.document.create({
    data: {
      dealerId:  dealer.id,
      type:      docType,
      name:      file.name,
      url:       path,
      mimeType:  file.type,
      sizeBytes: file.size,
    },
  });

  await writeDealerAudit({
    action: "DEALER_DOCUMENT_UPLOADED",
    dealerId: dealer.id,
    dealerUserId: dealer.userId,
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
