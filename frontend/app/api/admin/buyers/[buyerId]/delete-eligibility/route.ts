// GET /api/admin/buyers/[buyerId]/delete-eligibility
// Returns deletion eligibility assessment for a buyer profile.
// Checks for active deals, auctions, payment records, compliance records, and retention requirements.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { evaluateBuyerDeletionEligibility } from "@/lib/services/admin/admin-buyer-command-center.service";

interface Props { params: Promise<{ buyerId: string }> }

export async function GET(request: NextRequest, { params }: Props) {
  const { buyerId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId }, select: { id: true } });
  if (!buyer) return adminError("NOT_FOUND", "Buyer not found", 404);

  const eligibility = await evaluateBuyerDeletionEligibility(buyerId);
  return adminSuccess(eligibility);
}
