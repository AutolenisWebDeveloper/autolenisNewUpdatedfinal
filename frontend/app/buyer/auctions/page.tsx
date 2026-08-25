import type { Metadata } from "next";

export const metadata: Metadata = { title: "My Auctions" };

import { requireBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Gavel } from "lucide-react";
import EmptyState from "@/components/buyer/EmptyState";

export const dynamic = "force-dynamic";

export default async function AuctionsPage() {
  const buyer = await requireBuyer();
  const auctions = await prisma.auction.findMany({
    where: { buyerId: buyer.id },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { offers: true } },
    },
  });

  const statusVariant: Record<string, "green" | "amber" | "gray" | "blue"> = {
    ACTIVE: "green", PENDING: "amber", CLOSED: "gray", EXPIRED: "gray", CANCELLED: "gray",
  };

  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="auctions-list-page">
      <h1 className="text-xl font-bold text-slate-900 mb-6">My Auctions</h1>

      {auctions.length === 0 ? (
        <EmptyState
          scenario="no-auctions"
          icon={Gavel}
          tone="active"
          heading="No active auctions yet"
          body="Complete your vehicle request and pay the $99 Auction Access Deposit to launch your 48-hour dealer auction."
          cta={{ label: "Start My Auction", href: "/buyer/deposit" }}
        />
      ) : (
        <div className="space-y-3">
          {auctions.map((auction) => (
            <Link key={auction.id} href={`/buyer/auction/${auction.id}`} data-testid={`auction-list-item-${auction.id}`}
              className="flex items-center justify-between bg-white border border-slate-200 rounded-xl p-5 hover:border-al-primary hover:shadow-sm transition-all">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant={statusVariant[auction.status] ?? "gray"}>{auction.status}</Badge>
                  {auction.status === "ACTIVE" && (
                    <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                  )}
                </div>
                {auction._count.offers > 0 && (
                  <p className="text-xs font-semibold text-al-primary mt-1"
                    data-testid={`auction-offer-count-${auction.id}`}>
                    {auction._count.offers} offer{auction._count.offers !== 1 ? "s" : ""} received
                  </p>
                )}
                {auction.status === "ACTIVE" && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-[#10B981] font-medium mt-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse" />
                    Live auction
                  </span>
                )}
                <p className="text-sm text-slate-500">
                  Started: {auction.startedAt?.toLocaleDateString() ?? "Pending"}
                  {auction.endsAt && ` · Closes: ${auction.endsAt.toLocaleDateString()}`}
                </p>
              </div>
              <ArrowRight size={16} className="text-slate-400" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
