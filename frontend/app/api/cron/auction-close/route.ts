// MOST CRITICAL cron — runs every 5 minutes
// Closes expired auctions, triggers dealer invitation release, notifies buyers

import { logger } from "@/lib/logger";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { NextRequest, NextResponse } from "next/server";
import { closeExpiredAuctions, processAuctionClose } from "@/lib/services/auction/auction.service";
import {
  sendDealerOfferRevisionClosingEmail,
} from "@/lib/services/email/resend.service";
import { prisma } from "@/lib/prisma";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("auction-close", async () => {
  const now = new Date();
  const count = await closeExpiredAuctions();

  // F-001 — reconciler. Process EVERY CLOSED auction whose post-close side
  // effects never completed (post_close_processed_at IS NULL), not just those
  // closed in a trailing 6-minute window. A missed or slow cron tick — or a
  // mid-run failure — therefore self-heals on the next pass instead of
  // permanently dropping the buyer's win/no-offer notice and the zero-offer
  // auto-refund. processAuctionClose claims each auction atomically and is
  // idempotent, so reprocessing is safe. Bounded per run to respect the
  // function timeout; any remainder is picked up next tick.
  const closedAuctions = await prisma.auction.findMany({
    where: { status: "CLOSED", postCloseProcessedAt: null },
    select: { id: true },
    orderBy: { closedAt: "asc" },
    take: 100,
  });

  for (const auction of closedAuctions) {
    await processAuctionClose(auction.id).catch(err =>
      logger.error(`[auction-close] post-close processing failed for ${auction.id}:`, err)
    );
  }

  // Outreach for ACTIVE auctions still in flight: reminders for invited
  // dealers without offers, and last-chance notices for dealers with offers.
  const activeAuctions = await prisma.auction.findMany({
    where: {
      status: "ACTIVE",
      endsAt: { gte: now, lte: new Date(now.getTime() + 2 * 60 * 60 * 1000) },
    },
    // NARROWED IN PHASE 5. This used to `include` every invitation with its dealer and that
    // dealer's user, to address the nonresponder reminder that has moved to
    // `dealer-invitation-reminder`. Only the offers are read now, so only the offers are
    // fetched — an auction with eight invitations no longer pulls eight dealers and eight
    // users on every five-minute tick to build nothing.
    select: {
      id: true,
      endsAt: true,
      offers: {
        select: {
          id: true,
          dealer: { select: { dealershipName: true, user: { select: { email: true } } } },
        },
      },
    },
  });

  for (const auction of activeAuctions) {
    if (!auction.endsAt) continue;
    const msRemaining = auction.endsAt.getTime() - now.getTime();
    const vehicleRef = `Auction ${auction.id.slice(0, 8)}`;
    const auctionUrl = `${APP_URL}/dealer/auctions/${auction.id}`;

    // NONRESPONDER REMINDERS WERE REMOVED FROM THIS CRON IN PHASE 5, and this comment is the
    // capability map entry: the capability is MOVED, not removed.
    //
    // §Stage 7 puts dealer reminders at 50% and 90% of the window, and
    // `sweepInvitationReminders` (`lib/services/auction/auction-invitation.service.ts`, driven
    // by `/api/cron/dealer-invitation-reminder`) is the one rail that does it — for BOTH pools,
    // through the §27 dispatcher, with per-invitation idempotency.
    //
    // The block that stood here never delivered anything anyway. It called
    // `sendDealerAuctionReminderEmail`, whose key is `dealer-auction-reminder-${auctionId}-${to}`
    // (`resend.service.ts:1671`), and the hourly `dealer-invitation-reminder` cron consumed that
    // key ~6h before the deadline — so every send from here returned DUPLICATE (`:200-202`) and
    // the `.catch(() => {})` could not tell, because DUPLICATE is a resolved value. On the rare
    // path where it was NOT suppressed (a short auction), it sent `vehicleMake: ""`,
    // `vehicleModel: ""`, `vehicleYear: 0` into a subject-line builder, so a dealership received
    // "Xh Left — Submit Your Offer for 0  ".
    //
    // The REVISION-CLOSING notice below is a different message to a different audience — dealers
    // who HAVE bid, inside the last 30 minutes — and it stays exactly as it was.

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

    return { closed: count, processed: closedAuctions.length, timestamp: now.toISOString() };
  });

  if (!run.ok) {
    return NextResponse.json({ success: false, error: "auction_close_failed" }, { status: 500 });
  }
  return NextResponse.json({ success: true, data: run.result });
}
