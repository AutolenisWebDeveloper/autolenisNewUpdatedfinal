import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { createSignedDocumentUrl } from "@/lib/services/documents/storage-links";

// GET /api/admin/documents/[documentId]/signed-url
// Short-lived signed URL for any platform Document (buyer- or dealer-scoped),
// resolved to the correct private bucket by ownership. Mirrors the existing
// dealer/affiliate signed-url routes; the raw storage path is never returned.
export async function GET(request: NextRequest, { params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await params;

  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc) return adminError("NOT_FOUND", "Document not found", 404);

  const bucket = doc.dealerId ? "dealer-documents" : "buyer-documents";
  const signedUrl = await createSignedDocumentUrl(bucket, doc.url);
  if (!signedUrl) return adminError("STORAGE_ERROR", "Unable to generate document link", 500);

  return adminSuccess({ signedUrl });
}
