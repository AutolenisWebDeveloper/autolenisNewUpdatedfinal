// lib/services/admin/admin-ops.service.ts — Feature 26, 29, 33 data queries
// All Prisma calls for the ops dashboard, dealer health, and admin message pages.
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RecentDeal = {
  id: string;
  status: string;
  updatedAt: Date;
  buyer: { firstName: string; lastName: string };
};

export type OpsDashboardData = {
  buyerCount: number;
  onboardedBuyerCount: number;
  prequalApprovedCount: number;
  dealerCount: number;
  dealerPendingCount: number;
  activeAuctions: number;
  closedAuctions: number;
  inProgressDeals: number;
  completedDeals: number;
  cancelledDeals: number;
  contractFails: number;
  contractPasses: number;
  messageThreads: number;
  recentDeals: RecentDeal[];
};

export type DealerHealthRow = {
  id: string;
  dealershipName: string;
  city: string | null;
  state: string | null;
  scorecardTier: string | null;
  snap: {
    tier: string;
    offerWinRate: number;
    dealCompletionRate: number;
    auctionResponseRate: number;
    avgResponseHours: number;
    junkFeeRatio: number;
    snapshotDate: Date;
  } | null;
  _count: { offers: number };
};

export type AdminMessageThread = {
  id: string;
  status: string;
  lastMessageAt: Date | null;
  messages: Array<{ content: string; isRedacted: boolean; sentAt: Date }>;
  participants: Array<{ userId: string; role: string }>;
  buyer: { userId: string; firstName: string; lastName: string } | null;
};

// ---------------------------------------------------------------------------
// Query functions
// ---------------------------------------------------------------------------

export async function getOpsDashboardData(): Promise<OpsDashboardData> {
  const [
    buyerCount,
    onboardedBuyerCount,
    prequalApprovedCount,
    dealerCount,
    dealerPendingCount,
    activeAuctions,
    closedAuctions,
    inProgressDeals,
    completedDeals,
    cancelledDeals,
    contractFails,
    contractPasses,
    messageThreads,
    recentDeals,
  ] = await Promise.all([
    prisma.buyer.count(),
    prisma.buyer.count({ where: { onboardingComplete: true } }),
    prisma.preQualification.count({ where: { decision: "APPROVED" } }),
    prisma.dealer.count({ where: { status: "ACTIVE" } }),
    prisma.dealer.count({ where: { status: "PENDING" } }),
    prisma.auction.count({ where: { status: "ACTIVE" } }),
    prisma.auction.count({ where: { status: "CLOSED" } }),
    // Deals not yet completed, cancelled, or refunded (in-progress pipeline)
    prisma.deal.count({ where: { status: { notIn: ["COMPLETED", "CANCELLED", "REFUNDED"] } } }),
    prisma.deal.count({ where: { status: "COMPLETED" } }),
    prisma.deal.count({ where: { status: { in: ["CANCELLED", "REFUNDED"] } } }),
    prisma.contractScan.count({ where: { status: "FAIL" } }),
    prisma.contractScan.count({ where: { status: "PASS" } }),
    prisma.messageThread.count({ where: { status: "ACTIVE" } }),
    prisma.deal.findMany({
      where: { status: { notIn: ["COMPLETED", "CANCELLED", "REFUNDED"] } },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: {
        id: true,
        status: true,
        updatedAt: true,
        buyer: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  return {
    buyerCount,
    onboardedBuyerCount,
    prequalApprovedCount,
    dealerCount,
    dealerPendingCount,
    activeAuctions,
    closedAuctions,
    inProgressDeals,
    completedDeals,
    cancelledDeals,
    contractFails,
    contractPasses,
    messageThreads,
    recentDeals,
  };
}

export async function getDealerHealthData(): Promise<DealerHealthRow[]> {
  const dealers = await prisma.dealer.findMany({
    where: { status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    take: 50,
    select: {
      id: true,
      dealershipName: true,
      city: true,
      state: true,
      scorecardTier: true,
      scorecardSnapshots: {
        orderBy: { snapshotDate: "desc" },
        take: 1,
        select: {
          tier: true,
          offerWinRate: true,
          dealCompletionRate: true,
          auctionResponseRate: true,
          avgResponseHours: true,
          junkFeeRatio: true,
          snapshotDate: true,
        },
      },
      _count: {
        select: { offers: true },
      },
    },
  });

  return dealers.map((d) => ({
    id: d.id,
    dealershipName: d.dealershipName,
    city: d.city,
    state: d.state,
    scorecardTier: d.scorecardTier,
    snap: d.scorecardSnapshots[0] ?? null,
    _count: d._count,
  }));
}

export type AdminThreadDetail = {
  id: string;
  status: string;
  messages: Array<{
    id: string;
    content: string;
    isRedacted: boolean;
    sentAt: Date;
    senderId: string;
  }>;
  participants: Array<{ userId: string; role: string }>;
  buyer: { userId: string; firstName: string; lastName: string } | null;
};

export async function getAdminMessageThread(threadId: string): Promise<AdminThreadDetail | null> {
  const thread = await prisma.messageThread.findUnique({
    where: { id: threadId },
    include: {
      messages: { orderBy: { sentAt: "asc" } },
      participants: { select: { userId: true, role: true } },
    },
  });
  if (!thread) return null;

  const buyerParticipant = thread.participants.find((p) => p.role === "BUYER");
  const buyer = buyerParticipant
    ? await prisma.buyer.findUnique({
        where: { userId: buyerParticipant.userId },
        select: { userId: true, firstName: true, lastName: true },
      })
    : null;

  return {
    id: thread.id,
    status: thread.status as string,
    messages: thread.messages.map((m) => ({
      id: m.id,
      content: m.content,
      isRedacted: m.isRedacted,
      sentAt: m.sentAt,
      senderId: m.senderId,
    })),
    participants: thread.participants,
    buyer,
  };
}

export async function getAdminMessageThreads(): Promise<AdminMessageThread[]> {
  const threads = await prisma.messageThread.findMany({
    orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
    take: 50,
    include: {
      messages: { orderBy: { sentAt: "desc" }, take: 1 },
      participants: { select: { userId: true, role: true } },
    },
  });

  // Enrich with buyer names
  const buyerUserIds = threads
    .flatMap((t) => t.participants)
    .filter((p) => p.role === "BUYER")
    .map((p) => p.userId);

  const buyers = buyerUserIds.length
    ? await prisma.buyer.findMany({
        where: { userId: { in: buyerUserIds } },
        select: { userId: true, firstName: true, lastName: true },
      })
    : [];

  const buyerMap = new Map(buyers.map((b) => [b.userId, b]));

  return threads.map((t) => {
    const buyerParticipant = t.participants.find((p) => p.role === "BUYER");
    const buyer = buyerParticipant ? (buyerMap.get(buyerParticipant.userId) ?? null) : null;
    return {
      id: t.id,
      status: t.status as string,
      lastMessageAt: t.lastMessageAt,
      messages: t.messages.map((m) => ({
        content: m.content,
        isRedacted: m.isRedacted,
        sentAt: m.sentAt,
      })),
      participants: t.participants,
      buyer,
    };
  });
}
