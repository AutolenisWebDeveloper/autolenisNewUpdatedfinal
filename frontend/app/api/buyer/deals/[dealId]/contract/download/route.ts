// GET /api/buyer/deals/[dealId]/contract/download
import { NextRequest, NextResponse } from "next/server";
import { getRequestBuyer, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { isExecutedArtifactEnabled } from "@/lib/services/esign/esign-schema-gate";

interface Props { params: Promise<{ dealId: string }> }

export async function GET(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  // Explicit projection: `include: { eSignEnvelope: true }` selects every envelope
  // scalar, including the executed-artifact columns that do not exist while
  // migrations 20261014/20261015 are unapplied.
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, buyerId: buyer.id },
    select: { id: true, eSignEnvelope: { select: { id: true, status: true, documentKey: true } } },
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
      "Your signed contract isn't available yet. It will be accessible once you've completed signing.",
      404
    );
  }

  // The EXECUTED contract artifact (§4) — generated in-house from the pinned,
  // hashed contract + the buyer's signature/consent evidence. Prefer it; fall
  // back to the legacy DocuSign documentKey only for pre-cutover historical
  // envelopes. Null on both means finalization hasn't completed yet.
  // executed_document_key only exists once migrations 20261014/20261015 are
  // applied and the gate is opened. While it is closed no executed artifact can
  // exist, so fall back to the legacy DocuSign documentKey alone.
  const executedDocumentKey = isExecutedArtifactEnabled()
    ? (
        await prisma.eSignEnvelope.findUnique({
          where: { id: deal.eSignEnvelope.id },
          select: { executedDocumentKey: true },
        })
      )?.executedDocumentKey ?? null
    : null;
  const executedKey = executedDocumentKey ?? deal.eSignEnvelope.documentKey;
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
