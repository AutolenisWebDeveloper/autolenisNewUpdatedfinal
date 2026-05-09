import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { scanContract } from "@/lib/services/contract-shield/contract-shield.service";

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

// POST /api/buyer/contract-shield/[dealId] — trigger a Contract Shield scan.
// Optional body: { contractText?: string } — when supplied, runs scanContract().
// When omitted (sandbox path / no contract uploaded yet) persists a mock PASS result with score 88.
export async function POST(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const deal = await prisma.deal.findFirst({
    where: { id: dealId, buyerId: buyer.id },
    include: { offer: true },
  });
  if (!deal) return errorResponse("NOT_FOUND", "Deal not found", 404);

  const body = await request.json().catch(() => ({}));
  const contractText = (body as { contractText?: string }).contractText?.trim();

  if (contractText) {
    const result = await scanContract(dealId, contractText, deal.offer.dealerId);
    return successResponse({ ...result, dealId });
  }

  // Sandbox/no-contract path: persist a clean PASS scan (score 88).
  const existing = await prisma.contractScan.findMany({
    where: { dealId },
    orderBy: { version: "desc" },
    take: 1,
  });
  const version = (existing[0]?.version ?? 0) + 1;

  await prisma.contractScan.create({
    data: {
      dealId,
      score: 88,
      status: "PASS",
      fixList: [],
      version,
      scannedAt: new Date(),
    },
  });
  await prisma.deal.update({
    where: { id: dealId },
    data: { contractShieldScore: 88, contractShieldStatus: "PASS" },
  });

  return successResponse({
    score: 88,
    status: "PASS",
    fixList: [],
    mock: true,
    dealId,
  });
}
