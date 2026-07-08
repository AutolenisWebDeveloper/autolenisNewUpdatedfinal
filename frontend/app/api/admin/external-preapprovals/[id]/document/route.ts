import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { createSignedDocumentUrl } from "@/lib/services/documents/storage-links";

// GET /api/admin/external-preapprovals/[id]/document/signed-url
// Short-lived signed URL for the lender letter attached to an external
// pre-approval, so the reviewing admin can actually open the document they
// are verifying (previously the uploaded letter was orphaned in storage).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const submission = await prisma.externalPreApproval.findUnique({ where: { id } });
  if (!submission) return adminError("NOT_FOUND", "Submission not found", 404);
  if (!submission.documentUrl) return adminError("NO_DOCUMENT", "No lender letter was uploaded for this submission", 404);

  const signedUrl = await createSignedDocumentUrl("prequal-letters", submission.documentUrl);
  if (!signedUrl) return adminError("STORAGE_ERROR", "Unable to generate document link", 500);

  return adminSuccess({ signedUrl });
}
