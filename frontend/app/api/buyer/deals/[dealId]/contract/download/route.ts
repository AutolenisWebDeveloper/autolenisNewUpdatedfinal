// GET /api/buyer/deals/[dealId]/contract/download
import { NextRequest, NextResponse } from "next/server";
import { getRequestBuyer, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";

interface Props { params: Promise<{ dealId: string }> }

export async function GET(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const deal = await prisma.deal.findFirst({
    where: { id: dealId, buyerId: buyer.id },
    include: { eSignEnvelope: true },
  });

  if (!deal) return errorResponse("NOT_FOUND", "Deal not found", 404);

  // ESignEnvelope does not yet store a document URL — it will be populated
  // once the signature completes and the executed record is available.
  // For now, return a clear 404 so the UI can display an appropriate message.
  if (!deal.eSignEnvelope) {
    return errorResponse(
      "NOT_AVAILABLE",
      "Contract document is not yet available. It will be accessible after signing is complete.",
      404
    );
  }

  if (deal.eSignEnvelope.status !== "COMPLETED") {
    return errorResponse(
      "NOT_AVAILABLE",
      "Contract document is not yet available. It will be accessible after all documents have been signed.",
      404
    );
  }

  // documentKey is the private-bucket storage path of the executed signed PDF,
  // populated on envelope-completed (esign.service). Null means retrieval hasn't
  // succeeded yet — report a clear not-yet-available rather than a crash.
  const documentKey = deal.eSignEnvelope.documentKey;
  if (!documentKey) {
    return errorResponse(
      "NOT_AVAILABLE",
      "Your signed contract is being finalized and will be available shortly. Please check back soon.",
      404
    );
  }

  try {
    const { createServiceSupabaseClient } = await import("@/lib/supabase");
    const supabase = createServiceSupabaseClient();
    const { data, error } = await supabase.storage
      .from("contracts")
      .createSignedUrl(documentKey, 900);
    if (error || !data?.signedUrl) {
      return errorResponse("STORAGE_ERROR", "Could not generate download link.", 500);
    }
    return NextResponse.redirect(data.signedUrl);
  } catch {
    return errorResponse("STORAGE_ERROR", "Could not access contract storage.", 500);
  }
}
