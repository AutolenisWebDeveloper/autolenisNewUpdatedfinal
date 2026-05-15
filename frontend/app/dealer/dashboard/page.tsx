import { requireDealer } from "@/lib/auth/dealer-session";
import { getDealerDashboardData } from "@/lib/services/dealer/dealer-dashboard.service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Gavel, Package, TrendingUp, ArrowRight, Star, Handshake,
  Truck, CreditCard, Lightbulb, CheckCircle2,
} from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

// ── helpers ──────────────────────────────────────────────────────────────────
function offerStatusColor(status: string) {
  if (status === "ACCEPTED") return "bg-green-500";
  if (status === "SUBMITTED") return "bg-blue-500";
  return "bg-slate-300";
}

function dealStatusVariant(status: string): "green" | "blue" | "secondary" {
  if (["SIGNED", "PICKUP_COMPLETE", "COMPLETED"].includes(status)) return "green";
  if (["CONTRACT_PENDING", "CONTRACT_REVIEW", "CONTRACT_APPROVED", "SIGNING_PENDING", "PICKUP_SCHEDULED"].includes(status)) return "blue";
  return "secondary";
}

function paymentTypeColor(type: string) {
  if (type === "COMMISSION") return "text-green-600";
  if (type === "BONUS") return "text-blue-600";
  if (type === "CLAWBACK") return "text-red-600";
  return "text-slate-600";
}

// ── page ─────────────────────────────────────────────────────────────────────
export default async function DealerDashboard() {
  const dealer = await requireDealer();
  const data = await getDealerDashboardData(dealer.id);

  return (
    <div className="p-6 md:p-8 max-w-5xl" data-testid="dealer-dashboard">

      {/* ── 1. Dealer identity header ───────────────────────────────────────── */}
      <div className="mb-8" data-testid="dealer-identity-header">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          {dealer.dealershipName}
        </h1>
        <div className="flex flex-wrap items-center gap-2 mt-1">
          <Badge variant={dealer.status === "ACTIVE" ? "green" : "amber"} data-testid="dealer-status-badge">
            {dealer.status}
          </Badge>
          <Badge variant="secondary" data-testid="dealer-tier-badge">Tier: {dealer.tier}</Badge>
          {data.unreadNotificationCount > 0 && (
            <Link href="/dealer/notifications">
              <Badge variant="destructive" data-testid="dealer-unread-badge">
                {data.unreadNotificationCount} unread
              </Badge>
            </Link>
          )}
        </div>
      </div>

      {/* ── 2–6. KPI stat cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-8" data-testid="dealer-kpi-grid">
        {/* 2. Active Auctions */}
        <Link href="/dealer/auctions"
          data-testid="stat-active-auctions"
          className="bg-white border border-slate-200 rounded-xl p-4 hover:border-[#0B5FD1]/30 hover:shadow-sm transition-all">
          <div className="flex items-start justify-between mb-2">
            <Gavel size={16} className="text-[#0B5FD1]" />
            <ArrowRight size={12} className="text-slate-300" />
          </div>
          <p className="text-2xl font-bold text-slate-900">{data.activeAuctionCount}</p>
          <p className="text-xs text-slate-500 mt-0.5">Active Auctions</p>
        </Link>

        {/* 3. Inventory */}
        <Link href="/dealer/inventory"
          data-testid="stat-inventory"
          className="bg-white border border-slate-200 rounded-xl p-4 hover:border-[#0B5FD1]/30 hover:shadow-sm transition-all">
          <div className="flex items-start justify-between mb-2">
            <Package size={16} className="text-blue-600" />
            <ArrowRight size={12} className="text-slate-300" />
          </div>
          <p className="text-2xl font-bold text-slate-900">{data.inventoryCount}</p>
          <p className="text-xs text-slate-500 mt-0.5">Inventory Items</p>
        </Link>

        {/* 4. Deals in Progress */}
        <Link href="/dealer/deals"
          data-testid="stat-deals-in-progress"
          className="bg-white border border-slate-200 rounded-xl p-4 hover:border-[#0B5FD1]/30 hover:shadow-sm transition-all">
          <div className="flex items-start justify-between mb-2">
            <Handshake size={16} className="text-emerald-600" />
            <ArrowRight size={12} className="text-slate-300" />
          </div>
          <p className="text-2xl font-bold text-slate-900">{data.dealsInProgressCount}</p>
          <p className="text-xs text-slate-500 mt-0.5">Deals in Progress</p>
        </Link>

        {/* 5. Win Rate */}
        <Link href="/dealer/scorecard"
          data-testid="stat-win-rate"
          className="bg-white border border-slate-200 rounded-xl p-4 hover:border-[#0B5FD1]/30 hover:shadow-sm transition-all">
          <div className="flex items-start justify-between mb-2">
            <TrendingUp size={16} className="text-amber-600" />
            <ArrowRight size={12} className="text-slate-300" />
          </div>
          <p className="text-2xl font-bold text-slate-900">{data.winRatePct}%</p>
          <p className="text-xs text-slate-500 mt-0.5">Win Rate (90d)</p>
        </Link>

        {/* 6. Pending Pickups */}
        <Link href="/dealer/pickups"
          data-testid="stat-pending-pickups"
          className="bg-white border border-slate-200 rounded-xl p-4 hover:border-[#0B5FD1]/30 hover:shadow-sm transition-all">
          <div className="flex items-start justify-between mb-2">
            <Truck size={16} className="text-rose-600" />
            <ArrowRight size={12} className="text-slate-300" />
          </div>
          <p className="text-2xl font-bold text-slate-900">{data.pendingPickupsCount}</p>
          <p className="text-xs text-slate-500 mt-0.5">Pending Pickups</p>
        </Link>
      </div>

      {/* ── 7. Active auction invitation alert ─────────────────────────────── */}
      {data.activeAuctionCount > 0 && (
        <div className="bg-[#0B5FD1] rounded-2xl p-6 text-white mb-6" data-testid="active-auctions-banner">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-white/60 mb-1">Action required</p>
              <h2 className="text-xl font-bold">
                {data.activeAuctionCount} active auction invitation{data.activeAuctionCount !== 1 ? "s" : ""}
              </h2>
              <p className="text-sm text-white/70 mt-1">
                Submit your best offer before the 48-hour window closes.
              </p>
            </div>
            <Button
              className="bg-white/20 text-white border border-white/30 hover:bg-white/30 shrink-0"
              href="/dealer/auctions"
              data-testid="view-auctions-btn"
            >
              View Auctions <ArrowRight size={14} />
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

        {/* ── 8. Recent Offers ──────────────────────────────────────────────── */}
        <div data-testid="recent-offers">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-slate-900 text-sm">Recent Offers</h2>
            <Link href="/dealer/offers" className="text-xs text-[#0B5FD1] hover:underline" data-testid="view-all-offers-link">
              View all
            </Link>
          </div>
          {data.recentOffers.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl px-5 py-8 text-center text-sm text-slate-400">
              No offers yet — respond to an auction invitation to get started.
            </div>
          ) : (
            <div className="space-y-2">
              {data.recentOffers.map(offer => (
                <Link
                  key={offer.id}
                  href={`/dealer/offers/${offer.id}`}
                  data-testid={`recent-offer-${offer.id}`}
                  className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-4 py-3 hover:border-[#0B5FD1]/20 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${offerStatusColor(offer.status)}`} />
                    <span className="text-sm font-medium text-slate-800">
                      ${(offer.otdPriceCents / 100).toLocaleString()}
                    </span>
                    <Badge variant="secondary" className="text-xs">{offer.status}</Badge>
                  </div>
                  <span className="text-xs text-slate-400">{offer.createdAt.toLocaleDateString()}</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* ── 9. Recent Deals ───────────────────────────────────────────────── */}
        <div data-testid="recent-deals">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-slate-900 text-sm">Recent Deals</h2>
            <Link href="/dealer/deals" className="text-xs text-[#0B5FD1] hover:underline" data-testid="view-all-deals-link">
              View all
            </Link>
          </div>
          {data.recentDeals.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl px-5 py-8 text-center text-sm text-slate-400">
              No deals yet. Accepted offers will appear here.
            </div>
          ) : (
            <div className="space-y-2">
              {data.recentDeals.map(deal => (
                <Link
                  key={deal.id}
                  href={`/dealer/deals/${deal.id}`}
                  data-testid={`recent-deal-${deal.id}`}
                  className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-4 py-3 hover:border-[#0B5FD1]/20 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-slate-800 font-mono">
                      #{deal.id.slice(0, 8)}
                    </span>
                    <Badge variant={dealStatusVariant(deal.status)} className="text-xs">
                      {deal.status}
                    </Badge>
                  </div>
                  <span className="text-xs text-slate-400">
                    ${((deal.offer?.otdPriceCents ?? 0) / 100).toLocaleString()}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── 10. Scorecard teaser ────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-4" data-testid="scorecard-teaser">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Star size={18} className="text-amber-500" />
            <div>
              <p className="text-sm font-semibold text-slate-900">Performance Scorecard</p>
              <p className="text-xs text-slate-400">
                Current tier: <strong>{data.scorecardTier ?? dealer.tier}</strong>
                {" · "}
                Win rate: <strong>{data.winRatePct}%</strong> (90d)
              </p>
            </div>
          </div>
          <Button size="sm" variant="secondary" href="/dealer/scorecard" data-testid="view-scorecard-btn">
            View Scorecard
          </Button>
        </div>
      </div>

      {/* ── 11. Payments summary teaser ─────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-4" data-testid="payments-teaser">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <CreditCard size={18} className="text-[#0B5FD1]" />
            <p className="text-sm font-semibold text-slate-900">Recent Payments</p>
          </div>
          <Link href="/dealer/payments" className="text-xs text-[#0B5FD1] hover:underline" data-testid="view-payments-link">
            View all
          </Link>
        </div>
        {data.recentPayments.length === 0 ? (
          <p className="text-sm text-slate-400">No payment records yet.</p>
        ) : (
          <div className="space-y-2">
            {data.recentPayments.map(p => (
              <div key={p.id} data-testid={`dashboard-payment-${p.id}`}
                className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={13} className={p.status === "PAID" ? "text-green-500" : "text-slate-300"} />
                  <span className={`font-medium ${paymentTypeColor(p.type)}`}>{p.type}</span>
                </div>
                <span className="text-slate-700 font-semibold">${(p.amountCents / 100).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 12. Improvement tips ────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl p-5" data-testid="improvement-tips">
        <div className="flex items-center gap-2 mb-3">
          <Lightbulb size={16} className="text-amber-500" />
          <p className="text-sm font-semibold text-slate-900">Insights &amp; Tips</p>
        </div>
        <ul className="space-y-2">
          {data.improvementTips.map((tip, i) => (
            <li key={i} data-testid={`improvement-tip-${i}`} className="flex items-start gap-2 text-sm text-slate-600">
              <span className="w-1.5 h-1.5 rounded-full bg-[#0B5FD1]/40 shrink-0 mt-1.5" />
              {tip}
            </li>
          ))}
        </ul>
      </div>

    </div>
  );
}

