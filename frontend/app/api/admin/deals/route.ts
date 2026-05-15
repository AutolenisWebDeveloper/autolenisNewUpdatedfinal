import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  const deals = await prisma.deal.findMany({
    include: { buyer: { select: { firstName: true, lastName: true } }, offer: { include: { dealer: { select: { dealershipName: true } } } } },
    orderBy: { createdAt: "desc" }, take: 100,
  });
  return adminSuccess({ deals });
}

const createSchema = z.object({
  offerId:  z.string().min(1),
  buyerId:  z.string().min(1),
  reason:   z.string().min(1),
});

// POST /api/admin/deals — admin creates deal from winning offer
export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const { offerId, buyerId, reason } = parsed.data;

  const offer = await prisma.offer.findFirst({ where: { id: offerId, status: { in: ["SUBMITTED", "ACCEPTED"] } } });
  if (!offer) return adminError("OFFER_NOT_FOUND", "Offer not found or not submitted", 404);

  // Check offer not already in a deal
  const existingDeal = await prisma.deal.findFirst({ where: { offerId } });
  if (existingDeal) return adminError("DEAL_EXISTS", "A deal already exists for this offer", 400);

  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId } });
  if (!buyer) return adminError("NOT_FOUND", "Buyer not found", 404);

  const deal = await prisma.deal.create({
    data: { buyerId, offerId, status: "ACTIVE" },
  });

  // Mark offer as accepted
  await prisma.offer.update({ where: { id: offerId }, data: { status: "ACCEPTED" } });

  // Notify buyer
  await prisma.notification.create({
    data: {
      buyerId,
      type: "DEAL_STAGE_CHANGED",
      channel: "IN_APP",
      title: "Your deal has been created",
      body: "Congratulations! Admin has matched you with a dealer. Check your deal details.",
      actionUrl: "/buyer/deal",
    },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "DEAL_CREATED",
      entityType: "Deal",
      entityId: deal.id,
      reason,
      metadata: { buyerId, offerId, dealerId: offer.dealerId },
    },
  });

  return adminSuccess({ deal: { id: deal.id, buyerId, offerId, status: deal.status } }, 201);
}

