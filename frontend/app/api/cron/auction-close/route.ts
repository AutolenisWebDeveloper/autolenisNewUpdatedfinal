// MOST CRITICAL cron — runs every 5 minutes
// Closes expired auctions, triggers dealer invitation release, notifies buyers

import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { closeExpiredAuctions, processAuctionClose } from "@/lib/services/auction/auction.service";
import {
  sendDealerAuctionReminderEmail,
  sendDealerOfferRevisionClosingEmail,
} from "@/lib/services/email/resend.service";
import { prisma } from "@/lib/prisma";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const now = new Date();
  const count = await closeExpiredAuctions();

  // Release auction load and notify buyers/dealers for all just-closed auctions
  const closedAuctions = await prisma.auction.findMany({
    where: { status: "CLOSED", closedAt: { gte: new Date(now.getTime() - 6 * 60000) } }, // Last 6 minutes
    select: { id: true },
  });

  for (const auction of closedAuctions) {
    await processAuctionClose(auction.id).catch(err =>
      console.error(`[auction-close] post-close processing failed for ${auction.id}:`, err)
    );
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
