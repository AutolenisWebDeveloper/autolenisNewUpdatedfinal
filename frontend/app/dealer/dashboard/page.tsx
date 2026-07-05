import type { Metadata } from "next";
import { requireDealer } from "@/lib/auth/dealer-session";
import { getDealerDashboardData } from "@/lib/services/dealer/dealer-dashboard.service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import PageContainer from "@/components/dashboard/PageContainer";
import PageHeader from "@/components/dashboard/PageHeader";
import StatCard from "@/components/dashboard/StatCard";
import Panel from "@/components/dashboard/Panel";
import EmptyState from "@/components/dashboard/EmptyState";
import { CARD, FIGURE } from "@/components/dashboard/tokens";
import {
  Gavel, Package, TrendingUp, ArrowRight, Star, Handshake,
  Truck, Lightbulb, CheckCircle2, Inbox, FileText,
} from "lucide-react";
import Link from "next/link";

export const metadata: Metadata = { title: "Dealer Dashboard" };
export const dynamic = "force-dynamic";

// ── helpers ──────────────────────────────────────────────────────────────────
function offerStatusColor(status: string) {
  if (status === "ACCEPTED") return "bg-emerald-500";
  if (status === "SUBMITTED") return "bg-[#0B5FD1]";
  return "bg-slate-300";
}

function dealStatusVariant(status: string): "green" | "blue" | "secondary" {
  if (["SIGNED", "PICKUP_COMPLETE", "COMPLETED"].includes(status)) return "green";
  if (["CONTRACT_PENDING", "CONTRACT_REVIEW", "CONTRACT_APPROVED", "SIGNING_PENDING", "PICKUP_SCHEDULED"].includes(status)) return "blue";
  return "secondary";
}

function paymentTypeColor(type: string) {
  if (type === "COMMISSION") return "text-emerald-600";
  if (type === "BONUS") return "text-[#0B5FD1]";
  if (type === "CLAWBACK") return "text-red-600";
  return "text-slate-600";
}

// ── page ─────────────────────────────────────────────────────────────────────
export default async function DealerDashboard() {
  const dealer = await requireDealer();
  const data = await getDealerDashboardData(dealer.id);

  return (
    <PageContainer testId="dealer-dashboard">

      {/* ── 1. Dealer identity header ───────────────────────────────────────── */}
      <div data-testid="dealer-identity-header">
        <PageHeader
          eyebrow={
            <>
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
            </>
          }
          title={dealer.dealershipName}
          subtitle="Your marketplace performance at a glance"
          actions={
            data.activeAuctionCount > 0 ? (
              <Button size="sm" href="/dealer/auctions" data-testid="header-respond-auctions-btn">
                <Gavel size={14} /> Respond to Auctions
              </Button>
            ) : undefined
          }
        />
      </div>

      {/* ── 7. Active auction invitation alert — the money moment, so it leads ── */}
      {data.activeAuctionCount > 0 && (
        <div
          className="relative overflow-hidden bg-gradient-to-r from-[#0B5FD1] to-[#0A4DB8] rounded-2xl p-6 text-white mb-6 shadow-md shadow-[#0B5FD1]/20"
          data-testid="active-auctions-banner"
        >
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-start gap-4">
              <div className="w-11 h-11 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center shrink-0">
                <Gavel size={20} className="text-white" />
              </div>
              <div>
                <p className="text-[11px] font-semibold text-white/60 uppercase tracking-[0.14em] mb-1">Action required</p>
                <h2 className="text-xl font-bold">
                  {data.activeAuctionCount} active auction invitation{data.activeAuctionCount !== 1 ? "s" : ""}
                </h2>
                <p className="text-sm text-white/70 mt-1">
                  Submit your best offer before the 48-hour window closes. Responding within 6 hours raises win probability by ~40%.
                </p>
              </div>
            </div>
            <Button
              className="bg-white text-[#0B5FD1] hover:bg-white/90 shrink-0 font-semibold"
              href="/dealer/auctions"
              data-testid="view-auctions-btn"
            >
              View Auctions <ArrowRight size={14} />
            </Button>
          </div>
        </div>
      )}

      {/* ── 2–6. KPI stat cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-8" data-testid="dealer-kpi-grid">
        <StatCard
          label="Active Auctions"
          value={String(data.activeAuctionCount)}
          sub={data.activeAuctionCount > 0 ? "awaiting your offer" : "no open invitations"}
          icon={Gavel}
          tone="brand"
          live={data.activeAuctionCount > 0}
          href="/dealer/auctions"
          testId="stat-active-auctions"
        />
        <StatCard
          label="Inventory Items"
          value={String(data.inventoryCount)}
          sub="active listings"
          icon={Package}
          tone="indigo"
          href="/dealer/inventory"
          testId="stat-inventory"
        />
        <StatCard
          label="Deals in Progress"
          value={String(data.dealsInProgressCount)}
          sub="accepted → pickup"
          icon={Handshake}
          tone="success"
          href="/dealer/deals"
          testId="stat-deals-in-progress"
        />
        <StatCard
          label="Win Rate (90d)"
          value={`${data.winRatePct}%`}
          sub={data.offersLast90dCount > 0
            ? `of ${data.offersLast90dCount} offer${data.offersLast90dCount !== 1 ? "s" : ""} submitted`
            : "no offers in 90 days"}
          icon={TrendingUp}
          tone="warning"
          href="/dealer/scorecard"
          testId="stat-win-rate"
        />
        <StatCard
          label="Pending Pickups"
          value={String(data.pendingPickupsCount)}
          sub="scheduled handoffs"
          icon={Truck}
          tone="danger"
          href="/dealer/pickups"
          testId="stat-pending-pickups"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

        {/* ── 8. Recent Offers ──────────────────────────────────────────────── */}
        <Panel
          title="Recent Offers"
          action={{ label: "View all →", href: "/dealer/offers", testId: "view-all-offers-link" }}
          flush
          testId="recent-offers"
        >
          {data.recentOffers.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="No offers yet"
              body="Respond to an auction invitation to submit your first offer."
              action={{ label: "Open auctions", href: "/dealer/auctions" }}
            />
          ) : (
            <div className="divide-y divide-slate-100">
              {data.recentOffers.map(offer => (
                <Link
                  key={offer.id}
                  href={`/dealer/offers/${offer.id}`}
                  data-testid={`recent-offer-${offer.id}`}
                  className="flex items-center justify-between px-5 py-3.5 hover:bg-slate-50/70 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${offerStatusColor(offer.status)}`} />
                    <span className={`text-sm ${FIGURE} font-semibold`}>
                      ${(offer.otdPriceCents / 100).toLocaleString()}
                    </span>
                    <Badge variant="secondary" className="text-xs">{offer.status}</Badge>
                  </div>
                  <span className="text-xs text-slate-400 font-mono">{offer.createdAt.toLocaleDateString()}</span>
                </Link>
              ))}
            </div>
          )}
        </Panel>

        {/* ── 9. Recent Deals ───────────────────────────────────────────────── */}
        <Panel
          title="Recent Deals"
          action={{ label: "View all →", href: "/dealer/deals", testId: "view-all-deals-link" }}
          flush
          testId="recent-deals"
        >
          {data.recentDeals.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No deals yet"
              body="Accepted offers become deals and will appear here."
            />
          ) : (
            <div className="divide-y divide-slate-100">
              {data.recentDeals.map(deal => (
                <Link
                  key={deal.id}
                  href={`/dealer/deals/${deal.id}`}
                  data-testid={`recent-deal-${deal.id}`}
                  className="flex items-center justify-between px-5 py-3.5 hover:bg-slate-50/70 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-slate-800 font-mono">
                      #{deal.id.slice(0, 8)}
                    </span>
                    <Badge variant={dealStatusVariant(deal.status)} className="text-xs">
                      {deal.status}
                    </Badge>
                  </div>
                  <span className={`text-xs ${FIGURE} font-semibold text-slate-600`}>
                    ${((deal.offer?.otdPriceCents ?? 0) / 100).toLocaleString()}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* ── 10. Scorecard teaser ────────────────────────────────────────────── */}
        <div className={`${CARD} p-5`} data-testid="scorecard-teaser">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                <Star size={17} className="text-amber-500" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">Performance Scorecard</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Current tier: <strong className="text-slate-700">{data.scorecardTier ?? dealer.tier}</strong>
                  {" · "}
                  Win rate: <strong className="text-slate-700">{data.winRatePct}%</strong> (90d)
                </p>
              </div>
            </div>
            <Button size="sm" variant="outline" href="/dealer/scorecard" data-testid="view-scorecard-btn">
              View Scorecard
            </Button>
          </div>
        </div>

        {/* ── 11. Payments summary teaser ─────────────────────────────────────── */}
        <Panel
          title="Recent Payments"
          action={{ label: "View all →", href: "/dealer/payments", testId: "view-payments-link" }}
          testId="payments-teaser"
        >
          {data.recentPayments.length === 0 ? (
            <p className="text-sm text-slate-400 py-2">No payment records yet.</p>
          ) : (
            <div className="space-y-2.5">
              {data.recentPayments.map(p => (
                <div key={p.id} data-testid={`dashboard-payment-${p.id}`}
                  className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={13} className={p.status === "PAID" ? "text-emerald-500" : "text-slate-300"} />
                    <span className={`font-medium ${paymentTypeColor(p.type)}`}>{p.type}</span>
                  </div>
                  <span className={`${FIGURE} text-sm text-slate-700`}>${(p.amountCents / 100).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* ── 12. Improvement tips ────────────────────────────────────────────── */}
      <Panel title="Insights & Tips" testId="improvement-tips">
        <div className="flex items-start gap-3.5">
          <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
            <Lightbulb size={15} className="text-amber-500" />
          </div>
          <ul className="space-y-2 pt-1">
            {data.improvementTips.map((tip, i) => (
              <li key={i} data-testid={`improvement-tip-${i}`} className="flex items-start gap-2 text-sm text-slate-600 leading-relaxed">
                <span className="w-1.5 h-1.5 rounded-full bg-[#0B5FD1]/40 shrink-0 mt-1.5" />
                {tip}
              </li>
            ))}
          </ul>
        </div>
      </Panel>

    </PageContainer>
  );
}
