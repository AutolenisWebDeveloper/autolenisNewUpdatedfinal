// POST /api/admin/deals/[dealId]/esign/send
// Triggers DocuSign envelope creation for a deal
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { createEnvelope } from "@/lib/services/esign/esign.service";

interface Props { params: Promise<{ dealId: string }> }

export async function POST(request: NextRequest, { params }: Props) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { dealId } = await params;
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: { buyer: { include: { user: true } } },
  });
  if (!deal) return adminError("NOT_FOUND", "Deal not found", 404);

  const signerEmail = deal.buyer.user.email;
  const signerName = `${deal.buyer.firstName} ${deal.buyer.lastName}`;

  const result = await createEnvelope(dealId, signerEmail, signerName);

  return adminSuccess({
    envelopeId: result.envelopeId,
    signingUrl: result.signingUrl,
    isMock: result.isMock,
    error: result.error ?? null,
  });
}
