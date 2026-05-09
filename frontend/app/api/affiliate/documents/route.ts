import { NextRequest } from "next/server";
import { getRequestAffiliate, successResponse, errorResponse } from "@/lib/auth/affiliate-api";
import { prisma } from "@/lib/prisma";
import { createServiceSupabaseClient } from "@/lib/supabase";

const BUCKET = "affiliate-documents";
const SIGNED_URL_EXPIRY = 3600; // 1 hour

export async function GET(request: NextRequest) {
  const affiliate = await getRequestAffiliate(request);
  if (!affiliate) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const documents = await prisma.affiliateDocument.findMany({
    where: { affiliateId: affiliate.id },
    orderBy: { uploadedAt: "desc" },
  });

  const supabase = createServiceSupabaseClient();

  const withSignedUrls = await Promise.all(
    documents.map(async (doc) => {
      const { data } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(doc.fileUrl, SIGNED_URL_EXPIRY);

      return {
        id: doc.id,
        type: doc.type,
        fileName: doc.fileName,
        fileSizeBytes: doc.fileSizeBytes,
        status: doc.status,
        uploadedAt: doc.uploadedAt,
        signedUrl: data?.signedUrl ?? null,
        // fileUrl from DB is never returned
      };
    })
  );

  return successResponse({ documents: withSignedUrls });
}
