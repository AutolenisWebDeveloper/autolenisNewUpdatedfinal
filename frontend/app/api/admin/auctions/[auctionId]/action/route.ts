import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { AUCTION_DURATION_HOURS } from "@/lib/constants";
import { sendDealerAuctionInvitationEmail } from "@/lib/services/email/resend.service";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();
interface Props { params: Promise<{ auctionId: string }> }

export async function POST(request: NextRequest, { params }: Props) {
  const { auctionId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  if (!["SUPER_ADMIN", "OPERATIONS_ADMIN"].includes(admin.role)) {
    return adminError("FORBIDDEN", "Insufficient permissions — OPERATIONS_ADMIN or SUPER_ADMIN required", 403);
  }

  const { action, reason, hours, dealerId } = await request.json() as {
    action: string; reason: string; hours?: number; dealerId?: string;
  };

  if (!reason?.trim()) return adminError("REASON_REQUIRED", "Reason is required", 400);

  const auction = await prisma.auction.findUnique({ where: { id: auctionId }, include: { deposit: true } });
  if (!auction) return adminError("NOT_FOUND", "Auction not found", 404);

  let result: Record<string, unknown> = {};

  switch (action) {
    case "AUCTION_CLOSED": {
      await prisma.auction.update({ where: { id: auctionId }, data: { status: "CLOSED", closedAt: new Date() } });
      result = { closed: true };
      break;
    }
    case "AUCTION_EXTENDED": {
      const addHours = hours ?? 24;
      const currentEnd = auction.endsAt ?? new Date();
      const newEnd = new Date(currentEnd.getTime() + addHours * 3600000);
      await prisma.auction.update({
        where: { id: auctionId },
        data: { endsAt: newEnd, extendedAt: new Date(), extendedBy: admin.adminId, extendReason: reason },
      });
      result = { newEndsAt: newEnd.toISOString() };
      break;
    }
    case "DEALER_REMOVED": {
      if (!dealerId) return adminError("DEALER_ID_REQUIRED", "dealerId is required", 400);
      await prisma.auctionInvitation.deleteMany({ where: { auctionId, dealerId } });
      result = { dealerRemoved: dealerId };
      break;
    }
    case "DEALER_INVITED": {
      if (!dealerId) return adminError("DEALER_ID_REQUIRED", "dealerId is required", 400);
      const dealer = await prisma.dealer.findUnique({ where: { id: dealerId }, include: { user: true } });
      if (!dealer) return adminError("DEALER_NOT_FOUND", "Dealer not found", 404);

      // Idempotent — skip if invitation already exists
      const existing = await prisma.auctionInvitation.findFirst({ where: { auctionId, dealerId } });
      if (!existing) {
        await prisma.auctionInvitation.create({
          data: { auctionId, dealerId, sentAt: new Date() },
        });
      }
      // In-app notification
      await prisma.notification.create({
        data: {
          dealerId,
          type: "AUCTION_STARTED",
          channel: "IN_APP",
          title: "New auction invitation",
          body: `You've been invited to bid on auction ${auctionId.slice(0, 8)}. Review and submit your offer.`,
        },
      });

      // Invitation email — populated with buyer location and the first
      // attached auction vehicle (falls back to placeholders if none yet).
      if (dealer.user?.email) {
        const [buyer, vehicle] = await Promise.all([
          prisma.buyer.findUnique({ where: { id: auction.buyerId }, select: { city: true, state: true } }),
          prisma.auctionVehicle.findFirst({ where: { auctionId }, orderBy: { createdAt: "asc" } }),
        ]);
        const expiryHours = auction.endsAt
          ? Math.max(1, Math.round((auction.endsAt.getTime() - Date.now()) / 3600000))
          : AUCTION_DURATION_HOURS;
        void sendDealerAuctionInvitationEmail({
          to: dealer.user.email,
          contactName: dealer.dealershipName ?? "Dealer",
          vehicleMake: vehicle?.make ?? "Vehicle",
          vehicleModel: vehicle?.model ?? "Requested",
          vehicleYear: vehicle?.year ?? new Date().getFullYear(),
          vehicleTrim: vehicle?.trim ?? null,
          buyerCity: buyer?.city ?? "Location",
          buyerState: buyer?.state ?? "TBD",
          auctionUrl: `${APP_URL}/dealer/auctions/${auctionId}`,
          expiryHours,
          auctionId,
        }).catch(err => console.error(`[auctions/action] dealer invite email failed (${dealerId}):`, err));
      }

      result = { dealerInvited: dealerId, auctionId };
      break;
    }
    case "AUCTION_REFUND_TRIGGERED": {
      // Only trigger if no offers received
      const offerCount = await prisma.offer.count({ where: { auctionId, status: "SUBMITTED" } });
      if (offerCount > 0) return adminError("HAS_OFFERS", "Cannot refund — auction has submitted offers", 400);

      if (auction.deposit?.stripePaymentIntentId) {
        try {
          await getStripe().refunds.create({ payment_intent: auction.deposit.stripePaymentIntentId });
          await prisma.deposit.update({ where: { id: auction.deposit.id }, data: { status: "REFUNDED", refundedAt: new Date() } });
        } catch (err) {
          return adminError("STRIPE_ERROR", `Refund failed: ${err}`, 500);
        }
      }

      await prisma.auction.update({ where: { id: auctionId }, data: { status: "CANCELLED" } });
      result = { refunded: true };
      break;
    }
    case "AUCTION_REOPENED": {
      // Only allow re-opening CLOSED or EXPIRED auctions — not CANCELLED
      if (!["CLOSED", "EXPIRED"].includes(auction.status)) {
        return adminError("INVALID_STATE", "Only CLOSED or EXPIRED auctions can be reopened", 400);
      }
      const newEndsAt = new Date(Date.now() + AUCTION_DURATION_HOURS * 3600000);
      await prisma.auction.update({
        where: { id: auctionId },
        data: { status: "REOPENED", endsAt: newEndsAt },
      });
      result = { newStatus: "REOPENED", newEndsAt: newEndsAt.toISOString() };
      break;
    }
    default:
      return adminError("UNKNOWN_ACTION", "Unknown action", 400);
  }

  // Log every action to AdminAuditLog
  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action,
      entityType: "Auction",
      entityId: auctionId,
      reason,
      metadata: JSON.parse(JSON.stringify(result)),
    },
  });

  return adminSuccess(result);
}
