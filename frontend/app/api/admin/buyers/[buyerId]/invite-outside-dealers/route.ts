import { NextRequest } from "next/server";
import { getAdminFromRequest, adminError, adminSuccess } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { AUCTION_DURATION_HOURS } from "@/lib/constants";
import { sendDealerAuctionInvitationEmail } from "@/lib/services/email/resend.service";

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

  const created = await prisma.outsideAuctionInvite.createMany({
    data: dealers.map(d => ({
      auctionId,
      dealershipName: d.dealershipName,
      contactName:    d.contactName,
      email:          d.email,
      phone:          d.phone ?? null,
    })),
  });

  // Re-read what we just inserted so we have the tokens for emails.
  const inserted = await prisma.outsideAuctionInvite.findMany({
    where: { auctionId, email: { in: dealers.map(d => d.email) } },
    orderBy: { sentAt: "desc" },
    take: dealers.length,
  });

  // Match each requested dealer to the freshest invite record by email.
  const buyerCity  = auction.buyer.city  ?? "Location";
  const buyerState = auction.buyer.state ?? "TBD";
  const expiryHours = hours ?? AUCTION_DURATION_HOURS;

  for (const d of dealers) {
    const invite = inserted.find(i => i.email === d.email);
    if (!invite) continue;
    void sendDealerAuctionInvitationEmail({
      to: d.email,
      contactName: d.contactName,
      vehicleMake: "Vehicle",
      vehicleModel: "Requested",
      vehicleYear: new Date().getFullYear(),
      vehicleTrim: null,
      buyerCity,
      buyerState,
      auctionUrl: `${APP_URL}/dealer-offer-outside/${invite.token}`,
      expiryHours,
      auctionId,
    }).catch(err => console.error(`[invite-outside-dealers] email failed (${d.email}):`, err));
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
        dealerCount: dealers.length,
        emails: dealers.map(d => d.email),
      },
    },
  }).catch(err => console.error("[invite-outside-dealers] audit log failed:", err));

  return adminSuccess({ invited: created.count, invites: inserted.map(i => ({ id: i.id, email: i.email, token: i.token })) });
}
