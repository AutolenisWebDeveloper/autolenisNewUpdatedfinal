import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminError, adminSuccess } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { AUCTION_DURATION_HOURS } from "@/lib/constants";
import { sendDealerAuctionInvitationEmail } from "@/lib/services/email/resend.service";
import { mintOutsideInvites } from "@/lib/services/auction/outside-invite.service";

interface Props { params: Promise<{ buyerId: string }> }

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

const schema = z.object({
  auctionId: z.string().min(1),
  hours: z.number().int().positive().max(168).optional(),
  dealers: z.array(z.object({
    dealershipName: z.string().min(1, "Dealership name required"),
    contactName:    z.string().min(1, "Contact name required"),
    email:          z.string().email("Valid email required"),
    phone:          z.string().optional(),
  })).min(1, "At least one outside dealer is required").max(8, "Maximum 8 outside dealers per auction"),
});

export async function POST(request: NextRequest, { params }: Props) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  if (!["SUPER_ADMIN", "OPERATIONS_ADMIN"].includes(admin.role)) {
    return adminError("FORBIDDEN", "SUPER_ADMIN or OPERATIONS_ADMIN required", 403);
  }

  const { buyerId } = await params;

  let body: unknown;
  try { body = await request.json(); } catch {
    return adminError("VALIDATION_ERROR", "Invalid JSON", 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }
  const { auctionId, hours, dealers } = parsed.data;

  // Verify auction belongs to this buyer
  const auction = await prisma.auction.findFirst({
    where: { id: auctionId, buyerId },
    select: { id: true, endsAt: true, buyer: { select: { city: true, state: true } } },
  });
  if (!auction) return adminError("NOT_FOUND", "Auction not found for this buyer", 404);

  // Single mint path with rooftop dedup + reliable token return (no fragile
  // re-read-by-email). Deduped against any existing invites for this auction.
  const minted = await mintOutsideInvites(
    auctionId,
    dealers.map(d => ({
      dealershipName: d.dealershipName,
      contactName:    d.contactName,
      email:          d.email,
      phone:          d.phone ?? null,
    })),
    undefined,
    { prisma },
  );

  const buyerCity  = auction.buyer.city  ?? "Location";
  const buyerState = auction.buyer.state ?? "TBD";
  const expiryHours = hours ?? AUCTION_DURATION_HOURS;

  for (const invite of minted) {
    void sendDealerAuctionInvitationEmail({
      to: invite.email,
      contactName: invite.contactName,
      vehicleMake: "Vehicle",
      vehicleModel: "Requested",
      vehicleYear: new Date().getFullYear(),
      vehicleTrim: null,
      buyerCity,
      buyerState,
      auctionUrl: `${APP_URL}/dealer-offer-outside/${invite.token}`,
      expiryHours,
      auctionId,
    }).catch(err => logger.error(`[invite-outside-dealers] email failed (${invite.email}):`, err));
  }

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "OUTSIDE_DEALERS_INVITED",
      entityType: "Auction",
      entityId: auctionId,
      reason: "Outside dealers invited to auction",
      metadata: {
        buyerId,
        auctionId,
        // Actual minted count/emails after dedup (requested may be higher).
        requestedCount: dealers.length,
        dealerCount: minted.length,
        emails: minted.map(i => i.email),
      },
    },
  }).catch(err => logger.error("[invite-outside-dealers] audit log failed:", err));

  return adminSuccess({ invited: minted.length, invites: minted.map(i => ({ id: i.id, email: i.email, token: i.token })) });
}
