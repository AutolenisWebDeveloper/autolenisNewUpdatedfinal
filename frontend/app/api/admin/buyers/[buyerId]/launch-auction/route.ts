import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminError, adminSuccess } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { AUCTION_DURATION_HOURS, DEPOSIT_AMOUNT_CENTS } from "@/lib/constants";
import { createAuction, launchAuction, resolveOwnedVehicleRequestId } from "@/lib/services/auction/auction.service";
import {
  sendDealerAuctionInvitationEmail,
  sendAuctionActivatedEmail,
} from "@/lib/services/email/resend.service";
import { syncBuyerLifecycleToCrm } from "@/lib/services/admin/buyer-crm-sync";
import {
  mintOutsideInvites,
  autoMintOutsideInvitesFromSourcing,
  MAX_OUTSIDE_INVITES,
  type MintedInvite,
} from "@/lib/services/auction/outside-invite.service";
import { lookupZip, lookupCity } from "@/lib/utils/zip-coords";

interface Props { params: Promise<{ buyerId: string }> }

const outsideDealerSchema = z.object({
  dealershipName: z.string().min(1),
  contactName:    z.string().min(1),
  email:          z.string().email(),
  phone:          z.string().optional(),
});

const auctionVehicleSchema = z.object({
  inventoryItemId: z.string().min(1).optional(),
  year:    z.number().int().min(1900).max(2100).optional(),
  make:    z.string().min(1).optional(),
  model:   z.string().min(1).optional(),
  trim:    z.string().optional(),
  mileage: z.number().int().min(0).optional(),
  notes:   z.string().max(2000).optional(),
}).refine(
  v => v.inventoryItemId || (v.year && v.make && v.model),
  "Each vehicle needs an inventoryItemId or at minimum year+make+model",
);

const schema = z.object({
  dealerIds: z.array(z.string().min(1)).min(1, "At least one dealer is required"),
  reason: z.string().min(1, "Reason is required"),
  hours: z.number().int().positive().max(168).optional(),
  notes: z.string().max(2000).optional(),
  vehicleRequestId: z.string().min(1).optional(),
  outsideDealers: z.array(outsideDealerSchema).max(8).optional(),
  // C — when true, top up outside invites from resolved rooftop contacts near the
  // buyer (deduped against registered + explicit outside invites). Human-authorized
  // per launch; off by default so automated outreach stays opt-in.
  autoSourceOutside: z.boolean().optional(),
  vehicles: z.array(auctionVehicleSchema).max(10).optional(),
});

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

export async function POST(request: NextRequest, { params }: Props) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  if (!["SUPER_ADMIN", "OPERATIONS_ADMIN"].includes(admin.role)) {
    return adminError("FORBIDDEN", "SUPER_ADMIN or OPERATIONS_ADMIN required", 403);
  }

  const { buyerId } = await params;

  const buyer = await prisma.buyer.findUnique({
    where: { id: buyerId },
    select: {
      id: true,
      firstName: true,
      city: true,
      state: true,
      zip: true,
      user: { select: { email: true } },
    },
  });
  if (!buyer) return adminError("NOT_FOUND", "Buyer not found", 404);

  let body: unknown;
  try { body = await request.json(); } catch {
    return adminError("VALIDATION_ERROR", "Invalid JSON", 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }
  const { dealerIds, reason, hours, notes, vehicleRequestId, outsideDealers, autoSourceOutside, vehicles } = parsed.data;

  // Block if there is already a PENDING or ACTIVE auction for this buyer
  const openAuction = await prisma.auction.findFirst({
    where: { buyerId, status: { in: ["PENDING", "ACTIVE"] } },
    select: { id: true, status: true },
  });
  if (openAuction) {
    return adminError(
      "OPEN_AUCTION_EXISTS",
      `Buyer already has a ${openAuction.status} auction (${openAuction.id.slice(-8)})`,
      400
    );
  }

  // Validate dealers are ACTIVE and dedupe
  const dealers = await prisma.dealer.findMany({
    where: { id: { in: dealerIds }, status: "ACTIVE" },
    select: {
      id: true,
      dealershipName: true,
      user: { select: { email: true } },
    },
  });
  if (dealers.length === 0) {
    return adminError("NO_VALID_DEALERS", "No active dealers found in selection", 400);
  }

  // Find existing PAID deposit not linked to an auction, or create an admin-override one
  let deposit = await prisma.deposit.findFirst({
    where: { buyerId, status: "PAID", auction: null },
    select: { id: true },
  });
  if (!deposit) {
    deposit = await prisma.deposit.create({
      data: { buyerId, amountCents: DEPOSIT_AMOUNT_CENTS, status: "PAID" },
      select: { id: true },
    });
  }

  // Create and launch the auction via existing service functions. C1 — link the
  // originating VehicleRequest onto the auction, but only after confirming it
  // belongs to this buyer (never store a cross-buyer request id).
  const ownedVehicleRequestId = await resolveOwnedVehicleRequestId(buyerId, vehicleRequestId);
  const created = await createAuction(buyerId, deposit.id, ownedVehicleRequestId);
  const launched = await launchAuction(created.id);

  // Optional custom duration override
  let endsAt = launched.endsAt;
  if (hours && hours !== AUCTION_DURATION_HOURS && launched.startedAt) {
    const newEndsAt = new Date(launched.startedAt.getTime() + hours * 3600000);
    await prisma.auction.update({
      where: { id: launched.id },
      data: { endsAt: newEndsAt },
    });
    endsAt = newEndsAt;
  }

  // Batch-create dealer invitations
  await prisma.auctionInvitation.createMany({
    data: dealers.map(d => ({
      auctionId: launched.id,
      dealerId: d.id,
      sentAt: new Date(),
    })),
    skipDuplicates: true,
  });

  // Bump dealer load counters
  await prisma.dealer.updateMany({
    where: { id: { in: dealers.map(d => d.id) } },
    data: { currentAuctionLoad: { increment: 1 } },
  });

  // In-app notification for each dealer
  await prisma.notification.createMany({
    data: dealers.map(d => ({
      dealerId: d.id,
      type: "AUCTION_STARTED" as const,
      channel: "IN_APP" as const,
      title: "New auction invitation",
      body: `You've been invited to bid on auction ${launched.id.slice(-8)}. Submit your offer within ${hours ?? AUCTION_DURATION_HOURS} hours.`,
      actionUrl: `/dealer/auctions/${launched.id}`,
    })),
  }).catch(err => logger.error("[launch-auction] dealer notif failed:", err));

  // Buyer in-app notification
  await prisma.notification.create({
    data: {
      buyerId,
      type: "AUCTION_STARTED",
      channel: "IN_APP",
      title: "Your auction is live",
      body: `Your auction is active. Dealers are reviewing offers. Closes in ${hours ?? AUCTION_DURATION_HOURS} hours.`,
      actionUrl: `/buyer/auctions`,
    },
  }).catch(err => logger.error("[launch-auction] buyer notif failed:", err));

  // Update optional VehicleRequest status (non-blocking)
  if (vehicleRequestId) {
    prisma.vehicleRequest
      .updateMany({
        where: { id: vehicleRequestId, buyerId },
        data: { status: "ACTIVE_SOURCING" },
      })
      .catch(err => logger.error("[launch-auction] vehicleRequest update failed:", err));
  }

  // Attach auction vehicles (optional)
  let attachedVehicleCount = 0;
  if (vehicles && vehicles.length > 0) {
    const result = await prisma.auctionVehicle.createMany({
      data: vehicles.map(v => ({
        auctionId: launched.id,
        inventoryItemId: v.inventoryItemId ?? null,
        year:    v.year    ?? null,
        make:    v.make    ?? null,
        model:   v.model   ?? null,
        trim:    v.trim    ?? null,
        mileage: v.mileage ?? null,
        notes:   v.notes   ?? null,
      })),
    });
    attachedVehicleCount = result.count;
  }

  // Outside-dealer invitations (optional). Single mint path with rooftop dedup so
  // one physical rooftop is never invited twice (and never when its registered
  // dealer is already invited), and each token is returned reliably.
  let outsideInvites: MintedInvite[] = [];
  if (outsideDealers && outsideDealers.length > 0) {
    outsideInvites = await mintOutsideInvites(
      launched.id,
      outsideDealers.map(d => ({
        dealershipName: d.dealershipName,
        contactName:    d.contactName,
        email:          d.email,
        phone:          d.phone ?? null,
      })),
      undefined,
      { prisma },
    );
  }

  // Optionally top up from resolved rooftop contacts near the buyer, deduped
  // against the registered + explicit outside invites above. Fail-closed: skipped
  // when the buyer can't be placed (we never blindly invite far-away rooftops).
  if (autoSourceOutside) {
    const buyerCoords = lookupZip(buyer.zip ?? "") ?? lookupCity(buyer.city, buyer.state);
    if (buyerCoords) {
      const sourced = await autoMintOutsideInvitesFromSourcing(
        launched.id,
        { buyerCoords, max: Math.max(0, MAX_OUTSIDE_INVITES - outsideInvites.length) },
        { prisma },
      );
      outsideInvites = [...outsideInvites, ...sourced];
    } else {
      logger.warn(`[launch-auction] autoSourceOutside skipped — buyer ${buyerId} has no placeable location`);
    }
  }
  const outsideInviteCount = outsideInvites.length;

  // Dealer invitation emails (non-blocking).
  // Use the first attached auction vehicle so the email shows concrete make/
  // model/year instead of "Vehicle Requested" placeholders. Falls back to
  // current year only when no vehicle was attached at launch time.
  const buyerCity = buyer.city ?? "Location";
  const buyerState = buyer.state ?? "TBD";
  const primaryVehicle = vehicles?.[0];
  const emailVehicleYear = primaryVehicle?.year ?? new Date().getFullYear();
  const emailVehicleMake = primaryVehicle?.make ?? "Vehicle";
  const emailVehicleModel = primaryVehicle?.model ?? "Requested";
  const emailVehicleTrim = primaryVehicle?.trim ?? null;
  for (const d of dealers) {
    if (!d.user?.email) continue;
    void sendDealerAuctionInvitationEmail({
      to: d.user.email,
      contactName: d.dealershipName ?? "Dealer",
      vehicleMake: emailVehicleMake,
      vehicleModel: emailVehicleModel,
      vehicleYear: emailVehicleYear,
      vehicleTrim: emailVehicleTrim,
      buyerCity,
      buyerState,
      auctionUrl: `${APP_URL}/dealer/auctions/${launched.id}`,
      expiryHours: hours ?? AUCTION_DURATION_HOURS,
      auctionId: launched.id,
    }).catch(err => logger.error(`[launch-auction] dealer email failed (${d.id}):`, err));
  }

  // Outside-dealer invitation emails (non-blocking, public token-gated URL)
  for (const inv of outsideInvites) {
    void sendDealerAuctionInvitationEmail({
      to: inv.email,
      contactName: inv.contactName,
      vehicleMake: emailVehicleMake,
      vehicleModel: emailVehicleModel,
      vehicleYear: emailVehicleYear,
      vehicleTrim: emailVehicleTrim,
      buyerCity,
      buyerState,
      auctionUrl: `${APP_URL}/dealer-offer-outside/${inv.token}`,
      expiryHours: hours ?? AUCTION_DURATION_HOURS,
      auctionId: launched.id,
    }).catch(err => logger.error(`[launch-auction] outside dealer email failed (${inv.email}):`, err));
  }

  // Buyer activation email (non-blocking)
  if (buyer.user?.email) {
    void sendAuctionActivatedEmail(
      buyer.user.email,
      buyer.firstName ?? "there",
      launched.id
    ).catch(err => logger.error("[launch-auction] buyer email failed:", err));
  }

  // Audit log
  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "AUCTION_LAUNCHED_BY_ADMIN",
      entityType: "Auction",
      entityId: launched.id,
      reason,
      metadata: {
        buyerId,
        dealerIds: dealers.map(d => d.id),
        dealerCount: dealers.length,
        outsideDealerCount: outsideInviteCount,
        vehicleCount: attachedVehicleCount,
        hours: hours ?? AUCTION_DURATION_HOURS,
        notes: notes ?? null,
        // Record the RESOLVED (buyer-owned) id actually linked onto the auction,
        // not the raw input — so the audit trail and the FK never disagree.
        vehicleRequestId: ownedVehicleRequestId,
        depositId: deposit.id,
      },
    },
  }).catch(err => logger.error("[launch-auction] audit log failed:", err));

  // Buyer journey advances to auction_active — mirror onto the CRM contact.
  await syncBuyerLifecycleToCrm(
    buyerId,
    "auction_active",
    { adminId: admin.adminId, adminEmail: admin.email },
    buyer.user?.email,
  );

  return adminSuccess({
    auctionId: launched.id,
    status: launched.status,
    startedAt: launched.startedAt?.toISOString() ?? null,
    endsAt: endsAt?.toISOString() ?? null,
    dealerCount: dealers.length,
    invitedDealerIds: dealers.map(d => d.id),
    outsideDealerCount: outsideInviteCount,
    vehicleCount: attachedVehicleCount,
  });
}
