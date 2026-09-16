import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { LEGACY_ENVELOPE_SELECT } from "@/lib/services/esign/esign-schema-gate";
import { PICKUP_SAFE_SELECT } from "@/lib/services/pickup/pickup-select";

interface Props { params: Promise<{ dealId: string }> }

export async function GET(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: { buyer: { include: { user: true } }, offer: { include: { dealer: { include: { user: true } } } }, contractScans: true, eSignEnvelopes: { select: LEGACY_ENVELOPE_SELECT }, pickup: { select: PICKUP_SAFE_SELECT } },
  });
  if (!deal) return adminError("NOT_FOUND", "Deal not found", 404);
  return adminSuccess({ deal });
}
