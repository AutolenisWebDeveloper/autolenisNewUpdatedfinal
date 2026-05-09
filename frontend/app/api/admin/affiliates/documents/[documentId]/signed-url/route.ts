import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { createServiceSupabaseClient } from "@/lib/supabase";

const BUCKET = "affiliate-documents";
const SIGNED_URL_EXPIRY = 900; // 15 minutes

interface Props { params: Promise<{ documentId: string }> }

export async function GET(request: NextRequest, { params }: Props) {
  const { documentId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const doc = await prisma.affiliateDocument.findUnique({ where: { id: documentId } });
  if (!doc) return adminError("NOT_FOUND", "Document not found", 404);

  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(doc.fileUrl, SIGNED_URL_EXPIRY);

  if (error || !data?.signedUrl) {
    return adminError("STORAGE_ERROR", "Unable to generate document link", 500);
  }

  // Only return signed URL — never return raw fileUrl from DB
  return adminSuccess({ signedUrl: data.signedUrl });
}
