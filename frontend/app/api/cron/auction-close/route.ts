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

      // Notify all invited dealers that the auction closed with no winner.
      const invitations = await prisma.auctionInvitation.findMany({
        where: { auctionId: auction.id },
        include: { dealer: { include: { user: { select: { email: true } } } } },
      });
      for (const inv of invitations) {
        const email = inv.dealer?.user?.email;
        if (!email) continue;
        await sendDealerAuctionClosedNoWinnerEmail({
          to: email,
          contactName: inv.dealer.dealershipName,
          vehicleRef: `Auction ${auction.id.slice(0, 8)}`,
          auctionId: auction.id,
        }).catch((err) =>
          console.error(`[auction-close] no-winner email failed for ${email}:`, err),
        );
      }
    }
  }

  // Pre-close nudges — runs every cron tick so timing is approximate, but
  // each helper is idempotent on (auctionId, dealerEmail) so duplicates are safe.

  // Reminder: auctions ending within 2h that the dealer has not responded to.
  const remindCutoff = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const closingSoon = await prisma.auction.findMany({
    where: {
      status: "ACTIVE",
      endsAt: { gte: now, lte: remindCutoff },
    },
    include: {
      invitations: {
        where: { respondedAt: null },
        include: { dealer: { include: { user: { select: { email: true } } } } },
      },
    },
  });
  for (const auction of closingSoon) {
    const hoursRemaining = auction.endsAt
      ? Math.max(1, Math.round((auction.endsAt.getTime() - Date.now()) / 3_600_000))
      : 2;
    for (const inv of auction.invitations) {
      const email = inv.dealer?.user?.email;
      if (!email) continue;
      await sendDealerAuctionReminderEmail({
        to: email,
        contactName: inv.dealer.dealershipName,
        vehicleMake: "Vehicle",
        vehicleModel: "Requested",
        vehicleYear: new Date().getFullYear(),
        auctionUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dealer/auctions/${auction.id}`,
        hoursRemaining,
        auctionId: auction.id,
      }).catch((err) =>
        console.error(`[auction-close] reminder email failed for ${email}:`, err),
      );
    }
  }

  // Revision-closing: auctions ending within 30 min, notify dealers with submitted offers.
  const revisionCutoff = new Date(Date.now() + 30 * 60 * 1000);
  const closingVerySoon = await prisma.auction.findMany({
    where: {
      status: "ACTIVE",
      endsAt: { gte: now, lte: revisionCutoff },
    },
    include: {
      offers: {
        where: { status: "SUBMITTED" },
        include: { dealer: { include: { user: { select: { email: true } } } } },
      },
    },
  });
  for (const auction of closingVerySoon) {
    for (const offer of auction.offers) {
      const email = offer.dealer?.user?.email;
      if (!email) continue;
      await sendDealerOfferRevisionClosingEmail({
        to: email,
        contactName: offer.dealer.dealershipName,
        vehicleRef: `Auction ${auction.id.slice(0, 8)}`,
        auctionUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dealer/auctions/${auction.id}`,
        offerId: offer.id,
      }).catch((err) =>
        console.error(`[auction-close] revision-closing email failed for ${email}:`, err),
      );
    }
  }

  return NextResponse.json({ success: true, data: { closed: count, processed: closedAuctions.length, timestamp: now.toISOString() } });
}
