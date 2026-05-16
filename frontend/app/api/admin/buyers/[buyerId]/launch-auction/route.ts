import { NextRequest } from "next/server";
import { getAdminFromRequest, adminError, adminSuccess } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { AUCTION_DURATION_HOURS, DEPOSIT_AMOUNT_CENTS } from "@/lib/constants";
import { createAuction, launchAuction } from "@/lib/services/auction/auction.service";
import {
  sendDealerAuctionInvitationEmail,
  sendAuctionActivatedEmail,
} from "@/lib/services/email/resend.service";

interface Props { params: Promise<{ buyerId: string }> }

const schema = z.object({
  dealerIds: z.array(z.string().min(1)).min(1, "At least one dealer is required"),
  reason: z.string().min(1, "Reason is required"),
  hours: z.number().int().positive().max(168).optional(),
  notes: z.string().max(2000).optional(),
  vehicleRequestId: z.string().min(1).optional(),
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
  const { dealerIds, reason, hours, notes, vehicleRequestId } = parsed.data;

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

  // Create and launch the auction via existing service functions
  const created = await createAuction(buyerId, deposit.id);
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
  }).catch(err => console.error("[launch-auction] dealer notif failed:", err));

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
  }).catch(err => console.error("[launch-auction] buyer notif failed:", err));

  // Update optional VehicleRequest status (non-blocking)
  if (vehicleRequestId) {
    prisma.vehicleRequest
      .updateMany({
        where: { id: vehicleRequestId, buyerId },
        data: { status: "ACTIVE_SOURCING" },
      })
      .catch(err => console.error("[launch-auction] vehicleRequest update failed:", err));
  }

  // Dealer invitation emails (non-blocking)
  const buyerCity = buyer.city ?? "Location";
  const buyerState = buyer.state ?? "TBD";
  for (const d of dealers) {
    if (!d.user?.email) continue;
    void sendDealerAuctionInvitationEmail({
      to: d.user.email,
      contactName: d.dealershipName ?? "Dealer",
      vehicleMake: "Vehicle",
      vehicleModel: "Requested",
      vehicleYear: new Date().getFullYear(),
      vehicleTrim: null,
      buyerCity,
      buyerState,
      auctionUrl: `${APP_URL}/dealer/auctions/${launched.id}`,
      expiryHours: hours ?? AUCTION_DURATION_HOURS,
      auctionId: launched.id,
    }).catch(err => console.error(`[launch-auction] dealer email failed (${d.id}):`, err));
  }

  // Buyer activation email (non-blocking)
  if (buyer.user?.email) {
    void sendAuctionActivatedEmail(
      buyer.user.email,
      buyer.firstName ?? "there",
      launched.id
    ).catch(err => console.error("[launch-auction] buyer email failed:", err));
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
        hours: hours ?? AUCTION_DURATION_HOURS,
        notes: notes ?? null,
        vehicleRequestId: vehicleRequestId ?? null,
        depositId: deposit.id,
      },
    },
  }).catch(err => console.error("[launch-auction] audit log failed:", err));

  return adminSuccess({
    auctionId: launched.id,
    status: launched.status,
    startedAt: launched.startedAt?.toISOString() ?? null,
    endsAt: endsAt?.toISOString() ?? null,
    dealerCount: dealers.length,
    invitedDealerIds: dealers.map(d => d.id),
  });
}
