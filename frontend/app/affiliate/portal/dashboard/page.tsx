import { requireAffiliate } from "@/lib/auth/affiliate-session";
import { getCommissionSummary, getNetworkSize } from "@/lib/services/affiliate/commission.service";
import { getReferralClickStats } from "@/lib/services/affiliate/referral.service";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import PageContainer from "@/components/ui/patterns/PageContainer";
import PageHeader from "@/components/ui/patterns/PageHeader";
import StatCard from "@/components/ui/patterns/StatCard";
import Panel from "@/components/ui/patterns/Panel";
import EmptyState from "@/components/ui/patterns/EmptyState";
import { FIGURE } from "@/components/ui/patterns/tokens";
import {
  DollarSign, Users, Clock, XCircle, AlertTriangle,
  TrendingUp, Calculator, Landmark, FileCheck, Share2, Inbox,
} from "lucide-react";
import Link from "next/link";
import ReferralCodeCard from "@/components/affiliate/ReferralCodeCard";
import { COMMISSION_RATES, PREMIUM_FEE_CENTS } from "@/lib/constants";

export const dynamic = "force-dynamic";

export default async function AffiliateDashboardPage() {
  const affiliate = await requireAffiliate();

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [summary, network, recentCommissions, thisMonth, clickStats, profile] = await Promise.all([
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
    getReferralClickStats(affiliate.id),
    prisma.affiliateProfile
      .findUnique({ where: { affiliateId: affiliate.id }, select: { firstName: true } })
      .catch(() => null),
  ]);

  const referralLink = `${(process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim()}/auth/signup?ref=${affiliate.referralCode}`;

  // Prefer the real onboarding profile name; fall back to a cleaned email
  // prefix (first segment before "." or "_", trailing digits stripped) —
  // e.g. "mark.ist678" → "Mark".
  const rawPrefix = affiliate.user.email.split("@")[0];
  const firstSegment = rawPrefix.split(/[._]/)[0].replace(/\d+$/, "");
  const emailDerivedName = firstSegment
    ? firstSegment.charAt(0).toUpperCase() + firstSegment.slice(1).toLowerCase()
    : rawPrefix;
  const firstName = profile?.firstName?.trim() || emailDerivedName;

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
    <PageContainer testId="affiliate-dashboard">
      <PageHeader
        eyebrow={
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500 font-semibold">L{affiliate.level} Affiliate</span>
            <span className="text-slate-300">·</span>
            <Badge variant={
              affiliate.status === "ACTIVE" ? "green" :
              affiliate.status === "PENDING" ? "amber" : "destructive"
            } className="text-xs">{affiliate.status}</Badge>
          </div>
        }
        title={<>{greeting}, {firstName}</>}
        subtitle="Your affiliate performance at a glance"
      />

      {/* Status banners */}
      {isPending && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-6 flex items-start gap-4" data-testid="status-banner-pending">
          <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
            <Clock size={17} className="text-amber-600" />
          </div>
          <div>
            <p className="font-semibold text-amber-900 mb-0.5">Application under review</p>
            <p className="text-sm text-amber-800">
              Our team is reviewing your application (typically within 2 business days). Once approved, your referral code will unlock here.
            </p>
          </div>
        </div>
      )}

      {isRejected && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5 mb-6 flex items-start gap-4" data-testid="status-banner-rejected">
          <div className="w-9 h-9 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
            <XCircle size={17} className="text-red-600" />
          </div>
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
        <div className="bg-slate-100 border border-slate-300 rounded-2xl p-5 mb-6 flex items-start gap-4" data-testid="status-banner-suspended">
          <div className="w-9 h-9 rounded-xl bg-slate-200 flex items-center justify-center shrink-0">
            <AlertTriangle size={17} className="text-slate-600" />
          </div>
          <div>
            <p className="font-semibold text-slate-900 mb-0.5">Account suspended</p>
            <p className="text-sm text-slate-700">Your affiliate account is currently suspended. Please contact support for more information.</p>
          </div>
        </div>
      )}

      {/* KPI cards — 4 horizontal */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6" data-testid="kpi-cards">
        <StatCard
          label="Total Earned"
          value={`$${(summary.totalCents / 100).toLocaleString()}`}
          sub="all-time · settled, reversed excluded"
          icon={DollarSign}
          tone="success"
          href="/affiliate/portal/earnings"
          testId="kpi-total-earned"
        />
        <StatCard
          label="This Month"
          value={`$${(thisMonthCents / 100).toLocaleString()}`}
          sub={`${thisMonthCount} commission${thisMonthCount !== 1 ? "s" : ""}`}
          icon={TrendingUp}
          tone="brand"
          href="/affiliate/portal/earnings"
          testId="kpi-this-month"
        />
        <StatCard
          label="Pending"
          value={`$${(summary.pendingCents / 100).toLocaleString()}`}
          sub="awaiting payout"
          icon={Clock}
          tone="warning"
          href="/affiliate/portal/finance"
          testId="kpi-pending"
        />
        <StatCard
          label="Network Size"
          value={String(networkTotal)}
          sub={`${network.l1} direct · ${network.l2} L2 · ${network.l3} L3`}
          icon={Users}
          tone="indigo"
          href="/affiliate/portal/network"
          testId="kpi-network"
        />
      </div>

      {/* Two-column body */}
      {isActive && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
          {/* LEFT: Referral code + this month performance */}
          <div className="space-y-4">
            <ReferralCodeCard referralCode={affiliate.referralCode} referralLink={referralLink} />
            <Panel title="This Month">
              <dl className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <dt className="text-sm text-slate-500">Commissions earned</dt>
                  <dd className={`text-sm ${FIGURE}`}>${(thisMonthCents / 100).toFixed(2)}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-sm text-slate-500">Deals converted</dt>
                  <dd className={`text-sm ${FIGURE}`} data-testid="this-month-count">{thisMonthCount}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-sm text-slate-500">Est. per deal (L1)</dt>
                  <dd className={`text-sm ${FIGURE}`}>${(L1_PER_DEAL / 100).toFixed(2)}</dd>
                </div>
              </dl>
            </Panel>

            {/* Group 8 (8A) — referral link click funnel */}
            <Panel title="Referral Link Activity" testId="referral-click-funnel">
              <dl className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <dt className="text-sm text-slate-500">Link clicks (all-time)</dt>
                  <dd className={`text-sm ${FIGURE}`} data-testid="referral-total-clicks">{clickStats.totalClicks}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-sm text-slate-500">Clicks this month</dt>
                  <dd className={`text-sm ${FIGURE}`} data-testid="referral-clicks-month">{clickStats.clicksThisMonth}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-sm text-slate-500">Converted to signups</dt>
                  <dd className={`text-sm ${FIGURE}`} data-testid="referral-converted-clicks">{clickStats.convertedClicks}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-sm text-slate-500">Conversion rate</dt>
                  <dd className={`text-sm ${FIGURE}`} data-testid="referral-conversion-rate">{clickStats.conversionRate}%</dd>
                </div>
              </dl>
            </Panel>
          </div>

          {/* RIGHT: Recent commissions */}
          <Panel
            title="Recent Commissions"
            action={{ label: "View all →", href: "/affiliate/portal/earnings", testId: "view-all-earnings-link" }}
            flush
          >
            {recentCommissions.length === 0 ? (
              <EmptyState
                icon={Inbox}
                title="No commissions yet"
                body="Share your referral link — commissions land here as your referrals convert."
                action={{ label: "Open referral hub", href: "/affiliate/portal/referral-hub" }}
              />
            ) : (
              <div className="divide-y divide-slate-100">
                {recentCommissions.map((c) => (
                  <div key={c.id} data-testid={`commission-item-${c.id}`} className="flex items-center justify-between px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <Badge variant={c.status === "PAID" ? "green" : c.status === "APPROVED" ? "blue" : "secondary"} className="text-[10px]">{c.status}</Badge>
                      <span className="text-xs text-slate-500">Level {c.level}</span>
                      <span className="text-xs text-slate-400 font-mono">{new Date(c.createdAt).toLocaleDateString()}</span>
                    </div>
                    <span className={`text-sm ${FIGURE}`}>${(c.amountCents / 100).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
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
              className="flex flex-col items-center gap-2 bg-white border border-slate-200/80 rounded-2xl p-4 hover:border-al-primary/30 hover:shadow-sm transition-all text-center group"
            >
              <div className="w-9 h-9 rounded-xl bg-al-primary-subtle flex items-center justify-center group-hover:bg-[#DBEAFE]/60 transition-colors">
                <a.icon size={16} className="text-al-primary" />
              </div>
              <span className="text-xs font-semibold text-slate-700">{a.label}</span>
            </Link>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
