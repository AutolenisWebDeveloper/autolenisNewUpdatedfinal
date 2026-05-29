// lib/services/auction/dealer-invitation.service.ts
// System 3 ENH — Dealer invitation scoring and capacity throttling

import { prisma } from "@/lib/prisma";
import { sendDealerAuctionInvitationEmail } from "@/lib/services/email/resend.service";
import { syncGhlTag } from "@/lib/services/ghl/tag-sync";
import { AUCTION_DURATION_HOURS } from "@/lib/constants";
import { ZIP_COORDS } from "@/lib/utils/zip-coords";
import { dispatch } from "@/lib/qstash/dispatch";

const MAX_INVITATIONS_PER_AUCTION = 8;
const MAX_DISTANCE_MILES = 150;

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Score factors for dealer invitation
interface InvitationScore {
  dealerId: string;
  score: number;
  factors: Record<string, number>;
}

async function scoreDealerForAuction(dealerId: string, vehicleTypes: string[]): Promise<number> {
  const dealer = await prisma.dealer.findUnique({
    where: { id: dealerId },
    include: {
      scorecardSnapshots: { orderBy: { snapshotDate: "desc" }, take: 1 },
      _count: { select: { invitations: { where: { auction: { status: "ACTIVE" } } } } },
    },
  });

  if (!dealer || dealer.status !== "ACTIVE") return 0;

  let score = 50; // Base score

  // Tier bonus
  const tierBonus: Record<string, number> = { PLATINUM: 30, GOLD: 20, STANDARD: 10, PROBATION: -20 };
  score += tierBonus[dealer.tier] ?? 0;

  // Capacity check — subtract if overloaded
  score -= dealer.currentAuctionLoad * 5;
  if (dealer.currentAuctionLoad >= 5) return 0; // Max capacity

  // Recent scorecard performance
  const snapshot = dealer.scorecardSnapshots[0];
  if (snapshot) {
    score += snapshot.offerWinRate * 20;
    score -= snapshot.junkFeeRatio * 15;
  }

  return Math.max(0, Math.round(score));
}

export async function inviteDealersToAuction(auctionId: string, _buyerId: string): Promise<number> {
  // _buyerId is part of the public signature for callers; buyer is resolved via the auction relation below.

  // Resolve buyer location (for geographic pre-filter and email body)
  const auctionForBuyer = await prisma.auction.findUnique({
    where: { id: auctionId },
    select: {
      endsAt: true,
      buyer: { select: { zip: true, city: true, state: true } },
    },
  });
  const buyerZip = auctionForBuyer?.buyer?.zip ?? null;
  const buyerCoords = buyerZip ? ZIP_COORDS[buyerZip] ?? null : null;

  // Get active dealers (with zip for geographic pre-filter).
  // Exclude the system "Outside Dealer" placeholder — it is never invited.
  const dealers = await prisma.dealer.findMany({
    where: { status: "ACTIVE", isSystemPlaceholder: false },
    select: { id: true, zip: true },
  });

  // Filter dealers by proximity (within MAX_DISTANCE_MILES of buyer).
  // Dealers without coords or when buyer coords are unavailable are not excluded.
  const nearbyDealers = buyerCoords
    ? dealers.filter(d => {
        const dealerCoords = d.zip ? ZIP_COORDS[d.zip] ?? null : null;
        if (!dealerCoords) return true; // Include dealers without coords (don't exclude)
        const miles = haversineMiles(buyerCoords.lat, buyerCoords.lng, dealerCoords.lat, dealerCoords.lng);
        return miles <= MAX_DISTANCE_MILES;
      })
    : dealers;

  const scores: InvitationScore[] = await Promise.all(
    nearbyDealers.map(async (d) => ({
      dealerId: d.id,
      score: await scoreDealerForAuction(d.id, []),
      factors: {},
    }))
  );

  // Sort by score, take top MAX_INVITATIONS_PER_AUCTION
  const topDealers = scores
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_INVITATIONS_PER_AUCTION);

  // Create invitations
  const invitations = await Promise.all(
    topDealers.map(({ dealerId, score }) =>
      prisma.auctionInvitation.upsert({
        where: { auctionId_dealerId: { auctionId, dealerId } },
        create: { auctionId, dealerId, invitationScore: score, sentAt: new Date() },
        update: { invitationScore: score },
      })
    )
  );

  // Update dealer auction load
  await prisma.dealer.updateMany({
    where: { id: { in: topDealers.map(d => d.dealerId) } },
    data: { currentAuctionLoad: { increment: 1 } },
  });

  // Notify invited dealers (in-app notification + email)
  for (const { dealerId } of topDealers) {
    const dealer = await prisma.dealer.findUnique({
      where: { id: dealerId },
      select: {
        dealershipName: true,
        user: { select: { email: true } },
      },
    });

    // In-app notification (existing)
    await prisma.notification.create({
      data: {
        dealerId,
        title: "New Auction Invitation",
        body: "You have been invited to submit an offer. The auction closes in 48 hours.",
        type: "AUCTION_STARTED",
      },
    }).catch(() => {});

    // Email notification (non-blocking)
    if (dealer?.user?.email) {
      await sendDealerAuctionInvitationEmail({
        to: dealer.user.email,
        contactName: dealer.dealershipName ?? "Dealer",
        vehicleMake: "Vehicle",          // buyer hasn't selected specific vehicle yet
        vehicleModel: "Requested",
        vehicleYear: new Date().getFullYear(),
        vehicleTrim: null,
        buyerCity: auctionForBuyer?.buyer?.city ?? "Location",
        buyerState: auctionForBuyer?.buyer?.state ?? "TBD",
        auctionUrl: `${(process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim()}/dealer/opportunities`,
        expiryHours: AUCTION_DURATION_HOURS,
        auctionId,
      }).catch(err =>
        console.error(`[dealer-invitation] email failed for dealer ${dealerId}:`, err)
      );
    }

    // QStash — dealer invitation notification + bid-deadline reminders.
    if (dealer?.user?.email) {
      dispatch({
        path: "/api/jobs/dealer-invited",
        body: {
          dealerId,
          firstName: dealer.dealershipName ?? "Dealer",
          email: dealer.user.email,
          auctionId,
          expiresAt: auctionForBuyer?.endsAt?.toISOString() ?? null,
        },
      }).catch(() => {});
    }

    syncGhlTag(dealer?.user?.email, "dealer-invited");
  }

  return invitations.length;
}

// Decrement auction load when auction closes
export async function releaseAuctionLoad(auctionId: string): Promise<void> {
  const invitations = await prisma.auctionInvitation.findMany({
    where: { auctionId },
    select: { dealerId: true },
  });

  if (invitations.length) {
    await prisma.dealer.updateMany({
      where: { id: { in: invitations.map(i => i.dealerId) } },
      data: { currentAuctionLoad: { decrement: 1 } },
    });
  }
}
