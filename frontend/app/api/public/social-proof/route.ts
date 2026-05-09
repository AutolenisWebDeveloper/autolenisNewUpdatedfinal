import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Phase 1 — Live Social Proof Bar
// Returns anonymized recent activity for public display.
// No PII: buyer names are first-name + last initial only; no emails, phones, addresses.

export const dynamic = "force-dynamic";
export const revalidate = 120; // 2-minute cache

interface SocialProofEvent {
  type: "deal_completed" | "auction_started" | "buyer_joined";
  label: string;
  location?: string;
  timeAgoMinutes: number;
}

async function getRecentActivity(): Promise<SocialProofEvent[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000); // last 24 h
  const now = Date.now();

  try {
    const [recentDeals, recentAuctions, recentBuyers] = await Promise.all([
      prisma.deal.findMany({
        where: { status: "COMPLETED", updatedAt: { gte: since } },
        select: {
          updatedAt: true,
          buyer: { select: { firstName: true, lastName: true, city: true, state: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: 5,
      }),
      prisma.auction.findMany({
        where: { status: "ACTIVE", createdAt: { gte: since } },
        select: {
          createdAt: true,
          buyer: { select: { city: true, state: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      prisma.buyer.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true, city: true, state: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
    ]);

    const events: SocialProofEvent[] = [];

    for (const deal of recentDeals) {
      const first = deal.buyer?.firstName ?? "";
      const last = deal.buyer?.lastName ?? "";
      const name = first && last.length > 0 ? `${first} ${last.charAt(0)}.` : first || "A buyer";
      const loc =
        deal.buyer?.city && deal.buyer?.state
          ? `${deal.buyer.city}, ${deal.buyer.state}`
          : deal.buyer?.state ?? undefined;
      events.push({
        type: "deal_completed",
        label: `${name} completed their deal`,
        location: loc,
        timeAgoMinutes: Math.round((now - deal.updatedAt.getTime()) / 60_000),
      });
    }

    for (const auction of recentAuctions) {
      const loc =
        auction.buyer?.city && auction.buyer?.state
          ? `${auction.buyer.city}, ${auction.buyer.state}`
          : auction.buyer?.state ?? undefined;
      events.push({
        type: "auction_started",
        label: "A new auction just launched",
        location: loc,
        timeAgoMinutes: Math.round((now - auction.createdAt.getTime()) / 60_000),
      });
    }

    for (const buyer of recentBuyers) {
      const loc =
        buyer.city && buyer.state ? `${buyer.city}, ${buyer.state}` : buyer.state ?? undefined;
      events.push({
        type: "buyer_joined",
        label: "A new buyer joined AutoLenis",
        location: loc,
        timeAgoMinutes: Math.round((now - buyer.createdAt.getTime()) / 60_000),
      });
    }

    // Sort by most recent first
    events.sort((a, b) => a.timeAgoMinutes - b.timeAgoMinutes);

    return events.slice(0, 8);
  } catch {
    // DB unavailable — return empty (bar will not render)
    return [];
  }
}

export async function GET() {
  const events = await getRecentActivity();
  return NextResponse.json({ success: true, data: events });
}
