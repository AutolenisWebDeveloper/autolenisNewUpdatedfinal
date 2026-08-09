// lib/services/auction/auction.service.ts
// System 3 — Auction lifecycle management

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { AuctionStatus, Prisma } from "@prisma/client";
import { AUCTION_DURATION_HOURS, DEPOSIT_AMOUNT_USD } from "@/lib/constants";
import { releaseAuctionLoad } from "@/lib/services/auction/dealer-invitation.service";
import { rankOffers } from "@/lib/services/offer/best-price.service";
import {
  sendOffersReadyEmail,
  sendDealerAuctionClosedNoWinnerEmail,
} from "@/lib/services/email/resend.service";
import { emitAuctionComms } from "@/lib/services/notifications/acquisition-comms";

export async function createAuction(buyerId: string, depositId: string) {
  return prisma.auction.create({
    data: {
      buyerId,
      depositId,
      status: AuctionStatus.PENDING,
    },
  });
}

export async function launchAuction(auctionId: string) {
  const now = new Date();
  const endsAt = new Date(now.getTime() + AUCTION_DURATION_HOURS * 3600000);
  const auction = await prisma.auction.update({
    where: { id: auctionId },
    data: { status: AuctionStatus.ACTIVE, startedAt: now, endsAt },
  });

  // CRM event spine — emit auction_started after the successful activation.
  // Additive tail call: this single service-layer seam covers every activation
  // path (Stripe webhook, admin launch, deposit service) and a failure here can
  // never affect the auction transition, which has already committed.
  try {
    const buyer = await prisma.buyer.findUnique({
      where: { id: auction.buyerId },
      include: { user: { select: { email: true } } },
    });
    if (buyer) {
      const { emitDomainEvent } = await import("@/lib/events/emit");
      await emitDomainEvent("auction_started", {
        domainEntityId: auction.id,
        contact: {
          email: buyer.user?.email ?? null,
          phone: buyer.phone,
          firstName: buyer.firstName,
          lastName: buyer.lastName,
          source: "buyer_signup",
        },
        data: {
          auction_id: auction.id,
          buyer_id: auction.buyerId,
          ends_at: endsAt.toISOString(),
        },
      });
    }
  } catch (err) {
    logger.error("[auction.service] auction_started emit failed:", err);
  }

  return auction;
}

export async function closeAuction(auctionId: string) {
  return prisma.auction.update({
    where: { id: auctionId },
    data: { status: AuctionStatus.CLOSED, closedAt: new Date() },
  });
}

export async function extendAuction(auctionId: string, hours: number, extendedBy: string, reason: string) {
  const auction = await prisma.auction.findUnique({ where: { id: auctionId } });
  if (!auction || !auction.endsAt) throw new Error("Auction not found or not active");
  const newEnd = new Date(auction.endsAt.getTime() + hours * 3600000);
  return prisma.auction.update({
    where: { id: auctionId },
    data: { endsAt: newEnd, extendedAt: new Date(), extendedBy, extendReason: reason },
  });
}

// F-001 — a post-close claim is "won" only when exactly one auction row flipped
// from post_close_processed_at NULL → now(). A count of 0 means the auction was
// already processed (or a concurrent run owns it), so this invocation must skip.
// Extracted as a pure function so the idempotency contract is unit-testable.
export function postCloseClaimWon(updatedCount: number): boolean {
  return updatedCount === 1;
}

// Post-close processing for a single auction: release dealer load, rank
// offers, and notify the buyer (plus invited dealers when there is no winner).
// Shared by the auction-close cron and the admin manual-close action so the
// two paths never diverge. Safe to call more than once — claimed atomically
// (F-001) and the buyer/dealer emails are idempotency-keyed in resend.service.
export async function processAuctionClose(auctionId: string): Promise<{ offers: number }> {
  const auction = await prisma.auction.findUnique({
    where: { id: auctionId },
    select: { id: true, buyerId: true, depositId: true, _count: { select: { offers: true } } },
  });
  if (!auction) return { offers: 0 };

  // F-001 — atomic claim. Only the invocation that flips post_close_processed_at
  // from NULL wins; concurrent or duplicate invocations (overlapping cron ticks,
  // an admin manual close racing the cron) no-op. This is the idempotency guard
  // that lets the cron safely reprocess any CLOSED-but-unprocessed auction
  // without double-notifying.
  const claim = await prisma.auction.updateMany({
    where: { id: auctionId, postCloseProcessedAt: null },
    data: { postCloseProcessedAt: new Date() },
  });
  if (!postCloseClaimWon(claim.count)) {
    return { offers: auction._count.offers };
  }

  try {
  await releaseAuctionLoad(auctionId);

  if (auction._count.offers > 0) {
    await rankOffers(auctionId).catch(err =>
      logger.error(`[processAuctionClose] rankOffers failed for ${auctionId}:`, err)
    );

    await prisma.notification.create({
      data: {
        buyerId: auction.buyerId,
        title: `Your auction closed — ${auction._count.offers} offer${auction._count.offers !== 1 ? "s" : ""} ready`,
        body: "Review your ranked offers and select your best deal.",
        type: "OFFER_RECEIVED",
        actionUrl: `/buyer/auction/${auctionId}/offers`,
      },
    }).catch(() => {});

    const buyer = await prisma.buyer.findUnique({
      where: { id: auction.buyerId },
      select: { firstName: true, user: { select: { email: true } } },
    });
    if (buyer?.user?.email) {
      await sendOffersReadyEmail(
        buyer.user.email,
        buyer.firstName ?? "there",
        auctionId,
        auction._count.offers,
      ).catch(err => logger.error(`[processAuctionClose] buyer email failed for ${auctionId}:`, err));
    }

    // Additive SMS nudge (in-app + email already sent above). SMS is off by
    // default and fully consent/suppression/quiet-hours gated inside the
    // orchestrator; best-effort, never throws.
    await emitAuctionComms(auctionId, "OFFERS_READY", auction._count.offers).catch(() => {});
  } else {
    // NO AUTO-REFUND. The $99 Auction Access Deposit is a non-refundable
    // access fee and is retained when an auction closes with no
    // dealer offers. The platform never initiates a refund automatically at
    // auction close; any refund must be issued deliberately by an admin via the
    // manual refund tools. Only buyer-facing/dealer notifications are emitted here.
    await prisma.notification.create({
      data: {
        buyerId: auction.buyerId,
        title: "Auction closed — no offers received",
        body: `Your ${DEPOSIT_AMOUNT_USD} Auction Access Deposit secured your private auction and is non-refundable. You may start a new request or request a specific vehicle.`,
        type: "DEAL_STAGE_CHANGED",
      },
    }).catch(() => {});

    const invitedDealers = await prisma.auctionInvitation.findMany({
      where: { auctionId },
      include: { dealer: { include: { user: { select: { email: true } } } } },
    }).catch(() => []);
    const vehicleRef = `Auction ${auctionId.slice(0, 8)}`;
    for (const inv of invitedDealers) {
      const email = inv.dealer?.user?.email;
      if (!email) continue;
      await sendDealerAuctionClosedNoWinnerEmail({
        to: email,
        contactName: inv.dealer.dealershipName,
        vehicleRef,
        auctionId,
      }).catch(() => {});
    }

    // Additive SMS nudge for the no-offers outcome (in-app already sent above).
    await emitAuctionComms(auctionId, "NO_MATCH", 0).catch(() => {});
  }

  return { offers: auction._count.offers };
  } catch (err) {
    // Release the claim so the reconciler retries on the next pass. Post-close
    // processing moves no money (the deposit is never auto-refunded), and the
    // buyer/dealer emails are idempotency-keyed in resend.service, so a retry
    // cannot double-anything.
    await prisma.auction
      .updateMany({ where: { id: auctionId }, data: { postCloseProcessedAt: null } })
      .catch(() => {});
    logger.error(
      `[processAuctionClose] side effects failed for ${auctionId} — claim released for retry:`,
      err,
    );
    throw err;
  }
}

// Close all expired auctions — called by auction-close cron
export async function closeExpiredAuctions(): Promise<number> {
  const now = new Date();
  const result = await prisma.auction.updateMany({
    where: { status: AuctionStatus.ACTIVE, endsAt: { lte: now } },
    data: { status: AuctionStatus.CLOSED, closedAt: now },
  });
  return result.count;
}

export async function getActiveAuctions() {
  return prisma.auction.findMany({
    where: { status: AuctionStatus.ACTIVE },
    include: { buyer: true, _count: { select: { offers: true } } },
  });
}

export async function getAuctionWithOffers(auctionId: string) {
  return prisma.auction.findUnique({
    where: { id: auctionId },
    include: {
      buyer: { include: { preQualification: true } },
      offers: { include: { dealer: true }, orderBy: { otdPriceCents: "asc" } },
      invitations: { include: { dealer: true } },
    },
  });
}

// Check if auction is holding deposit — for refund eligibility
export async function hasSubmittedOffers(auctionId: string): Promise<boolean> {
  const count = await prisma.offer.count({ where: { auctionId, status: "SUBMITTED" } });
  return count > 0;
}
