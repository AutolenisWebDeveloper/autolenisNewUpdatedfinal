// lib/services/dealer/dealer-dashboard.service.ts
// Aggregates all data needed for the V4 dealer dashboard in a single function.
// Keeps the dashboard page free of direct Prisma calls.

import { prisma } from "@/lib/prisma";
import type { OfferStatus, DealStatus } from "@prisma/client";

export interface DealerDashboardOffer {
  id: string;
  auctionId: string;
  status: OfferStatus;
  otdPriceCents: number;
  createdAt: Date;
}

export interface DealerDashboardDeal {
  id: string;
  status: DealStatus;
  createdAt: Date;
  offer: { otdPriceCents: number } | null;
}

export interface DealerDashboardPayment {
  id: string;
  amountCents: number;
  type: string;
  status: string;
  createdAt: Date;
}

export interface DealerDashboardData {
  /** Count of open auction invitations the dealer can still respond to. */
  activeAuctionCount: number;
  /** Count of active (non-completed, non-cancelled) inventory items. */
  inventoryCount: number;
  /** Count of in-progress deals (not COMPLETED or CANCELLED). */
  dealsInProgressCount: number;
  /** Count of pending pickups (PICKUP_SCHEDULED). */
  pendingPickupsCount: number;
  /** Offer win rate (%) over the last 90 days. */
  winRatePct: number;
  /** Number of offers submitted in the last 90 days (win-rate denominator). */
  offersLast90dCount: number;
  /** Unread notification count. */
  unreadNotificationCount: number;
  /** Most recent 5 offers. */
  recentOffers: DealerDashboardOffer[];
  /** Most recent 5 deals. */
  recentDeals: DealerDashboardDeal[];
  /** Most recent 3 payments. */
  recentPayments: DealerDashboardPayment[];
  /** Improvement tips derived from win rate and completion metrics. */
  improvementTips: string[];
  /** Most recent scorecard tier snapshot. */
  scorecardTier: string | null;
}

const IN_PROGRESS_STATUSES: DealStatus[] = [
  "PENDING",
  "ACTIVE",
  "FINANCING_PENDING",
  "FEE_PENDING",
  "FEE_PAID",
  "INSURANCE_PENDING",
  "CONTRACT_PENDING",
  "CONTRACT_REVIEW",
  "CONTRACT_APPROVED",
  "SIGNING_PENDING",
  "SIGNED",
  "PICKUP_SCHEDULED",
];

export async function getDealerDashboardData(dealerId: string): Promise<DealerDashboardData> {
  const since90d = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  const [
    activeAuctionCount,
    inventoryCount,
    dealsInProgressCount,
    pendingPickupsCount,
    unreadNotificationCount,
    recentOffers,
    recentDeals,
    recentPayments,
    submittedOfferCount,  // actually total offers in 90d (denominator for win rate)
    acceptedOfferCount,
    latestSnapshot,
  ] = await Promise.all([
    prisma.auctionInvitation.count({
      where: { dealerId, auction: { status: "ACTIVE" } },
    }),
    prisma.inventoryItem.count({
      where: { dealerId, isActive: true },
    }),
    prisma.deal.count({
      where: { offer: { dealerId }, status: { in: IN_PROGRESS_STATUSES } },
    }),
    prisma.deal.count({
      where: { offer: { dealerId }, status: "PICKUP_SCHEDULED" },
    }),
    prisma.notification.count({
      where: { dealerId, readAt: null },
    }),
    prisma.offer.findMany({
      where: { dealerId },
      select: { id: true, auctionId: true, status: true, otdPriceCents: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.deal.findMany({
      where: { offer: { dealerId } },
      select: {
        id: true,
        status: true,
        createdAt: true,
        offer: { select: { otdPriceCents: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.dealerPayment.findMany({
      where: { dealerId },
      select: { id: true, amountCents: true, type: true, status: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 3,
    }),
    prisma.offer.count({
      // Denominator: all offers created in the period (status will have changed from SUBMITTED)
      where: { dealerId, createdAt: { gte: since90d } },
    }),
    prisma.offer.count({
      where: { dealerId, status: "ACCEPTED", createdAt: { gte: since90d } },
    }),
    prisma.dealerScorecardSnapshot.findFirst({
      where: { dealerId },
      orderBy: { snapshotDate: "desc" },
      select: { tier: true, offerWinRate: true, dealCompletionRate: true },
    }),
  ]);

  const winRatePct =
    submittedOfferCount > 0
      ? Math.round((acceptedOfferCount / submittedOfferCount) * 100)
      : 0;

  // Build improvement tips from live metrics
  const improvementTips: string[] = [];
  if (winRatePct < 20) {
    improvementTips.push(
      "Your win rate is below platform average. Review your OTD pricing versus the segment median.",
    );
  }
  if (activeAuctionCount > 0) {
    improvementTips.push(
      `You have ${activeAuctionCount} open auction invitation${activeAuctionCount !== 1 ? "s" : ""}. Responding within 6 hours increases win probability by ~40%.`,
    );
  }
  if (latestSnapshot && latestSnapshot.dealCompletionRate < 70) {
    improvementTips.push(
      "Improving deal completion rate is the fastest path to Platinum tier. Aim for 70%+.",
    );
  }
  if (improvementTips.length === 0) {
    improvementTips.push("Your metrics look strong. Stay consistent to maintain your tier.");
  }

  return {
    activeAuctionCount,
    inventoryCount,
    dealsInProgressCount,
    pendingPickupsCount,
    winRatePct,
    offersLast90dCount: submittedOfferCount,
    unreadNotificationCount,
    recentOffers,
    recentDeals,
    recentPayments,
    improvementTips,
    scorecardTier: latestSnapshot?.tier ?? null,
  };
}
