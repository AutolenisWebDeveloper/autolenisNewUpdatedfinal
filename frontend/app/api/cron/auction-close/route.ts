// MOST CRITICAL cron — runs every 5 minutes
// Closes expired auctions, triggers dealer invitation release, notifies buyers

import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { closeExpiredAuctions } from "@/lib/services/auction/auction.service";
import { releaseAuctionLoad } from "@/lib/services/auction/dealer-invitation.service";
import { rankOffers } from "@/lib/services/offer/best-price.service";
import {
  sendOffersReadyEmail,
  sendDealerAuctionReminderEmail,
  sendDealerOfferRevisionClosingEmail,
  sendDealerAuctionClosedNoWinnerEmail,
} from "@/lib/services/email/resend.service";
import { prisma } from "@/lib/prisma";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com";

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const now = new Date();
  const count = await closeExpiredAuctions();

  // Release auction load for all just-closed auctions
  const closedAuctions = await prisma.auction.findMany({
    where: { status: "CLOSED", closedAt: { gte: new Date(now.getTime() - 6 * 60000) } }, // Last 6 minutes
    select: { id: true, buyerId: true, _count: { select: { offers: true } } },
  });

  for (const auction of closedAuctions) {
    await releaseAuctionLoad(auction.id);

    // Compute best-price rankings for offers (System 4) — non-blocking
    if (auction._count.offers > 0) {
      await rankOffers(auction.id).catch(err =>
        console.error(`[auction-close] rankOffers failed for ${auction.id}:`, err)
      );
    }

    // Notify buyer
    if (auction._count.offers > 0) {
      await prisma.notification.create({
        data: {
          buyerId: auction.buyerId,
          title: `Your auction closed — ${auction._count.offers} offer${auction._count.offers !== 1 ? "s" : ""} ready`,
          body: "Review your ranked offers and select your best deal.",
          type: "OFFER_RECEIVED",
          actionUrl: `/buyer/auction/${auction.id}/offers`,
        },
      }).catch(() => {});

      // Email the buyer that their auction has closed and offers are ready (non-blocking)
      const buyer = await prisma.buyer.findUnique({
        where: { id: auction.buyerId },
        select: { firstName: true, user: { select: { email: true } } },
      });
      if (buyer?.user?.email) {
        await sendOffersReadyEmail(
          buyer.user.email,
          buyer.firstName ?? "there",
          auction.id,
          auction._count.offers,
        ).catch(err =>
          console.error(`[auction-close] buyer email failed for ${auction.id}:`, err)
        );
      }
    } else {
      await prisma.notification.create({
        data: {
          buyerId: auction.buyerId,
          title: "Auction closed — no offers received",
          body: "Your $99 deposit will be refunded within 3 business days. You may request a specific vehicle.",
          type: "DEAL_STAGE_CHANGED",
        },
      }).catch(() => {});

      // Notify every invited dealer that the auction closed without a winner.
      const invitedDealers = await prisma.auctionInvitation.findMany({
        where: { auctionId: auction.id },
        include: { dealer: { include: { user: { select: { email: true } } } } },
      }).catch(() => []);
      const vehicleRef = `Auction ${auction.id.slice(0, 8)}`;
      for (const inv of invitedDealers) {
        const email = inv.dealer?.user?.email;
        if (!email) continue;
        await sendDealerAuctionClosedNoWinnerEmail({
          to: email,
          contactName: inv.dealer.dealershipName,
          vehicleRef,
          auctionId: auction.id,
        }).catch(() => {});
      }
    }
  }

  // Outreach for ACTIVE auctions still in flight: reminders for invited
  // dealers without offers, and last-chance notices for dealers with offers.
  const activeAuctions = await prisma.auction.findMany({
    where: {
      status: "ACTIVE",
      endsAt: { gte: now, lte: new Date(now.getTime() + 2 * 60 * 60 * 1000) },
    },
    include: {
      invitations: {
        include: { dealer: { include: { user: { select: { email: true } } } } },
      },
      offers: {
        include: { dealer: { include: { user: { select: { email: true } } } } },
      },
    },
  });

  for (const auction of activeAuctions) {
    if (!auction.endsAt) continue;
    const msRemaining = auction.endsAt.getTime() - now.getTime();
    const hoursRemaining = Math.max(1, Math.round(msRemaining / 3_600_000));
    const vehicleRef = `Auction ${auction.id.slice(0, 8)}`;
    const auctionUrl = `${APP_URL}/dealer/auctions/${auction.id}`;
    const dealersWithOffers = new Set(auction.offers.map(o => o.dealerId));

    // Reminders for invited dealers who have not submitted yet.
    for (const inv of auction.invitations) {
      if (dealersWithOffers.has(inv.dealerId)) continue;
      const email = inv.dealer?.user?.email;
      if (!email) continue;
      await sendDealerAuctionReminderEmail({
        to: email,
        contactName: inv.dealer.dealershipName,
        vehicleMake: "",
        vehicleModel: "",
        vehicleYear: 0,
        auctionUrl,
        hoursRemaining,
        auctionId: auction.id,
      }).catch(() => {});
    }

    // Revision-closing notice for dealers with offers when < 30 minutes remain.
    if (msRemaining <= 30 * 60 * 1000) {
      for (const offer of auction.offers) {
        const email = offer.dealer?.user?.email;
        if (!email) continue;
        await sendDealerOfferRevisionClosingEmail({
          to: email,
          contactName: offer.dealer.dealershipName,
          vehicleRef,
          auctionUrl,
          offerId: offer.id,
        }).catch(() => {});
      }
    }
  }

  return NextResponse.json({ success: true, data: { closed: count, processed: closedAuctions.length, timestamp: now.toISOString() } });
}
