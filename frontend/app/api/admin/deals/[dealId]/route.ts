import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";

interface Props { params: Promise<{ dealId: string }> }

export async function GET(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: { buyer: { include: { user: true } }, offer: { include: { dealer: { include: { user: true } } } }, contractScans: true, eSignEnvelope: true, pickup: true },
  });
  if (!deal) return adminError("NOT_FOUND", "Deal not found", 404);
  return adminSuccess({ deal });
}
