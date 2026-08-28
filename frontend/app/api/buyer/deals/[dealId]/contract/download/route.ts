// GET /api/buyer/deals/[dealId]/contract/download
import { NextRequest, NextResponse } from "next/server";
import { getRequestBuyer, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { esignEnvelopeSelect, toEnvelopeView } from "@/lib/services/esign/envelope-schema";

interface Props { params: Promise<{ dealId: string }> }

export async function GET(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const dealRow = await prisma.deal.findFirst({
    where: { id: dealId, buyerId: buyer.id },
    // Narrowed through the schema gate (see lib/services/esign/envelope-schema):
    // executedDocumentKey below is one of the columns this database may not have.
    include: { eSignEnvelope: { select: esignEnvelopeSelect() } },
  });

  if (!dealRow) return errorResponse("NOT_FOUND", "Deal not found", 404);
  const deal = { ...dealRow, eSignEnvelope: toEnvelopeView(dealRow.eSignEnvelope) };

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
      "Your signed contract isn't available yet. It will be accessible once you've completed signing.",
      404
    );
  }

  // The EXECUTED contract artifact (§4) — generated in-house from the pinned,
  // hashed contract + the buyer's signature/consent evidence. Prefer it; fall
  // back to the legacy DocuSign documentKey only for pre-cutover historical
  // envelopes. Null on both means finalization hasn't completed yet.
  const executedKey = deal.eSignEnvelope.executedDocumentKey ?? deal.eSignEnvelope.documentKey;
  if (!executedKey) {
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
      .createSignedUrl(executedKey, 900);
    if (error || !data?.signedUrl) {
      return errorResponse("STORAGE_ERROR", "Could not generate download link.", 500);
    }
    return NextResponse.redirect(data.signedUrl);
  } catch {
    return errorResponse("STORAGE_ERROR", "Could not access contract storage.", 500);
  }
}
