// /admin/analytics — Group 6 Admin Analytics Dashboard.
// Read-only operational nerve center: buyer pipeline, dealer outreach funnel,
// buyer acquisition sources, voice receptionist activity, and revenue.
// Server component — fetches the snapshot directly via the analytics service.
// Every section renders cleanly against an empty database (zero state).
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/admin-session";
import { getAdminAnalyticsSnapshot } from "@/lib/services/analytics/admin-analytics.service";
import { formatCentsAsUsd } from "@/lib/constants";
import {
  DollarSign, TrendingUp, Phone, Filter, Radio, BarChart2,
} from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Analytics — Admin" };

const BLUE = "#0B5FD1";
const PURPLE = "#643293";

// --- Small presentational helpers ------------------------------------------

function KPICard({
  label, value, sub, accent = BLUE,
}: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div
      data-testid={`kpi-${label.toLowerCase().replace(/\s+/g, "-")}`}
      className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-sm"
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: accent }} />
        <p className="text-[10px] font-bold text-[#94A3B8] uppercase tracking-[0.15em]">{label}</p>
      </div>
      <p className="text-3xl font-bold text-[#0F172A] font-mono tracking-tight">{value}</p>
      {sub && <p className="text-xs text-[#94A3B8] font-medium mt-1">{sub}</p>}
    </div>
  );
}

function SectionShell({
  title, icon: Icon, accent = BLUE, testId, children,
}: {
  title: string;
  icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>;
  accent?: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <section
      data-testid={testId}
      className="bg-white border border-[#E2E8F0] rounded-2xl p-5 md:p-6 shadow-sm"
    >
      <div className="flex items-center gap-2.5 mb-5">
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: `${accent}15` }}
        >
          <Icon size={15} style={{ color: accent }} />
        </div>
        <h2 className="text-sm font-bold text-[#0F172A] tracking-tight" style={{ color: accent }}>
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

// A horizontal labeled bar used across the breakdown sections.
function BarRow({
  label, value, max, accent = BLUE,
}: { label: string; value: number; max: number; accent?: string }) {
  const widthPct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-40 shrink-0 text-xs text-[#475569] truncate capitalize">
        {label.replace(/[_:]/g, " ")}
      </span>
      <div className="flex-1 h-2.5 rounded-full bg-[#F1F5F9] overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${widthPct}%`, backgroundColor: accent }} />
      </div>
      <span className="w-12 shrink-0 text-right text-xs font-bold font-mono text-[#0F172A]">
        {value.toLocaleString("en-US")}
      </span>
    </div>
  );
}

function EmptyRow({ message }: { message: string }) {
  return <p className="text-sm text-[#94A3B8] py-4 text-center">{message}</p>;
}

function recordEntries(rec: Record<string, number>): [string, number][] {
  return Object.entries(rec).sort((a, b) => b[1] - a[1]);
}

// --- Page ------------------------------------------------------------------

export default async function AdminAnalyticsPage() {
  await requireAdmin();
  const stats = await getAdminAnalyticsSnapshot();

  const buyerStatusEntries = recordEntries(stats.buyer.byStatus);
  const buyerStatusMax = Math.max(1, ...buyerStatusEntries.map(([, v]) => v));
  const dealerStatusEntries = recordEntries(stats.dealer.byStatus);
  const dealerStatusMax = Math.max(1, ...dealerStatusEntries.map(([, v]) => v));
  const channelEntries = recordEntries(stats.source.byChannel);
  const channelMax = Math.max(1, ...channelEntries.map(([, v]) => v));
  const campaignEntries = recordEntries(stats.source.byCampaign);
  const intentEntries = recordEntries(stats.voice.byIntent);
  const intentMax = Math.max(1, ...intentEntries.map(([, v]) => v));
  const trendMax = Math.max(1, ...stats.source.dailyTrend.map(d => d.count));

  return (
    <div
      data-testid="admin-analytics-page"
      className="min-h-screen bg-[#F4F6FA] p-6 md:p-8 max-w-[1400px] mx-auto space-y-6"
    >
      {/* Header */}
      <header>
        <div className="flex items-center gap-2 mb-1.5">
          <BarChart2 size={16} style={{ color: BLUE }} />
          <p className="text-[10px] text-[#94A3B8] font-semibold uppercase tracking-widest">
            Operational KPIs
          </p>
        </div>
        <h1 className="text-2xl font-bold text-[#0F172A] tracking-tight">Analytics</h1>
        <p className="text-sm text-[#94A3B8] mt-0.5">
          Last updated: {new Date(stats.generatedAt).toLocaleString("en-US")}
        </p>
      </header>

      {/* Section 1 — Business Health KPI cards */}
      <div
        data-testid="analytics-business-health"
        className="grid grid-cols-2 sm:grid-cols-4 gap-4"
      >
        <KPICard label="Buyers" value={stats.buyer.total.toLocaleString("en-US")} sub="in pipeline" />
        <KPICard label="Dealers" value={stats.dealer.total.toLocaleString("en-US")} sub="in recruitment" accent="#059669" />
        <KPICard label="Revenue MTD" value={formatCentsAsUsd(stats.revenue.totalRevenueMtdCents)} sub="this month" accent="#D97706" />
        <KPICard label="Conversion" value={`${stats.buyer.conversionRate}%`} sub="buyers → paid" accent={PURPLE} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Section 2 — Dealer outreach funnel */}
        <SectionShell title="Dealer Outreach Funnel" icon={Filter} testId="analytics-dealer-funnel">
          <div className="grid grid-cols-3 gap-3 mb-5">
            <KPICard label="Reply Rate" value={`${stats.dealer.replyRate}%`} accent="#059669" />
            <KPICard label="Bounce Rate" value={`${stats.dealer.bounceRate}%`} accent="#DC2626" />
            <KPICard label="Emails / Wk" value={stats.dealer.emailsSentThisWeek} />
          </div>
          {dealerStatusEntries.length === 0 ? (
            <EmptyRow message="No dealer prospects yet." />
          ) : (
            <div className="space-y-2.5">
              {dealerStatusEntries.map(([status, count]) => (
                <BarRow key={status} label={status} value={count} max={dealerStatusMax} accent="#059669" />
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-5 pt-4 border-t border-[#F1F5F9]">
            {[
              ["Discovered → Scripted", stats.dealer.funnelDropoff.discoveredToScripted],
              ["Scripted → Contacted", stats.dealer.funnelDropoff.scriptedToContacted],
              ["Contacted → Replied", stats.dealer.funnelDropoff.contactedToReplied],
              ["Replied → Onboarded", stats.dealer.funnelDropoff.repliedToOnboarded],
            ].map(([label, value]) => (
              <div key={label as string} className="flex items-center justify-between">
                <span className="text-[11px] text-[#94A3B8]">{label}</span>
                <span className="text-[11px] font-bold font-mono text-[#DC2626]">{value as number}% drop</span>
              </div>
            ))}
          </div>
        </SectionShell>

        {/* Section 3 — Buyer acquisition by source */}
        <SectionShell title="Buyer Acquisition by Source" icon={TrendingUp} testId="analytics-buyer-sources">
          {channelEntries.length === 0 ? (
            <EmptyRow message="No buyer opportunities yet." />
          ) : (
            <div className="space-y-2.5">
              {channelEntries.map(([channel, count]) => (
                <BarRow key={channel} label={channel} value={count} max={channelMax} />
              ))}
            </div>
          )}

          {campaignEntries.length > 0 && (
            <div className="mt-5 pt-4 border-t border-[#F1F5F9]">
              <p className="text-[10px] font-bold text-[#94A3B8] uppercase tracking-[0.15em] mb-2">Campaigns</p>
              <div className="space-y-1.5">
                {campaignEntries.map(([campaign, count]) => (
                  <div key={campaign} className="flex items-center justify-between">
                    <span className="text-xs text-[#475569] capitalize">{campaign.replace(/[_:]/g, " ")}</span>
                    <span className="text-xs font-bold font-mono text-[#0F172A]">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-5 pt-4 border-t border-[#F1F5F9]" data-testid="analytics-source-trend">
            <p className="text-[10px] font-bold text-[#94A3B8] uppercase tracking-[0.15em] mb-3">Last 14 Days</p>
            <div className="flex items-end gap-1 h-20">
              {stats.source.dailyTrend.map(d => (
                <div key={d.date} className="flex-1 flex flex-col items-center justify-end gap-1" title={`${d.date}: ${d.count}`}>
                  <div
                    className="w-full rounded-t"
                    style={{
                      height: `${Math.max(2, Math.round((d.count / trendMax) * 100))}%`,
                      backgroundColor: BLUE,
                      opacity: d.count === 0 ? 0.2 : 1,
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        </SectionShell>

        {/* Section 4 — Voice receptionist activity */}
        <SectionShell title="Voice Receptionist (Zura)" icon={Phone} accent={PURPLE} testId="analytics-voice-activity">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <KPICard label="Calls / Wk" value={stats.voice.callsThisWeek} accent={PURPLE} />
            <KPICard label="Calls / Mo" value={stats.voice.callsThisMonth} accent={PURPLE} />
            <KPICard label="Messages" value={stats.voice.messagesTaken} accent={PURPLE} />
            <KPICard label="Transfers" value={stats.voice.transfersAttempted} accent={PURPLE} />
          </div>
          {intentEntries.length === 0 ? (
            <EmptyRow message="No voice calls recorded yet." />
          ) : (
            <div className="space-y-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <Radio size={11} style={{ color: PURPLE }} />
                <p className="text-[10px] font-bold text-[#94A3B8] uppercase tracking-[0.15em]">Intent Breakdown</p>
              </div>
              {intentEntries.map(([intent, count]) => (
                <BarRow key={intent} label={intent} value={count} max={intentMax} accent={PURPLE} />
              ))}
            </div>
          )}
        </SectionShell>

        {/* Section 5 — Revenue breakdown */}
        <SectionShell title="Revenue" icon={DollarSign} accent="#D97706" testId="analytics-revenue">
          <div className="grid grid-cols-2 gap-3">
            <KPICard label="Standard Fees" value={formatCentsAsUsd(stats.revenue.standardFeesCollectedCents)} sub="deposits collected" accent="#D97706" />
            <KPICard label="Premium Fees" value={formatCentsAsUsd(stats.revenue.premiumFeesCollectedCents)} sub="service fees" accent="#D97706" />
            <KPICard label="Revenue YTD" value={formatCentsAsUsd(stats.revenue.totalRevenueYtdCents)} sub="year to date" accent="#059669" />
            <KPICard label="Refunds" value={formatCentsAsUsd(stats.revenue.refundsIssuedCents)} sub="issued" accent="#DC2626" />
          </div>
          <div className="flex items-center justify-between mt-5 pt-4 border-t border-[#F1F5F9]">
            <span className="text-xs text-[#94A3B8]">Active deals in progress</span>
            <span className="text-sm font-bold font-mono text-[#0F172A]">{stats.revenue.activeDeals}</span>
          </div>
        </SectionShell>
      </div>

      {/* New buyers context strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KPICard label="New Buyers / Wk" value={stats.buyer.newThisWeek} sub="this week" accent={BLUE} />
        <KPICard label="New Buyers / Mo" value={stats.buyer.newThisMonth} sub="this month" accent={BLUE} />
        <KPICard label="Active Deals" value={stats.revenue.activeDeals} sub="in progress" accent="#4F46E5" />
        <KPICard label="Dealers Onboarded" value={stats.dealer.byStatus.ONBOARDED ?? 0} sub="active partners" accent="#059669" />
      </div>
    </div>
  );
}
