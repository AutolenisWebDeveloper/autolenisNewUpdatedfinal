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

// POST is intentionally NOT implemented on this buyer route.
//
// It previously let ANY authenticated buyer trigger a Contract Shield scan on
// their own deal, in two ways that both broke the integrity of the review:
//
//   1. With no body it persisted a fabricated PASS (score 88) as a real
//      ContractScan row AND wrote contractShieldScore/contractShieldStatus onto
//      the deal. Contract Shield PASS is the hard gate for signing
//      (prepareBuyerSigningEnvelope requires CONTRACT_APPROVED, and the journey
//      machine treats a PASS as reaching the "sign" stage), so a buyer could
//      self-approve their own contract review with one unauthenticated-shaped
//      POST and advance their own deal.
//   2. With a body it scanned buyer-supplied `contractText` as though it were
//      the dealer's contract — the buyer choosing the document their own review
//      is performed against.
//
// Nothing in the buyer UI ever called it: /buyer/contract-shield renders the
// latest scan read-only. It was a zero-caller endpoint and a live escalation
// path, so it is removed rather than patched.
//
// Scanning stays where it belongs — on the dealer's real uploaded contract,
// through the canonical path: dealer upload -> scanContractVersion() (which
// extracts the actual PDF text) -> app/api/cron/contract-shield sweeps
// unscanned versions -> admin reviews at /api/admin/contract-shield/[reviewId].
// A buyer never selects the document, and no mock result is ever persisted.
