// Buyer-facing Contract Shield surface — READ ONLY.
//
// Contract Shield is the compliance gate that stands between the buyer and a
// signable contract, so the buyer must never be able to write its verdict. A
// mutating POST used to live here: it accepted a buyer-supplied `contractText`,
// handed it to scanContract() — which writes the authoritative ContractScan,
// overwrites deal.contractShieldScore/contractShieldStatus, and then calls
// autoAdvanceContractOnPass() to walk the deal CONTRACT_PENDING → CONTRACT_REVIEW →
// CONTRACT_APPROVED — and, with no body at all, wrote a mock PASS (score 88)
// straight onto the deal. Either way a buyer could approve their own contract and
// make the deal signable without the dealer's real document ever being scanned.
// It had zero callers. Removed.
//
// Scans are produced only by the dealer contract upload
// (lib/services/dealer/dealer-contract.service.ts, which scans the stored PDF) and
// by admin review (app/api/admin/contract-shield/**).
import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";

interface Props { params: Promise<{ dealId: string }> }

export async function GET(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  const deal = await prisma.deal.findFirst({ where: { id: dealId, buyerId: buyer.id }, include: { contractScans: { orderBy: { scannedAt: "desc" }, take: 1 } } });
  if (!deal) return errorResponse("NOT_FOUND", "Deal not found", 404);
  const scan = deal.contractScans[0];
  return successResponse({
    score: scan?.score ?? null,
    status: scan?.status ?? null,
    fixList: scan?.fixList ?? [],
    hasContract: !!scan,
    dealId,
  });
}
