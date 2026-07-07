import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { createSignedDocumentUrl } from "@/lib/services/documents/storage-links";

// GET /api/admin/contracts/[versionId]/signed-url
// Short-lived signed URL for a contract version in the private "contracts"
// bucket so the admin contracts hub can actually open what it lists.
export async function GET(request: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await params;

  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const version = await prisma.contractVersion.findUnique({ where: { id: versionId } });
  if (!version) return adminError("NOT_FOUND", "Contract version not found", 404);

  const signedUrl = await createSignedDocumentUrl("contracts", version.documentUrl);
  if (!signedUrl) return adminError("STORAGE_ERROR", "Unable to generate contract link", 500);

  return adminSuccess({ signedUrl });
}
