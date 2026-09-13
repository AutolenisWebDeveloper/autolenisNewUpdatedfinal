// app/api/admin/offers/route.ts — Step 8 (Required: agent file review target)
// Admin RBAC enforced at both proxy.ts and handler level
// All business logic in offer.service.ts
// Zod validation on all inputs
// Standard response shape: { success, data } / { error, correlationId }

import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { getOffersForAuction, submitOffer } from "@/lib/services/offer/offer.service";
import { getOrCreateOutsideDealerId } from "@/lib/services/offer/outside-dealer";
import { sendOutsideDealerAuctionOfferAdminNotification } from "@/lib/services/email/vehicle-offers.email";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { feeItemsSchema } from "@/lib/services/offer/junk-fee-items";

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

// Shared price/financing fields for both registered and outside paths.
const offerPriceFields = {
  otdPriceCents:     z.number().int().positive(),
  vehiclePriceCents: z.number().int().positive(),
  taxCents:          z.number().int().min(0).default(0),
  feesCents:         z.number().int().min(0).default(0),
  // Was `{ label, amount }` — a shape no other writer used and no reader understood, which is
  // why `otd.ts` printed `undefined` when rejecting a negative admin fee. The shared schema keeps
  // accepting `label` so existing callers are not broken, and normalisation maps it to `name`.
  junkFeeItems:      feeItemsSchema.default([]),
  includesFinancing: z.boolean().default(false),
  aprRate:           z.number().positive().optional(),
  termMonths:        z.number().int().positive().optional(),
  // §8c candidate binding. Optional here because a custom request has no candidates; when the
  // auction HAS active candidates `submitOffer` refuses an offer that names none.
  auctionVehicleId:  z.string().min(1).optional(),
  reason:            z.string().min(1),
};

// Admin can submit on behalf of EITHER a registered dealer (dealerId) OR an
// outside/unregistered dealer (name + email).
const offerCreateSchema = z.union([
  z.object({
    auctionId: z.string().min(1),
    dealerId:  z.string().min(1),
    ...offerPriceFields,
  }),
  z.object({
    auctionId:          z.string().min(1),
    outsideDealerName:  z.string().min(1),
    outsideDealerEmail: z.string().email(),
    outsideDealerPhone: z.string().optional(),
    ...offerPriceFields,
  }),
]);

// POST /api/admin/offers — admin submits offer on behalf of a registered OR
// outside/unregistered dealer.
export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin?.mfaVerified) return adminError("UNAUTHORIZED", "Admin authentication required", 401);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }

  // Give a clear error when the caller picked neither path, rather than a
  // cryptic zod union message.
  if (body && typeof body === "object" && !("dealerId" in body) && !("outsideDealerName" in body)) {
    return adminError("VALIDATION_ERROR", "Provide either dealerId (registered dealer) or outsideDealerName + outsideDealerEmail (outside dealer).", 400);
  }

  const parsed = offerCreateSchema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const data = parsed.data;
  const { auctionId, otdPriceCents, vehiclePriceCents, taxCents, feesCents, junkFeeItems, includesFinancing, aprRate, termMonths, reason } = data;
  const isOutside = "outsideDealerName" in data;

  // §8.2 Phase 6 defect (2). This route accepted `PENDING` auctions — an auction that has not
  // launched, whose dealers have not been invited — and never checked `endsAt` at all, so an
  // administrator could enter an offer on an auction that closed days earlier. `submitOffer`
  // enforces ACTIVE and unexpired for both paths below; the check is left here too so the refusal
  // carries an admin-shaped error rather than a thrown string.
  const auction = await prisma.auction.findUnique({ where: { id: auctionId } });
  if (!auction || auction.status !== "ACTIVE") {
    return adminError("AUCTION_NOT_ACTIVE", "Auction is not ACTIVE — offers cannot be entered against it.", 400);
  }

  // ── Registered dealer path ───────────────────────────────────────────────
  if (!isOutside) {
    const { dealerId } = data;
    const dealer = await prisma.dealer.findUnique({ where: { id: dealerId } });
    if (!dealer) return adminError("DEALER_NOT_FOUND", "Dealer not found", 404);

    let offer;
    try {
      offer = await submitOffer({
        auctionId,
        dealerId,
        otdPriceCents,
        vehiclePriceCents,
        taxCents,
        feesCents,
        junkFeeItems,
        includesFinancing,
        aprRate: aprRate ?? undefined,
        termMonths: termMonths ?? undefined,
        auctionVehicleId: data.auctionVehicleId ?? null,
        submittedByAdminId: admin.adminId,
        // Staff intake: an offer that arrived by phone or email has no invitation row. Narrow,
        // audited below, and every other validation still applies.
        allowWithoutInvitation: true,
      });
    } catch (err) {
      return adminError("OFFER_REJECTED", err instanceof Error ? err.message : "Offer rejected", 400);
    }

    await prisma.adminAuditLog.create({
      data: {
        adminId: admin.adminId,
        adminEmail: admin.email,
        action: "OFFER_SUBMITTED_BY_ADMIN",
        entityType: "Offer",
        entityId: offer.id,
        reason,
        metadata: { auctionId, dealerId, otdPriceCents, onBehalfOf: "registered_dealer" },
      },
    });

    return adminSuccess({ offer: { id: offer.id, auctionId, dealerId, otdPriceCents, status: offer.status } }, 201);
  }

  // ── Outside / unregistered dealer path ───────────────────────────────────
  const { outsideDealerName, outsideDealerEmail, outsideDealerPhone } = data;
  const outsideDealerId = await getOrCreateOutsideDealerId();

  let outsideOffer;
  try {
    outsideOffer = await submitOffer({
      auctionId,
      dealerId: outsideDealerId,
      otdPriceCents,
      vehiclePriceCents,
      taxCents,
      feesCents,
      junkFeeItems,
      includesFinancing,
      aprRate: aprRate ?? undefined,
      termMonths: termMonths ?? undefined,
      auctionVehicleId: data.auctionVehicleId ?? null,
      submittedByAdminId: admin.adminId,
      // The outside dealership's identity. `submitOffer` keys its per-rooftop caps on this when
      // there is no rooftop, because every outside offer shares ONE placeholder dealer id — so
      // without it the second outside dealership on an auction would be refused as a duplicate of
      // the first, which is the normal case for an outside-invite auction.
      externalDealerName: outsideDealerName,
      externalDealerEmail: outsideDealerEmail,
      externalDealerPhone: outsideDealerPhone ?? null,
      allowWithoutInvitation: true,
    });
  } catch (err) {
    return adminError("OFFER_REJECTED", err instanceof Error ? err.message : "Offer rejected", 400);
  }

  const offer = await prisma.$transaction(async (tx) => {
    const created = await tx.offer.findUniqueOrThrow({ where: { id: outsideOffer.id } });

    // Look up or create an outsideAuctionInvite for this dealer/auction combo
    // and link it to the created offer for a complete audit trail.
    const existingInvite = await tx.outsideAuctionInvite.findFirst({
      where: { auctionId, email: outsideDealerEmail },
    });
    if (existingInvite) {
      await tx.outsideAuctionInvite.update({
        where: { id: existingInvite.id },
        data: {
          respondedAt: existingInvite.respondedAt ?? new Date(),
          offerOtdCents: otdPriceCents,
          offerVehicleCents: vehiclePriceCents,
          offerTaxCents: taxCents,
          offerFeesCents: feesCents,
          offerId: created.id,
        },
      });
    } else {
      await tx.outsideAuctionInvite.create({
        data: {
          auctionId,
          dealershipName: outsideDealerName,
          contactName: outsideDealerName,
          email: outsideDealerEmail,
          phone: outsideDealerPhone ?? null,
          respondedAt: new Date(),
          offerOtdCents: otdPriceCents,
          offerVehicleCents: vehiclePriceCents,
          offerTaxCents: taxCents,
          offerFeesCents: feesCents,
          offerId: created.id,
        },
      });
    }

    return created;
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "OFFER_SUBMITTED_BY_ADMIN",
      entityType: "Offer",
      entityId: offer.id,
      reason,
      metadata: { auctionId, otdPriceCents, onBehalfOf: "outside_dealer", outsideDealerName, outsideDealerEmail },
    },
  });

  await sendOutsideDealerAuctionOfferAdminNotification({
    auctionId,
    offerId: offer.id,
    dealershipName: outsideDealerName,
    contactName: outsideDealerName,
    contactEmail: outsideDealerEmail,
    contactPhone: outsideDealerPhone ?? null,
    otdPriceCents,
    source: "admin_manual",
  }).catch((e) => logger.error("[admin/offers] outside dealer admin notification failed:", e));

  return adminSuccess({ offer: { id: offer.id, auctionId, otdPriceCents, status: offer.status, outsideDealerName } }, 201);
}
