// lib/services/analytics/admin-analytics.service.ts
// Group 6 — Admin Analytics Dashboard data layer.
//
// READ-ONLY. Every function queries Prisma directly (no HTTP calls), wraps
// its work in try/catch, and degrades to a safe empty/zero state on error so
// the dashboard always renders — even on a brand-new, empty database.
//
// All money is returned in cents (the codebase-wide convention) and formatted
// for display with `formatCentsAsUsd` at the page layer. Never hardcode fee
// amounts — read them from real payment records.

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Shared date helpers — single "now" per request keeps every window aligned.
// ---------------------------------------------------------------------------
function windowBoundaries() {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  return { now, weekAgo, startOfMonth, startOfYear };
}

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10; // one decimal place
}

// ---------------------------------------------------------------------------
// Section 1 — Buyer pipeline
// ---------------------------------------------------------------------------
export interface BuyerPipelineStats {
  total: number;
  byStatus: Record<string, number>;
  newThisWeek: number;
  newThisMonth: number;
  conversionRate: number; // % of buyer opportunities that resulted in a paid deposit
}

const EMPTY_BUYER: BuyerPipelineStats = {
  total: 0,
  byStatus: {},
  newThisWeek: 0,
  newThisMonth: 0,
  conversionRate: 0,
};

export async function getBuyerPipelineStats(): Promise<BuyerPipelineStats> {
  try {
    const { weekAgo, startOfMonth } = windowBoundaries();

    const [total, byTemperature, newThisWeek, newThisMonth, paidDeposits] =
      await Promise.all([
        prisma.buyerOpportunity.count(),
        prisma.buyerOpportunity.groupBy({
          by: ["leadTemperature"],
          _count: { _all: true },
        }),
        prisma.buyerOpportunity.count({ where: { createdAt: { gte: weekAgo } } }),
        prisma.buyerOpportunity.count({ where: { createdAt: { gte: startOfMonth } } }),
        prisma.deposit.count({ where: { status: "PAID" } }),
      ]);

    const byStatus: Record<string, number> = {};
    for (const row of byTemperature) {
      byStatus[row.leadTemperature ?? "unscored"] = row._count._all;
    }

    return {
      total,
      byStatus,
      newThisWeek,
      newThisMonth,
      conversionRate: pct(paidDeposits, total),
    };
  } catch (err) {
    logger.error("[group-6] getBuyerPipelineStats failed", err);
    return EMPTY_BUYER;
  }
}

// ---------------------------------------------------------------------------
// Section 2 — Dealer outreach funnel
// ---------------------------------------------------------------------------
export interface DealerOutreachStats {
  total: number;
  byStatus: Record<string, number>;
  emailsSentThisWeek: number;
  emailsSentThisMonth: number;
  replyRate: number;
  bounceRate: number;
  funnelDropoff: {
    discoveredToScripted: number;
    scriptedToContacted: number;
    contactedToReplied: number;
    repliedToOnboarded: number;
  };
}

const EMPTY_DEALER: DealerOutreachStats = {
  total: 0,
  byStatus: {},
  emailsSentThisWeek: 0,
  emailsSentThisMonth: 0,
  replyRate: 0,
  bounceRate: 0,
  funnelDropoff: {
    discoveredToScripted: 0,
    scriptedToContacted: 0,
    contactedToReplied: 0,
    repliedToOnboarded: 0,
  },
};

export async function getDealerOutreachStats(): Promise<DealerOutreachStats> {
  try {
    const { weekAgo, startOfMonth } = windowBoundaries();

    const [
      total,
      byStatusRows,
      reachedScripted,
      reachedContacted,
      reachedReplied,
      reachedOnboarded,
      emailsSentThisWeek,
      emailsSentThisMonth,
      totalEmails,
      bouncedEmails,
    ] = await Promise.all([
      prisma.dealerProspect.count(),
      prisma.dealerProspect.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.dealerProspect.count({ where: { scriptedAt: { not: null } } }),
      prisma.dealerProspect.count({ where: { contactedAt: { not: null } } }),
      prisma.dealerProspect.count({ where: { repliedAt: { not: null } } }),
      prisma.dealerProspect.count({ where: { onboardedAt: { not: null } } }),
      prisma.dealerOutreachLog.count({
        where: { channel: "email", sentAt: { gte: weekAgo } },
      }),
      prisma.dealerOutreachLog.count({
        where: { channel: "email", sentAt: { gte: startOfMonth } },
      }),
      prisma.dealerOutreachLog.count({ where: { channel: "email" } }),
      prisma.dealerOutreachLog.count({
        where: { channel: "email", status: "bounced" },
      }),
    ]);

    const byStatus: Record<string, number> = {};
    for (const row of byStatusRows) byStatus[row.status] = row._count._all;

    return {
      total,
      byStatus,
      emailsSentThisWeek,
      emailsSentThisMonth,
      replyRate: pct(reachedReplied, reachedContacted),
      bounceRate: pct(bouncedEmails, totalEmails),
      funnelDropoff: {
        discoveredToScripted: pct(total - reachedScripted, total),
        scriptedToContacted: pct(reachedScripted - reachedContacted, reachedScripted),
        contactedToReplied: pct(reachedContacted - reachedReplied, reachedContacted),
        repliedToOnboarded: pct(reachedReplied - reachedOnboarded, reachedReplied),
      },
    };
  } catch (err) {
    logger.error("[group-6] getDealerOutreachStats failed", err);
    return EMPTY_DEALER;
  }
}

// ---------------------------------------------------------------------------
// Section 3 — Buyer acquisition by source
// ---------------------------------------------------------------------------
export interface BuyerSourceStats {
  byChannel: Record<string, number>;
  byCampaign: Record<string, number>;
  dailyTrend: { date: string; count: number }[]; // last 14 days
}

const EMPTY_SOURCE: BuyerSourceStats = {
  byChannel: {},
  byCampaign: {},
  dailyTrend: [],
};

export async function getBuyerSourceStats(): Promise<BuyerSourceStats> {
  try {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    fourteenDaysAgo.setHours(0, 0, 0, 0);

    const [bySourceRows, recent] = await Promise.all([
      prisma.buyerOpportunity.groupBy({ by: ["source"], _count: { _all: true } }),
      prisma.buyerOpportunity.findMany({
        where: { createdAt: { gte: fourteenDaysAgo } },
        select: { createdAt: true },
      }),
    ]);

    const byChannel: Record<string, number> = {};
    const byCampaign: Record<string, number> = {};
    for (const row of bySourceRows) {
      const source = row.source ?? "unknown";
      const count = row._count._all;
      if (source.startsWith("lp_campaign:")) {
        byCampaign[source] = (byCampaign[source] ?? 0) + count;
      }
      // Bucket the channel by the part before any ":" qualifier.
      const channel = source.split(":")[0] || "unknown";
      byChannel[channel] = (byChannel[channel] ?? 0) + count;
    }

    // Seed the last 14 dates with zero so the trend has no gaps.
    const trendMap = new Map<string, number>();
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      trendMap.set(d.toISOString().slice(0, 10), 0);
    }
    for (const opp of recent) {
      const key = opp.createdAt.toISOString().slice(0, 10);
      if (trendMap.has(key)) trendMap.set(key, (trendMap.get(key) ?? 0) + 1);
    }

    return {
      byChannel,
      byCampaign,
      dailyTrend: [...trendMap.entries()].map(([date, count]) => ({ date, count })),
    };
  } catch (err) {
    logger.error("[group-6] getBuyerSourceStats failed", err);
    return EMPTY_SOURCE;
  }
}

// ---------------------------------------------------------------------------
// Section 4 — Voice receptionist (Zura) activity
// ---------------------------------------------------------------------------
export interface VoiceStats {
  callsThisWeek: number;
  callsThisMonth: number;
  byIntent: Record<string, number>;
  messagesTaken: number;
  transfersAttempted: number; // populated once Zura Phase 3 is live
}

const EMPTY_VOICE: VoiceStats = {
  callsThisWeek: 0,
  callsThisMonth: 0,
  byIntent: {},
  messagesTaken: 0,
  transfersAttempted: 0,
};

export async function getVoiceStats(): Promise<VoiceStats> {
  try {
    const { weekAgo, startOfMonth } = windowBoundaries();
    // A voice opportunity is one Zura classified an intent for (callReason set).
    const voiceWhere = { callReason: { not: null } } as const;

    const [callsThisWeek, callsThisMonth, byIntentRows, messagesTaken, transfersAttempted] =
      await Promise.all([
        prisma.buyerOpportunity.count({
          where: { ...voiceWhere, createdAt: { gte: weekAgo } },
        }),
        prisma.buyerOpportunity.count({
          where: { ...voiceWhere, createdAt: { gte: startOfMonth } },
        }),
        prisma.buyerOpportunity.groupBy({
          by: ["callReason"],
          where: voiceWhere,
          _count: { _all: true },
        }),
        prisma.buyerOpportunity.count({ where: { callReason: "message" } }),
        prisma.buyerOpportunity.count({ where: { callReason: "transfer_request" } }),
      ]);

    const byIntent: Record<string, number> = {};
    for (const row of byIntentRows) {
      if (row.callReason) byIntent[row.callReason] = row._count._all;
    }

    return { callsThisWeek, callsThisMonth, byIntent, messagesTaken, transfersAttempted };
  } catch (err) {
    logger.error("[group-6] getVoiceStats failed", err);
    return EMPTY_VOICE;
  }
}

// ---------------------------------------------------------------------------
// Section 5 — Revenue (all amounts in cents)
// ---------------------------------------------------------------------------
export interface RevenueStats {
  standardFeesCollectedCents: number; // deposits collected from Standard buyers
  premiumFeesCollectedCents: number; // service fees collected from Premium buyers
  totalRevenueMtdCents: number;
  totalRevenueYtdCents: number;
  refundsIssuedCents: number;
  activeDeals: number;
}

const EMPTY_REVENUE: RevenueStats = {
  standardFeesCollectedCents: 0,
  premiumFeesCollectedCents: 0,
  totalRevenueMtdCents: 0,
  totalRevenueYtdCents: 0,
  refundsIssuedCents: 0,
  activeDeals: 0,
};

export async function getRevenueStats(): Promise<RevenueStats> {
  try {
    const { startOfMonth, startOfYear } = windowBoundaries();

    const [
      standardFees,
      premiumFees,
      depositsMtd,
      feesMtd,
      depositsYtd,
      feesYtd,
      depositRefunds,
      feeRefunds,
      activeDeals,
    ] = await Promise.all([
      // Standard plan buyers pay the upfront deposit only.
      prisma.deposit.aggregate({
        _sum: { amountCents: true },
        where: { status: "PAID", buyer: { plan: "STANDARD" } },
      }),
      // Premium plan service fees collected at closing.
      prisma.deal.aggregate({
        _sum: { feeAmountCents: true },
        where: { feePaidAt: { not: null } },
      }),
      prisma.deposit.aggregate({
        _sum: { amountCents: true },
        where: { status: "PAID", createdAt: { gte: startOfMonth } },
      }),
      prisma.deal.aggregate({
        _sum: { feeAmountCents: true },
        where: { feePaidAt: { gte: startOfMonth } },
      }),
      prisma.deposit.aggregate({
        _sum: { amountCents: true },
        where: { status: "PAID", createdAt: { gte: startOfYear } },
      }),
      prisma.deal.aggregate({
        _sum: { feeAmountCents: true },
        where: { feePaidAt: { gte: startOfYear } },
      }),
      prisma.deposit.aggregate({
        _sum: { amountCents: true },
        where: { status: "REFUNDED" },
      }),
      prisma.deal.aggregate({
        _sum: { feeRefundedAmountCents: true },
        where: { feeRefundedAt: { not: null } },
      }),
      prisma.deal.count({
        where: { status: { notIn: ["COMPLETED", "CANCELLED", "REFUNDED"] } },
      }),
    ]);

    return {
      standardFeesCollectedCents: standardFees._sum.amountCents ?? 0,
      premiumFeesCollectedCents: premiumFees._sum.feeAmountCents ?? 0,
      totalRevenueMtdCents:
        (depositsMtd._sum.amountCents ?? 0) + (feesMtd._sum.feeAmountCents ?? 0),
      totalRevenueYtdCents:
        (depositsYtd._sum.amountCents ?? 0) + (feesYtd._sum.feeAmountCents ?? 0),
      refundsIssuedCents:
        (depositRefunds._sum.amountCents ?? 0) +
        (feeRefunds._sum.feeRefundedAmountCents ?? 0),
      activeDeals,
    };
  } catch (err) {
    logger.error("[group-6] getRevenueStats failed", err);
    return EMPTY_REVENUE;
  }
}

// ---------------------------------------------------------------------------
// Aggregate — one call powering the whole dashboard.
// ---------------------------------------------------------------------------
export interface AdminAnalyticsSnapshot {
  buyer: BuyerPipelineStats;
  dealer: DealerOutreachStats;
  source: BuyerSourceStats;
  voice: VoiceStats;
  revenue: RevenueStats;
  generatedAt: string;
}

export async function getAdminAnalyticsSnapshot(): Promise<AdminAnalyticsSnapshot> {
  const [buyer, dealer, source, voice, revenue] = await Promise.all([
    getBuyerPipelineStats(),
    getDealerOutreachStats(),
    getBuyerSourceStats(),
    getVoiceStats(),
    getRevenueStats(),
  ]);
  return { buyer, dealer, source, voice, revenue, generatedAt: new Date().toISOString() };
}
