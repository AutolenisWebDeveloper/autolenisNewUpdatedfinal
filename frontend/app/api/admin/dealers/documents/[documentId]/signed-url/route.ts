import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { createSignedDocumentUrl } from "@/lib/services/documents/storage-links";

// GET /api/admin/dealers/documents/[documentId]/signed-url
// Returns a short-lived signed URL for a dealer document stored in the private
// "dealer-documents" bucket. Authorization: authenticated admin. The raw
// storage path is never returned — only the signed URL, generated fresh here.
const BUCKET = "dealer-documents";

interface Props {
  params: Promise<{ documentId: string }>;
}

export async function GET(request: NextRequest, { params }: Props) {
  const { documentId } = await params;

  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc) return adminError("NOT_FOUND", "Document not found", 404);
  // This route serves dealer-scoped documents only.
  if (!doc.dealerId) return adminError("NOT_FOUND", "Document not found", 404);

  const signedUrl = await createSignedDocumentUrl(BUCKET, doc.url);
  if (!signedUrl) return adminError("STORAGE_ERROR", "Unable to generate document link", 500);

  return adminSuccess({ signedUrl });
}
