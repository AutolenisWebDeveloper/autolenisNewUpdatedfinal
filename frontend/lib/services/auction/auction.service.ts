// lib/services/auction/auction.service.ts
// System 3 — Auction lifecycle management

import { prisma } from "@/lib/prisma";
import { AuctionStatus, Prisma } from "@prisma/client";
import { AUCTION_DURATION_HOURS, DEPOSIT_AMOUNT_USD } from "@/lib/constants";
import { releaseAuctionLoad } from "@/lib/services/auction/dealer-invitation.service";
import { rankOffers } from "@/lib/services/offer/best-price.service";
import {
  sendOffersReadyEmail,
  sendDealerAuctionClosedNoWinnerEmail,
} from "@/lib/services/email/resend.service";

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
    console.error("[auction.service] auction_started emit failed:", err);
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

// Post-close processing for a single auction: release dealer load, rank
// offers, and notify the buyer (plus invited dealers when there is no winner).
// Shared by the auction-close cron and the admin manual-close action so the
// two paths never diverge. Safe to call more than once — the buyer/dealer
// emails are idempotency-keyed in resend.service.
export async function processAuctionClose(auctionId: string): Promise<{ offers: number }> {
  const auction = await prisma.auction.findUnique({
    where: { id: auctionId },
    select: { id: true, buyerId: true, depositId: true, _count: { select: { offers: true } } },
  });
  if (!auction) return { offers: 0 };

  await releaseAuctionLoad(auctionId);

  if (auction._count.offers > 0) {
    await rankOffers(auctionId).catch(err =>
      console.error(`[processAuctionClose] rankOffers failed for ${auctionId}:`, err)
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
      ).catch(err => console.error(`[processAuctionClose] buyer email failed for ${auctionId}:`, err));
    }
  } else {
    // AUTO-REFUND — zero-offer auction close. The buyer is promised a refund
    // when no dealers bid; issue it automatically instead of relying on manual
    // admin action. Best-effort: a failure here raises an admin alert below.
    try {
      const depositForRefund = await prisma.deposit.findUnique({
        where: { id: auction.depositId },
        select: {
          id: true,
          status: true,
          stripePaymentIntentId: true,
          amountCents: true,
          buyer: {
            select: {
              firstName: true,
              user: { select: { email: true } },
            },
          },
        },
      }).catch(() => null);

      if (
        depositForRefund &&
        depositForRefund.stripePaymentIntentId &&
        depositForRefund.status !== "REFUNDED"
      ) {
        const { getStripe } = await import("@/lib/stripe");
        const stripe = getStripe();

        const refund = await stripe.refunds.create({
          payment_intent: depositForRefund.stripePaymentIntentId,
          reason: "requested_by_customer",
          metadata: {
            auctionId,
            reason: "zero_offers",
            autoRefund: "true",
          },
        });

        await prisma.deposit.update({
          where: { id: depositForRefund.id },
          data: { status: "REFUNDED", refundedAt: new Date() },
        });

        console.log(
          `[processAuctionClose] auto-refund issued — ` +
          `deposit ${depositForRefund.id}, auction ${auctionId}`
        );

        // Send refund confirmation email — best effort.
        if (depositForRefund.buyer?.user?.email) {
          const { sendRefundConfirmationEmail } = await import(
            "@/lib/services/email/resend.service"
          );
          await sendRefundConfirmationEmail({
            to: depositForRefund.buyer.user.email,
            firstName: depositForRefund.buyer.firstName ?? "there",
            amountCents: depositForRefund.amountCents,
            reason:
              "No dealer offers were received for your auction. " +
              "Your full deposit has been refunded.",
            refundId: refund.id,
          }).catch((err: unknown) =>
            console.error(
              "[processAuctionClose] refund email failed:", err
            )
          );
        }
      }
    } catch (refundErr) {
      // Auto-refund failed — raise an admin alert for manual action.
      console.error(
        `[processAuctionClose] AUTO-REFUND FAILED auction ${auctionId}:`,
        refundErr
      );
      await prisma.notification.create({
        data: {
          type: "SYSTEM_ALERT",
          title: `MANUAL REFUND REQUIRED — Auction ${auctionId.slice(0, 8)}`,
          body:
            `Auto-refund failed for auction ${auctionId}. ` +
            `Check Stripe and issue the deposit refund manually.`,
        },
      }).catch(() => {});
    }

    await prisma.notification.create({
      data: {
        buyerId: auction.buyerId,
        title: "Auction closed — no offers received",
        body: `Your ${DEPOSIT_AMOUNT_USD} deposit will be refunded within 3 business days. You may request a specific vehicle.`,
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
  }

  return { offers: auction._count.offers };
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
