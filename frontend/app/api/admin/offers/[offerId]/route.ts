import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";

interface Props { params: Promise<{ offerId: string }> }

export async function GET(request: NextRequest, { params }: Props) {
  const { offerId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  const offer = await prisma.offer.findUnique({ where: { id: offerId }, include: { dealer: { include: { user: true } }, auction: { include: { buyer: true } } } });
  if (!offer) return adminError("NOT_FOUND", "Offer not found", 404);
  return adminSuccess({ offer });
}
