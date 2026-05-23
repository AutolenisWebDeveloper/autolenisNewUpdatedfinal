import { requireDealer } from "@/lib/auth/dealer-session";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { Gavel, Clock, ArrowRight } from "lucide-react";
import { bucketBudgetCents } from "@/lib/utils/buyer-budget";

export const dynamic = "force-dynamic";

function formatTimeRemaining(endsAt: Date | null, now: Date): string {
  if (!endsAt) return "No deadline";
  const ms = endsAt.getTime() - now.getTime();
  if (ms <= 0) return "Closed";
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  if (days >= 1) return `${days}d ${hours}h left`;
  if (hours >= 1) return `${hours}h left`;
  const minutes = totalMinutes % 60;
  return `${Math.max(1, minutes)}m left`;
}

function vehicleLabel(v: { year: number | null; make: string | null; model: string | null; trim: string | null } | undefined): string {
  if (!v) return "Vehicle details pending";
  const parts = [v.year, v.make, v.model, v.trim].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "Vehicle details pending";
}

export default async function DealerAuctionsPage() {
  const dealer = await requireDealer();
  const now = new Date();

  // Pull all invitations for this dealer with everything needed to render
  // each card without an N+1.
  const invitations = await prisma.auctionInvitation.findMany({
    where: { dealerId: dealer.id },
    include: {
      auction: {
        select: {
          id: true,
          status: true,
          endsAt: true,
          buyerId: true,
          vehicles: {
            take: 1,
            select: { year: true, make: true, model: true, trim: true },
          },
        },
      },
    },
  });

  // Resolve this dealer's submitted offers for each auction in one query
  // and the buyer budget per auction (anonymized to a range).
  const auctionIds = invitations.map((i) => i.auction.id);
  const buyerIds = Array.from(new Set(invitations.map((i) => i.auction.buyerId)));

  const [myOffers, prequals] = await Promise.all([
    prisma.offer.findMany({
      where: { auctionId: { in: auctionIds }, dealerId: dealer.id },
      select: { auctionId: true, status: true, otdPriceCents: true },
    }),
    prisma.preQualification.findMany({
      where: { buyerId: { in: buyerIds } },
      select: { buyerId: true, maxOtdAmountCents: true },
    }),
  ]);

  const offerByAuction = new Map(myOffers.map((o) => [o.auctionId, o]));
  const budgetByBuyer = new Map(
    prequals.map((p) => [p.buyerId, bucketBudgetCents(p.maxOtdAmountCents)]),
  );

  // State classification — orders states for grouped rendering.
  type RowState = "active-no-bid" | "active-bid-submitted" | "won" | "lost" | "expired" | "declined";
  const classify = (inv: typeof invitations[number]): RowState => {
    const offer = offerByAuction.get(inv.auction.id);
    const closed = inv.auction.status !== "ACTIVE";
    if (offer?.status === "ACCEPTED") return "won";
    if (closed && offer) return "lost";
    if (offer?.status === "WITHDRAWN" && inv.respondedAt) return "declined";
    if (closed) return "expired";
    if (offer && offer.status === "SUBMITTED") return "active-bid-submitted";
    return "active-no-bid";
  };

  const rows = invitations.map((inv) => ({ inv, state: classify(inv) }));

  // Active first, by deadline ascending. Past rows by status precedence.
  const active = rows
    .filter((r) => r.state === "active-no-bid" || r.state === "active-bid-submitted")
    .sort((a, b) => {
      const aEnd = a.inv.auction.endsAt?.getTime() ?? Number.POSITIVE_INFINITY;
      const bEnd = b.inv.auction.endsAt?.getTime() ?? Number.POSITIVE_INFINITY;
      return aEnd - bEnd;
    });
  const past = rows
    .filter((r) => r.state !== "active-no-bid" && r.state !== "active-bid-submitted")
    .sort((a, b) => {
      const aEnd = a.inv.auction.endsAt?.getTime() ?? 0;
      const bEnd = b.inv.auction.endsAt?.getTime() ?? 0;
      return bEnd - aEnd;
    });

  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="dealer-auctions-page">
      <div className="flex items-center gap-3 mb-6">
        <Gavel size={22} className="text-[#0B5FD1]" />
        <h1 className="text-xl font-bold text-slate-900">Auction Invitations</h1>
        {active.length > 0 && <Badge>{active.length} active</Badge>}
      </div>

      {active.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Active — Sorted by deadline</h2>
          <div className="space-y-3">
            {active.map(({ inv, state }) => {
              const vehicle = vehicleLabel(inv.auction.vehicles[0]);
              const budget = budgetByBuyer.get(inv.auction.buyerId);
              const submitted = state === "active-bid-submitted";
              const offer = offerByAuction.get(inv.auction.id);
              return (
                <Link
                  key={inv.id}
                  href={`/dealer/auctions/${inv.auction.id}`}
                  data-testid={`active-auction-${inv.id}`}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white border-2 border-[#0B5FD1]/20 rounded-xl p-5 hover:border-[#0B5FD1] transition-colors min-h-[44px]"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                      <Badge variant={submitted ? "secondary" : "green"}>
                        {submitted ? "Bid Submitted" : "Awaiting Bid"}
                      </Badge>
                    </div>
                    <p className="font-semibold text-slate-900 truncate">{vehicle}</p>
                    <p className="text-xs text-slate-500 mt-1">
                      Buyer budget: {budget?.label ?? "Not specified"}
                    </p>
                    <p className="text-xs text-slate-500" data-testid="deadline-countdown">
                      {formatTimeRemaining(inv.auction.endsAt, now)}
                      {inv.auction.endsAt ? ` · closes ${inv.auction.endsAt.toLocaleString()}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {submitted && offer ? (
                      <div className="text-right">
                        <p className="text-xs text-slate-500">Your OTD</p>
                        <p className="text-sm font-semibold text-slate-900">
                          ${(offer.otdPriceCents / 100).toLocaleString()}
                        </p>
                      </div>
                    ) : (
                      <p className="text-sm font-semibold text-[#0B5FD1]">Submit Offer</p>
                    )}
                    <ArrowRight size={14} className="text-slate-400" />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {past.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Past Auctions</h2>
          <div className="space-y-2">
            {past.map(({ inv, state }) => {
              const vehicle = vehicleLabel(inv.auction.vehicles[0]);
              const stateMeta: Record<typeof state, { label: string; variant: "green" | "gray" | "secondary" | "destructive" }> = {
                "won": { label: "Won", variant: "green" },
                "lost": { label: "Lost", variant: "gray" },
                "expired": { label: "Expired", variant: "gray" },
                "declined": { label: "Declined", variant: "secondary" },
                "active-no-bid": { label: "Active", variant: "green" },
                "active-bid-submitted": { label: "Bid Submitted", variant: "secondary" },
              };
              const meta = stateMeta[state];
              return (
                <div
                  key={inv.id}
                  data-testid={`past-auction-${inv.id}`}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-white border border-slate-200 rounded-xl px-5 py-4 min-h-[44px]"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                      <span className="text-xs text-slate-400">
                        {(inv.auction.endsAt ?? inv.sentAt).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-sm text-slate-700 truncate">{vehicle}</p>
                  </div>
                  {state === "won" ? (
                    <Link
                      href={`/dealer/deals?auctionId=${inv.auction.id}`}
                      className="text-xs font-semibold text-[#0B5FD1] hover:underline shrink-0"
                    >
                      Open Deal →
                    </Link>
                  ) : state === "declined" ? (
                    <span className="text-xs text-slate-400 shrink-0">You declined this invitation</span>
                  ) : (
                    <Link
                      href={`/dealer/auctions/${inv.auction.id}/insights`}
                      className="text-xs text-[#0B5FD1] hover:underline shrink-0"
                      data-testid={`view-insights-${inv.id}`}
                    >
                      View Insights →
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {invitations.length === 0 && (
        <div className="text-center py-20 bg-white border border-slate-200 rounded-xl" data-testid="no-auctions">
          <Clock size={32} className="text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500">No auction invitations yet</p>
          <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
            Invitations are sent based on your inventory match, tier, and capacity. They&apos;ll appear
            here as soon as a buyer auction matches your profile.
          </p>
        </div>
      )}
    </div>
  );
}
