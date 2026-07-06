// Feature 26 — Real-Time Operations Dashboard
// Shows live platform metrics derived from real Prisma data.
// No fake KPIs: all numbers come directly from DB counts/aggregates.

import { requireAdmin } from "@/lib/auth/admin-session";
import { getOpsDashboardData } from "@/lib/services/admin/admin-ops.service";
import Link from "next/link";
import {
  Activity,
  Users,
  Building2,
  Gavel,
  FileText,
  Shield,
  AlertOctagon,
  Clock,
  CheckCircle2,
  XCircle,
  MessageSquare,
} from "lucide-react";

export const dynamic = "force-dynamic";

export default async function OpsDashboard() {
  await requireAdmin();

  const {
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
  } = await getOpsDashboardData();

  const topMetrics = [
    { label: "Total Buyers", value: buyerCount, icon: Users, href: "/admin/buyers", color: "text-blue-600" },
    { label: "Onboarded", value: onboardedBuyerCount, icon: CheckCircle2, href: "/admin/buyers", color: "text-green-600" },
    { label: "Pre-Qualified", value: prequalApprovedCount, icon: Shield, href: "/admin/buyers", color: "text-al-primary" },
    { label: "Active Dealers", value: dealerCount, icon: Building2, href: "/admin/dealers", color: "text-al-primary" },
    { label: "Dealers Pending", value: dealerPendingCount, icon: Clock, href: "/admin/dealers", color: "text-amber-600" },
    { label: "Live Auctions", value: activeAuctions, icon: Gavel, href: "/admin/auctions", color: "text-green-600" },
    { label: "Auctions Closed", value: closedAuctions, icon: Gavel, href: "/admin/auctions", color: "text-slate-500" },
    { label: "In-Progress Deals", value: inProgressDeals, icon: FileText, href: "/admin/deals", color: "text-amber-600" },
    { label: "Completed Deals", value: completedDeals, icon: CheckCircle2, href: "/admin/deals", color: "text-green-600" },
    { label: "Cancelled/Refunded", value: cancelledDeals, icon: XCircle, href: "/admin/deals", color: "text-red-500" },
    { label: "Contract Fails", value: contractFails, icon: AlertOctagon, href: "/admin/contract-shield", color: "text-red-600" },
    { label: "Active Threads", value: messageThreads, icon: MessageSquare, href: "/admin/messages", color: "text-al-primary" },
  ];

  const DEAL_STATUS_LABEL: Record<string, string> = {
    PENDING: "Pending",
    ACTIVE: "Active",
    FINANCING_PENDING: "Financing Pending",
    FEE_PENDING: "Fee Pending",
    FEE_PAID: "Fee Paid",
    INSURANCE_PENDING: "Insurance Pending",
    CONTRACT_PENDING: "Contract Pending",
    CONTRACT_REVIEW: "Contract Review",
    CONTRACT_APPROVED: "Contract Approved",
    SIGNING_PENDING: "Signing Pending",
    SIGNED: "Signed",
    PICKUP_SCHEDULED: "Pickup Scheduled",
    PICKUP_COMPLETE: "Pickup Complete",
  };

  return (
    <div className="p-6 md:p-8 max-w-7xl" data-testid="ops-dashboard-page">
      <div className="flex items-center gap-3 mb-8">
        <Activity size={22} className="text-al-primary" />
        <div>
          <h1 className="text-xl font-bold text-slate-900">Operations Dashboard</h1>
          <p className="text-xs text-slate-400 mt-0.5">All metrics reflect live database state · Feature 26</p>
        </div>
      </div>

      {/* Top metrics grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 mb-8">
        {topMetrics.map(m => (
          <Link
            key={m.label}
            href={m.href}
            data-testid={`ops-metric-${m.label.toLowerCase().replace(/\s+/g, "-")}`}
            className="bg-white border border-slate-200 rounded-xl p-4 hover:border-al-primary/30 hover:shadow-sm transition-all"
          >
            <m.icon size={15} className={`${m.color} mb-2`} />
            <p className="text-2xl font-bold text-slate-900">{m.value}</p>
            <p className="text-xs text-slate-500 mt-0.5 leading-tight">{m.label}</p>
          </Link>
        ))}
      </div>

      {/* Funnel + contract + messaging summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-white border border-slate-200 rounded-xl p-5" data-testid="ops-funnel-card">
          <p className="font-semibold text-slate-800 text-sm mb-3">Conversion Funnel Summary</p>
          <div className="space-y-2 text-sm">
            {[
              { label: "Buyers", value: buyerCount },
              { label: "Onboarded", value: onboardedBuyerCount },
              { label: "Pre-Qualified", value: prequalApprovedCount },
              { label: "In-Progress Deals", value: inProgressDeals },
              { label: "Completed", value: completedDeals },
            ].map(row => (
              <div key={row.label} className="flex justify-between items-center">
                <span className="text-slate-600">{row.label}</span>
                <span className="font-semibold text-slate-900">{row.value.toLocaleString()}</span>
              </div>
            ))}
          </div>
          <Link href="/admin/reports/funnel" className="block mt-4 text-xs text-al-primary hover:underline" data-testid="ops-full-funnel-link">
            Full funnel analytics →
          </Link>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5" data-testid="ops-contract-card">
          <p className="font-semibold text-slate-800 text-sm mb-3">Contract Shield Status</p>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-slate-600">Passed</span>
              <span className="font-semibold text-green-700">{contractPasses.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-600">Failed</span>
              <span className="font-semibold text-red-700">{contractFails.toLocaleString()}</span>
            </div>
          </div>
          <Link href="/admin/contract-shield" className="block mt-4 text-xs text-al-primary hover:underline" data-testid="ops-contract-link">
            Contract Shield queue →
          </Link>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5" data-testid="ops-messaging-card">
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare size={15} className="text-al-primary" />
            <p className="font-semibold text-slate-800 text-sm">Active Threads</p>
          </div>
          <p className="text-3xl font-bold text-slate-900">{messageThreads}</p>
          <p className="text-xs text-slate-500 mt-1">Open buyer↔admin threads</p>
          <Link href="/admin/messages" className="block mt-4 text-xs text-al-primary hover:underline" data-testid="ops-messages-link">
            Manage messages →
          </Link>
        </div>
      </div>

      {/* In-progress deals */}
      <div data-testid="ops-active-deals">
        <div className="flex items-center justify-between mb-3">
          <p className="font-semibold text-slate-800 text-sm">In-Progress Deals</p>
          <Link href="/admin/deals" className="text-xs text-al-primary hover:underline" data-testid="ops-all-deals-link">
            View all
          </Link>
        </div>
        {recentDeals.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-400 text-sm" data-testid="ops-no-deals">
            No active deals at this time.
          </div>
        ) : (
          <div className="space-y-1.5">
            {recentDeals.map(deal => (
              <Link
                key={deal.id}
                href={`/admin/deals/${deal.id}`}
                data-testid={`ops-deal-row-${deal.id}`}
                className="flex items-center justify-between bg-white border border-slate-100 rounded-lg px-4 py-2.5 hover:border-al-primary/30 transition-colors"
              >
                <div>
                  <p className="text-sm font-medium text-slate-800">
                    {deal.buyer.firstName} {deal.buyer.lastName}
                  </p>
                  <p className="text-xs text-slate-400">{deal.id.slice(0, 8)}</p>
                </div>
                <div className="text-right">
                  <span className="text-xs font-semibold text-al-primary bg-al-primary/10 px-2 py-0.5 rounded-full">
                    {DEAL_STATUS_LABEL[deal.status] ?? deal.status}
                  </span>
                  <p className="text-xs text-slate-400 mt-0.5">{deal.updatedAt.toLocaleDateString()}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
