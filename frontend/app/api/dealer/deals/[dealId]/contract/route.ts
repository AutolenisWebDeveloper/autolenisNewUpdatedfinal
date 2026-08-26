// GET /api/dealer/deals/[dealId]/contract
// Role-scoped access to the EXECUTED purchase contract for a dealer's own deal
// (§6). The buyer signs; the dealer receives a copy. Authorization is modeled on
// the buyer contract-download route: the deal is resolved ONLY through the
// dealer's own offer (offer.dealerId === dealer.id), so a dealer can never reach
// another dealer's executed contract (IDOR-safe — a mismatched dealId returns 404,
// never another dealer's document). The artifact is served via a short-lived
// signed URL; the storage path is never exposed.
import { NextRequest, NextResponse } from "next/server";
import { getRequestDealer, errorResponse } from "@/lib/auth/dealer-api";
import { prisma } from "@/lib/prisma";
import { getExecutedContractUrl } from "@/lib/services/esign/executed-contract.service";

interface Props { params: Promise<{ dealId: string }> }

export async function GET(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  // Ownership gate: only a deal whose winning offer belongs to THIS dealer.
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, offer: { dealerId: dealer.id } },
    select: { id: true, eSignEnvelope: { select: { status: true, executedDocumentKey: true } } },
  });
  if (!deal) return errorResponse("NOT_FOUND", "Deal not found", 404);

  const envelope = deal.eSignEnvelope;
  if (!envelope || envelope.status !== "COMPLETED" || !envelope.executedDocumentKey) {
    return errorResponse(
      "NOT_AVAILABLE",
      "The executed contract is not available yet. It will appear here once the buyer has signed.",
      404,
    );
  }

  const url = await getExecutedContractUrl(envelope.executedDocumentKey, 900);
  if (!url) return errorResponse("STORAGE_ERROR", "Could not generate a download link. Please try again.", 500);
  return NextResponse.redirect(url);
}
