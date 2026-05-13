import { requireAffiliate } from "@/lib/auth/affiliate-session";
import { getCommissionSummary, getNetworkSize } from "@/lib/services/affiliate/commission.service";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import {
  DollarSign, Users, ArrowRight, Clock, XCircle, AlertTriangle,
  TrendingUp, Calculator, Landmark, FileCheck, Share2,
} from "lucide-react";
import Link from "next/link";
import ReferralCodeCard from "@/components/affiliate/ReferralCodeCard";
import { COMMISSION_RATES, PREMIUM_FEE_CENTS } from "@/lib/constants";

export const dynamic = "force-dynamic";

export default async function AffiliateDashboardPage() {
  const affiliate = await requireAffiliate();

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [summary, network, recentCommissions, thisMonth] = await Promise.all([
    getCommissionSummary(affiliate.id),
    getNetworkSize(affiliate.id),
    prisma.commission.findMany({
      where: { affiliateId: affiliate.id },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.commission.aggregate({
      where: { affiliateId: affiliate.id, createdAt: { gte: startOfMonth } },
      _sum: { amountCents: true },
      _count: true,
    }),
  ]);

  const referralLink = `${(process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim()}/auth/signup?ref=${affiliate.referralCode}`;
  // Clean up email prefix: take the first segment before "." or "_", strip trailing digits,
  // then capitalise. e.g. "mark.ist678" → "Mark", "jane_doe@..." → "Jane".
  const rawPrefix = affiliate.user.email.split("@")[0];
  const firstSegment = rawPrefix.split(/[._]/)[0].replace(/\d+$/, "");
  const firstName = firstSegment
    ? firstSegment.charAt(0).toUpperCase() + firstSegment.slice(1).toLowerCase()
    : rawPrefix;
  const isActive = affiliate.status === "ACTIVE";
  const isPending = affiliate.status === "PENDING";
  const isRejected = affiliate.status === "REJECTED";
  const isSuspended = affiliate.status === "SUSPENDED";

  const networkTotal = network.l1 + network.l2 + network.l3;
  const thisMonthCents = thisMonth._sum.amountCents ?? 0;
  const thisMonthCount = thisMonth._count;

  const hour = now.getHours();
  // Server time is intentional — fintech-grade apps commonly use server timezone for greetings.
  // Client-side hydration of the greeting is unnecessary overhead for this use case.
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  // Per-deal earnings from constants
  const L1_PER_DEAL = PREMIUM_FEE_CENTS * COMMISSION_RATES.LEVEL_1;

  return (
    <div className="p-6 md:p-8 max-w-5xl" data-testid="affiliate-dashboard">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2.5 flex-wrap mb-1">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            {greeting}, {firstName}
          </h1>
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-slate-500 font-medium">L{affiliate.level} Affiliate</span>
            <span className="text-slate-300">·</span>
            <Badge variant={
              affiliate.status === "ACTIVE" ? "green" :
              affiliate.status === "PENDING" ? "amber" : "destructive"
            } className="text-xs">{affiliate.status}</Badge>
          </div>
        </div>
        <p className="text-sm text-slate-500">Your affiliate performance at a glance</p>
      </div>

      {/* Status banners */}
      {isPending && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-6 flex items-start gap-4" data-testid="status-banner-pending">
          <Clock size={20} className="text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-amber-900 mb-0.5">Application under review</p>
            <p className="text-sm text-amber-800">
              Our team is reviewing your application (typically within 2 business days). Once approved, your referral code will unlock here.
            </p>
          </div>
        </div>
      )}

      {isRejected && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 mb-6 flex items-start gap-4" data-testid="status-banner-rejected">
          <XCircle size={20} className="text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-red-900 mb-0.5">Application not approved</p>
            <p className="text-sm text-red-800">
              Your application was not approved at this time.{" "}
              <Link href="/for-buyers" className="underline font-semibold hover:text-red-950">Explore as a buyer →</Link>
            </p>
          </div>
        </div>
      )}

      {isSuspended && (
        <div className="bg-slate-100 border border-slate-300 rounded-xl p-5 mb-6 flex items-start gap-4" data-testid="status-banner-suspended">
          <AlertTriangle size={20} className="text-slate-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-slate-900 mb-0.5">Account suspended</p>
            <p className="text-sm text-slate-700">Your affiliate account is currently suspended. Please contact support for more information.</p>
          </div>
        </div>
      )}

      {/* KPI cards — 4 horizontal */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6" data-testid="kpi-cards">
        {[
          {
            label: "Total Earned",
            value: `$${(summary.totalCents / 100).toLocaleString()}`,
            sub: "all-time",
            icon: DollarSign,
            color: "text-green-600",
            bg: "bg-green-50",
            href: "/affiliate/portal/earnings",
            testid: "kpi-total-earned",
          },
          {
            label: "This Month",
            value: `$${(thisMonthCents / 100).toLocaleString()}`,
            sub: `${thisMonthCount} commission${thisMonthCount !== 1 ? "s" : ""}`,
            icon: TrendingUp,
            color: "text-[#0B5FD1]",
            bg: "bg-[#0B5FD1]/10",
            href: "/affiliate/portal/earnings",
            testid: "kpi-this-month",
          },
          {
            label: "Pending",
            value: `$${(summary.pendingCents / 100).toLocaleString()}`,
            sub: "awaiting payout",
            icon: Clock,
            color: "text-amber-600",
            bg: "bg-amber-50",
            href: "/affiliate/portal/finance",
            testid: "kpi-pending",
          },
          {
            label: "Network Size",
            value: String(networkTotal),
            sub: `${network.l1} direct · ${network.l2} L2 · ${network.l3} L3`,
            icon: Users,
            color: "text-blue-600",
            bg: "bg-blue-50",
            href: "/affiliate/portal/network",
            testid: "kpi-network",
          },
        ].map((stat) => (
          <Link
            key={stat.label}
            href={stat.href}
            data-testid={stat.testid}
            className="bg-white border border-slate-200 rounded-xl p-4 hover:border-[#0B5FD1]/30 hover:shadow-sm transition-all group"
          >
            <div className="flex items-center justify-between mb-2.5">
              <div className={`p-1.5 rounded-lg ${stat.bg}`}>
                <stat.icon size={15} className={stat.color} />
              </div>
              <ArrowRight size={12} className="text-slate-300 group-hover:text-[#0B5FD1] transition-colors" />
            </div>
            <p className="text-xl font-bold text-slate-900">{stat.value}</p>
            <p className="text-xs text-slate-500 mt-0.5 font-medium">{stat.label}</p>
            <p className="text-xs text-slate-400 mt-0.5">{stat.sub}</p>
          </Link>
        ))}
      </div>

      {/* Two-column body */}
      {isActive && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
          {/* LEFT: Referral code + this month performance */}
          <div className="space-y-4">
            <ReferralCodeCard referralCode={affiliate.referralCode} referralLink={referralLink} />
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">This Month</p>
              <dl className="space-y-2">
                <div className="flex items-center justify-between">
                  <dt className="text-sm text-slate-500">Commissions earned</dt>
                  <dd className="text-sm font-semibold text-slate-900">${(thisMonthCents / 100).toFixed(2)}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-sm text-slate-500">Deals converted</dt>
                  <dd className="text-sm font-semibold text-slate-900" data-testid="this-month-count">{thisMonthCount}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-sm text-slate-500">Est. per deal (L1)</dt>
                  <dd className="text-sm font-semibold text-slate-900">${(L1_PER_DEAL / 100).toFixed(2)}</dd>
                </div>
              </dl>
            </div>
          </div>

          {/* RIGHT: Recent commissions */}
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Recent Commissions</p>
              <Link href="/affiliate/portal/earnings" className="text-xs text-[#0B5FD1] hover:underline font-medium" data-testid="view-all-earnings-link">
                View all →
              </Link>
            </div>
            {recentCommissions.length === 0 ? (
              <p className="text-sm text-slate-400 py-6 text-center">No commissions yet. Start referring!</p>
            ) : (
              <div className="space-y-2">
                {recentCommissions.map((c) => (
                  <div key={c.id} data-testid={`commission-item-${c.id}`} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                    <div className="flex items-center gap-2.5">
                      <Badge variant={c.status === "PAID" ? "green" : c.status === "APPROVED" ? "blue" : "secondary"} className="text-[10px]">{c.status}</Badge>
                      <span className="text-xs text-slate-500">Level {c.level}</span>
                      <span className="text-xs text-slate-400">{new Date(c.createdAt).toLocaleDateString()}</span>
                    </div>
                    <span className="font-semibold text-slate-900 text-sm">${(c.amountCents / 100).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Quick Actions row */}
      {isActive && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="quick-actions">
          {[
            { label: "Income Calculator", href: "/affiliate/portal/income-calculator", icon: Calculator },
            { label: "Finance Hub",        href: "/affiliate/portal/finance",           icon: Landmark },
            { label: "Documents",          href: "/affiliate/portal/documents",         icon: FileCheck },
            { label: "Referral Hub",       href: "/affiliate/portal/referral-hub",      icon: Share2 },
          ].map((a) => (
            <Link
              key={a.label}
              href={a.href}
              data-testid={`quick-action-${a.label.toLowerCase().replace(/\s+/g, "-")}`}
              className="flex flex-col items-center gap-2 bg-white border border-slate-200 rounded-xl p-4 hover:border-[#0B5FD1]/40 hover:shadow-sm transition-all text-center"
            >
              <div className="p-2 bg-[#0B5FD1]/10 rounded-lg">
                <a.icon size={16} className="text-[#0B5FD1]" />
              </div>
              <span className="text-xs font-semibold text-slate-700">{a.label}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
