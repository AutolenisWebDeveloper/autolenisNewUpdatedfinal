// app/api/admin/offers/route.ts — Step 8 (Required: agent file review target)
// Admin RBAC enforced at both proxy.ts and handler level
// All business logic in offer.service.ts
// Zod validation on all inputs
// Standard response shape: { success, data } / { error, correlationId }

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { getOffersForAuction } from "@/lib/services/offer/offer.service";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const querySchema = z.object({
  auctionId: z.string().optional(),
  dealerId: z.string().optional(),
  status: z.enum(["DRAFT", "SUBMITTED", "ACCEPTED", "DECLINED", "WITHDRAWN", "EXPIRED"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

// GET /api/admin/offers — list all offers with RBAC
// proxy.ts ensures admin auth; handler double-checks mfaVerified
export async function GET(request: NextRequest) {
  // RBAC: admin-only, mfa verified
  const admin = await getAdminFromRequest(request);
  if (!admin?.mfaVerified) return adminError("UNAUTHORIZED", "Admin authentication required", 401);

  const { searchParams } = new URL(request.url);
  const queryParsed = querySchema.safeParse(Object.fromEntries(searchParams));
  if (!queryParsed.success) return adminError("VALIDATION_ERROR", queryParsed.error.message, 400);

  const { auctionId, dealerId, status, limit, cursor } = queryParsed.data;

  const where: Record<string, unknown> = {};
  if (auctionId) where.auctionId = auctionId;
  if (dealerId) where.dealerId = dealerId;
  if (status) where.status = status;

  // All business logic via offer.service.ts (compliance with architecture rule)
  if (auctionId && !dealerId && !status) {
    const offers = await getOffersForAuction(auctionId);
    return adminSuccess({ offers, count: offers.length });
  }

  const offers = await prisma.offer.findMany({
    where,
    include: {
      dealer: { select: { id: true, dealershipName: true, tier: true, user: { select: { email: true } } } },
      auction: { select: { id: true, status: true, buyer: { select: { firstName: true, lastName: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  return adminSuccess({
    offers,
    count: offers.length,
    nextCursor: offers.length === limit ? offers[offers.length - 1]?.id : null,
  });
}

const offerCreateSchema = z.object({
  auctionId:         z.string().min(1),
  dealerId:          z.string().min(1),
  otdPriceCents:     z.number().int().positive(),
  vehiclePriceCents: z.number().int().positive(),
  taxCents:          z.number().int().min(0).default(0),
  feesCents:         z.number().int().min(0).default(0),
  junkFeeItems:      z.array(z.object({ label: z.string(), amount: z.number().int() })).default([]),
  includesFinancing: z.boolean().default(false),
  aprRate:           z.number().positive().optional(),
  termMonths:        z.number().int().positive().optional(),
  reason:            z.string().min(1),
});

// POST /api/admin/offers — admin submits offer on behalf of dealer
export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin?.mfaVerified) return adminError("UNAUTHORIZED", "Admin authentication required", 401);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = offerCreateSchema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const { auctionId, dealerId, otdPriceCents, vehiclePriceCents, taxCents, feesCents, junkFeeItems, includesFinancing, aprRate, termMonths, reason } = parsed.data;

  const auction = await prisma.auction.findUnique({ where: { id: auctionId } });
  if (!auction || !["ACTIVE", "PENDING"].includes(auction.status)) {
    return adminError("AUCTION_NOT_ACTIVE", "Auction is not active", 400);
  }

  const dealer = await prisma.dealer.findUnique({ where: { id: dealerId } });
  if (!dealer) return adminError("DEALER_NOT_FOUND", "Dealer not found", 404);

  const offer = await prisma.offer.create({
    data: {
      auctionId,
      dealerId,
      status: "SUBMITTED",
      otdPriceCents,
      vehiclePriceCents,
      taxCents,
      feesCents,
      junkFeeItems,
      includesFinancing,
      aprRate: aprRate ?? null,
      termMonths: termMonths ?? null,
      submittedAt: new Date(),
    },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "OFFER_SUBMITTED_BY_ADMIN",
      entityType: "Offer",
      entityId: offer.id,
      reason,
      metadata: { auctionId, dealerId, otdPriceCents },
    },
  });

  return adminSuccess({ offer: { id: offer.id, auctionId, dealerId, otdPriceCents, status: offer.status } }, 201);
}
