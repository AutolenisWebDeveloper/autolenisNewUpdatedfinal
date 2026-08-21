// GET /api/buyer/documents/[documentId]/signed-url
//
// Buyer documents live in the PRIVATE "buyer-documents" bucket; the DB stores a
// bare storage path, never a public URL. This authorized route verifies the
// document belongs to the requesting buyer, mints a short-lived signed URL, and
// redirects to it — so a document row can actually be opened without exposing a
// public link or the raw path (the buyer documents page links here).

import { NextRequest, NextResponse } from "next/server";
import { getRequestBuyer, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { createSignedDocumentUrl } from "@/lib/services/documents/storage-links";

const BUCKET = "buyer-documents";

interface Props { params: Promise<{ documentId: string }> }

export async function GET(request: NextRequest, { params }: Props) {
  const { documentId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  // Ownership: only the owning buyer may read the document.
  const doc = await prisma.document.findFirst({
    where: { id: documentId, buyerId: buyer.id },
    select: { url: true },
  });
  if (!doc) return errorResponse("NOT_FOUND", "Document not found", 404);

  const signedUrl = await createSignedDocumentUrl(BUCKET, doc.url);
  if (!signedUrl) return errorResponse("STORAGE_ERROR", "Unable to generate document link", 500);

  return NextResponse.redirect(signedUrl);
}
