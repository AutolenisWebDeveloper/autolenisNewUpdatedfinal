// AMIPS — Executive Intelligence Dashboard (server component).
//
// Renders the decision-grade view of the AMIPS intelligence engine: a national
// health index, an auto-generated insight feed, market-opportunity rankings,
// vehicle-segment intelligence, content performance, and risk monitoring.
// Infrastructure/operational controls are intentionally demoted to the bottom.

import Link from "next/link";
import {
  Activity, TrendingUp, Sparkles, AlertTriangle, BarChart3, Lightbulb,
  Gauge, MapPinned, Car, Building2, FileText, Globe, ShieldCheck,
  ExternalLink, ChevronRight, Search, Target, Database,
  ArrowUpRight, ArrowDownRight, Minus,
  type LucideIcon,
} from "lucide-react";
import AmipsSyncControls from "@/components/admin/amips/AmipsSyncControls";
import AmipsExportMenu from "@/components/admin/amips/AmipsExportMenu";
import ExecutiveSummaryCard from "@/components/admin/amips/ExecutiveSummaryCard";
import type {
  ExecutiveIntelligence, MarketHealthIndex, Insight, InsightCategory,
  OpportunityMarket, VehicleSegment, ContentPerformance, RiskItem,
  OperationsSnapshot, TrendInfo,
} from "@/lib/amips/intelligence/executive-intelligence";
import type { IndexationDecision } from "@/lib/amips/indexation-gate";
import type { StalenessRunway, RunwaySeverity } from "@/lib/amips/staleness-runway";

const metroHref = (metro: string) => `/admin/amips/metro/${encodeURIComponent(metro)}`;
const vehicleHref = (make: string, model: string) =>
  `/admin/amips/vehicle/${encodeURIComponent(make)}/${encodeURIComponent(model)}`;

function TrendBadge({ trend }: { trend?: TrendInfo }) {
  if (!trend) return null;
  const Icon = trend.dir === "up" ? ArrowUpRight : trend.dir === "down" ? ArrowDownRight : Minus;
  const color =
    trend.dir === "up" ? "text-[#059669]" : trend.dir === "down" ? "text-[#DC2626]" : "text-[#94A3B8]";
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold ${color}`}>
      <Icon size={11} />
      {trend.label}
    </span>
  );
}

function fmtUsd(cents: number): string {
  const d = cents / 100;
  if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(1)}M`;
  if (d >= 1_000) return `$${(d / 1_000).toFixed(1)}K`;
  return `$${d.toFixed(0)}`;
}
const fmtNum = (n: number) => n.toLocaleString("en-US");

// --- Shared visual tokens ---------------------------------------------------

const HEALTH_TONE: Record<MarketHealthIndex["tone"], { ring: string; text: string; chip: string }> = {
  strong: { ring: "#059669", text: "text-[#059669]", chip: "bg-[#ECFDF5] text-[#059669] border-[#A7F3D0]" },
  healthy: { ring: "#0B5FD1", text: "text-al-primary", chip: "bg-al-primary-subtle text-al-primary border-[#BFDBFE]" },
  developing: { ring: "#4F46E5", text: "text-[#4F46E5]", chip: "bg-[#EEF2FF] text-[#4F46E5] border-[#C7D2FE]" },
  early: { ring: "#D97706", text: "text-[#D97706]", chip: "bg-[#FFFBEB] text-[#D97706] border-[#FDE68A]" },
  initializing: { ring: "#94A3B8", text: "text-[#64748B]", chip: "bg-[#F1F5F9] text-[#64748B] border-[#E2E8F0]" },
};

const CATEGORY: Record<InsightCategory, { icon: LucideIcon; bg: string; color: string; ring: string; label: string }> = {
  opportunity: { icon: Target, bg: "bg-[#ECFDF5]", color: "text-[#059669]", ring: "border-[#A7F3D0]", label: "Opportunity" },
  risk: { icon: AlertTriangle, bg: "bg-[#FFFBEB]", color: "text-[#D97706]", ring: "border-[#FDE68A]", label: "Risk" },
  performance: { icon: BarChart3, bg: "bg-al-primary-subtle", color: "text-al-primary", ring: "border-[#BFDBFE]", label: "Performance" },
  recommendation: { icon: Lightbulb, bg: "bg-[#EEF2FF]", color: "text-[#4F46E5]", ring: "border-[#C7D2FE]", label: "Recommendation" },
};

const SEVERITY: Record<RiskItem["severity"], { dot: string; chip: string; label: string }> = {
  high: { dot: "bg-[#DC2626]", chip: "bg-[#FEF2F2] text-[#DC2626] border-[#FECACA]", label: "High" },
  medium: { dot: "bg-[#D97706]", chip: "bg-[#FFFBEB] text-[#D97706] border-[#FDE68A]", label: "Medium" },
  low: { dot: "bg-[#64748B]", chip: "bg-[#F1F5F9] text-[#64748B] border-[#E2E8F0]", label: "Low" },
};

function SectionLabel({ icon: Icon, children, right }: { icon: LucideIcon; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <Icon size={13} className="text-al-primary" />
        <p className="text-[10px] font-bold text-[#94A3B8] uppercase tracking-[0.15em]">{children}</p>
      </div>
      {right}
    </div>
  );
}

// --- National Market Health Index ------------------------------------------

function HealthRing({ score, tone }: { score: number; tone: MarketHealthIndex["tone"] }) {
  const r = 52;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.max(0, Math.min(100, score)) / 100);
  const color = HEALTH_TONE[tone].ring;
  return (
    <div className="relative w-[132px] h-[132px] shrink-0">
      <svg width="132" height="132" viewBox="0 0 132 132" className="-rotate-90">
        <circle cx="66" cy="66" r={r} fill="none" stroke="#EEF2F7" strokeWidth="11" />
        <circle
          cx="66" cy="66" r={r} fill="none" stroke={color} strokeWidth="11"
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold font-mono text-[#0F172A] leading-none">{score}</span>
        <span className="text-[10px] text-[#94A3B8] font-medium mt-1">/ 100</span>
      </div>
    </div>
  );
}

function MarketHealthCard({ health, trend }: { health: MarketHealthIndex; trend?: TrendInfo }) {
  const tone = HEALTH_TONE[health.tone];
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-2xl p-6 shadow-sm">
      <SectionLabel icon={Gauge}>National Market Health Index</SectionLabel>
      <div className="flex flex-col sm:flex-row items-center gap-6">
        <HealthRing score={health.score} tone={health.tone} />
        <div className="flex-1 min-w-0 w-full">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${tone.chip}`}>
              {health.grade}
            </span>
            <TrendBadge trend={trend} />
          </div>
          <p className="text-xs text-[#94A3B8] mt-2 leading-snug">
            Weighted composite of buyer leverage, coverage, market depth, indexation,
            freshness, and publishing velocity — every input traces to live data.
          </p>
          <div className="mt-4 space-y-2.5">
            {health.components.map((c) => (
              <div key={c.key}>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-[#475569] font-medium">{c.label}</span>
                  <span className="font-mono text-[#0F172A] font-semibold">{c.value}</span>
                </div>
                <div className="mt-1 h-1.5 w-full rounded-full bg-[#F1F5F9] overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${c.value}%`, backgroundColor: tone.ring }} />
                </div>
                <p className="text-[10px] text-[#94A3B8] mt-0.5">{c.caption}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Insight feed -----------------------------------------------------------

function InsightCard({ insight }: { insight: Insight }) {
  const c = CATEGORY[insight.category];
  const inner = (
    <>
      <div className="flex items-center justify-between mb-2">
        <span className={`inline-flex items-center gap-1.5 rounded-lg ${c.bg} px-2 py-1 text-[10px] font-bold ${c.color}`}>
          <c.icon size={11} />
          {c.label}
        </span>
        {insight.metric && (
          <span className="font-mono text-sm font-bold text-[#0F172A]">{insight.metric}</span>
        )}
      </div>
      <p className="text-sm font-bold text-[#0F172A] leading-snug">{insight.title}</p>
      <p className="text-xs text-[#64748B] mt-1.5 leading-relaxed flex-1">{insight.detail}</p>
      <p className={`mt-3 inline-flex items-center gap-1 text-[11px] font-semibold ${c.color}`}>
        {insight.action}
        <ChevronRight size={12} className="group-hover/insight:translate-x-0.5 transition-transform" />
      </p>
    </>
  );

  if (!insight.href) {
    return <div className={`bg-white border ${c.ring} rounded-2xl p-4 shadow-sm flex flex-col`}>{inner}</div>;
  }
  return (
    <Link
      href={insight.href}
      className={`group/insight bg-white border ${c.ring} rounded-2xl p-4 shadow-sm flex flex-col hover:shadow-md hover:shadow-al-primary/5 hover:-translate-y-0.5 transition-all`}
    >
      {inner}
    </Link>
  );
}

// --- Opportunity markets ----------------------------------------------------

function OpportunityTable({ rows }: { rows: OpportunityMarket[] }) {
  const top = rows.slice(0, 8);
  return (
    <div className="overflow-hidden rounded-2xl border border-[#E2E8F0] bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-left text-[10px] uppercase tracking-[0.12em] text-[#94A3B8]">
              <th className="px-4 py-3 font-bold">#</th>
              <th className="px-4 py-3 font-bold">Metro</th>
              <th className="px-4 py-3 font-bold">Opportunity</th>
              <th className="px-4 py-3 font-bold">Lead Driver</th>
              <th className="px-4 py-3 font-bold text-right">Demand</th>
              <th className="px-4 py-3 font-bold text-right">Leverage</th>
              <th className="px-4 py-3 font-bold text-right">Dealers</th>
              <th className="px-4 py-3 font-bold text-right">Pages</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F1F5F9]">
            {top.map((m, i) => (
              <tr key={`${m.metro}-${m.state}`} className="hover:bg-[#F8FAFF] transition-colors">
                <td className="px-4 py-3 font-mono text-xs text-[#94A3B8]">{i + 1}</td>
                <td className="px-4 py-3">
                  <Link href={metroHref(m.metro)} className="group/link">
                    <p className="font-semibold text-[#0F172A] leading-tight group-hover/link:text-al-primary transition-colors">{m.metro}</p>
                    <p className="text-[10px] text-[#94A3B8]">{m.state}</p>
                  </Link>
                </td>
                <td className="px-4 py-3 w-40">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 rounded-full bg-[#F1F5F9] overflow-hidden min-w-[48px]">
                      <div className="h-full rounded-full bg-al-primary" style={{ width: `${m.opportunityScore}%` }} />
                    </div>
                    <span className="font-mono text-xs font-semibold text-[#0F172A] w-7 text-right">{m.opportunityScore}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex rounded-full bg-[#F1F5F9] px-2 py-0.5 text-[10px] font-semibold text-[#475569]">
                    {m.driver}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-mono text-[#374151]">{m.demandScore?.toFixed(1) ?? "—"}</td>
                <td className="px-4 py-3 text-right font-mono text-[#374151]">{m.buyerLeverage?.toFixed(1) ?? "—"}</td>
                <td className="px-4 py-3 text-right font-mono text-[#374151]">{m.dealers}</td>
                <td className="px-4 py-3 text-right font-mono text-[#374151]">{m.pages}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Risk monitor -----------------------------------------------------------

function RiskMonitor({ risks }: { risks: RiskItem[] }) {
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-[#F1F5F9] bg-[#F8FAFC] flex items-center gap-2">
        <ShieldCheck size={13} className="text-al-primary" />
        <p className="text-[10px] font-bold text-[#94A3B8] uppercase tracking-[0.15em]">Risk Monitoring</p>
      </div>
      {risks.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <div className="w-9 h-9 rounded-xl bg-[#ECFDF5] flex items-center justify-center mx-auto mb-2">
            <ShieldCheck size={16} className="text-[#059669]" />
          </div>
          <p className="text-sm font-semibold text-[#0F172A]">All clear</p>
          <p className="text-xs text-[#94A3B8] mt-0.5">No active risks detected across the pipeline.</p>
        </div>
      ) : (
        <div className="divide-y divide-[#F1F5F9]">
          {risks.map((r) => {
            const s = SEVERITY[r.severity];
            return (
              <div key={r.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-1.5 h-1.5 rounded-full ${s.dot} shrink-0`} />
                    <p className="text-sm font-semibold text-[#0F172A] truncate">{r.title}</p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${s.chip}`}>{s.label}</span>
                </div>
                <p className="text-xs text-[#64748B] mt-1 leading-snug">{r.detail}</p>
                <p className="text-[11px] font-semibold text-al-primary mt-1.5">{r.action} →</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Vehicle segments -------------------------------------------------------

function VehicleSegments({ segments }: { segments: VehicleSegment[] }) {
  if (segments.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[#CBD5E1] bg-white p-8 text-center">
        <Car size={18} className="text-[#94A3B8] mx-auto mb-2" />
        <p className="text-sm font-semibold text-[#0F172A]">No vehicle scores yet</p>
        <p className="text-xs text-[#94A3B8] mt-0.5">Compute market scores to rank vehicle buyer advantage by make and model.</p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
      {segments.map((s) => {
        const strong = s.avgBuyerAdvantage >= 6;
        return (
          <Link
            key={`${s.make}-${s.model}`}
            href={vehicleHref(s.make, s.model)}
            className="bg-white border border-[#E2E8F0] rounded-2xl p-4 shadow-sm hover:border-[#BFDBFE] hover:shadow-md hover:shadow-al-primary/5 transition-all group"
          >
            <div className="flex items-start justify-between">
              <div className="min-w-0">
                <p className="text-[10px] text-[#94A3B8] font-medium uppercase tracking-wide">{s.make}</p>
                <p className="text-sm font-bold text-[#0F172A] truncate group-hover:text-al-primary transition-colors">{s.model}</p>
              </div>
              <span className={`shrink-0 text-lg font-bold font-mono ${strong ? "text-[#059669]" : "text-[#0F172A]"}`}>
                {s.avgBuyerAdvantage.toFixed(1)}
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full rounded-full bg-[#F1F5F9] overflow-hidden">
              <div className={`h-full rounded-full ${strong ? "bg-[#059669]" : "bg-al-primary"}`} style={{ width: `${(s.avgBuyerAdvantage / 10) * 100}%` }} />
            </div>
            <p className="text-[11px] font-medium text-[#475569] mt-2">{s.outlook}</p>
            <p className="text-[10px] text-[#94A3B8] mt-0.5">{s.metros} metro{s.metros === 1 ? "" : "s"} · {fmtNum(s.dealers)} dealers</p>
          </Link>
        );
      })}
    </div>
  );
}

// --- Content performance ----------------------------------------------------

const DECISION_CHIP: Record<IndexationDecision, string> = {
  scale: "bg-[#ECFDF5] text-[#059669] border-[#A7F3D0]",
  hold: "bg-[#FFFBEB] text-[#D97706] border-[#FDE68A]",
  pause: "bg-[#FEF2F2] text-[#DC2626] border-[#FECACA]",
};

// Same chip vocabulary as the indexation decision above, so runway severity
// reads on a scale the operator already knows.
const RUNWAY_CHIP: Record<RunwaySeverity, string> = {
  OK: "bg-[#ECFDF5] text-[#059669] border-[#A7F3D0]",
  NOTICE: "bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]",
  WARN: "bg-[#FFFBEB] text-[#D97706] border-[#FDE68A]",
  CRITICAL: "bg-[#FEF2F2] text-[#DC2626] border-[#FECACA]",
};

function StalenessRunwayRow({ runway }: { runway: StalenessRunway }) {
  const days = runway.minDaysToWithhold;
  // Nothing dated cannot withhold. Said explicitly, because a reassuring green
  // figure that actually means "not measured" is the failure mode this whole
  // audit has been correcting.
  if (days === null) {
    return (
      <div className="border-t border-[#F1F5F9] px-5 py-3" data-testid="amips-staleness-runway">
        <p className="text-[10px] font-bold text-[#94A3B8] uppercase tracking-[0.12em] mb-1">Staleness Runway</p>
        <p className="text-xs text-[#94A3B8]">No dated pages — nothing is scheduled to withhold.</p>
      </div>
    );
  }
  const dark = days <= 0;
  return (
    <div className="border-t border-[#F1F5F9] px-5 py-3" data-testid="amips-staleness-runway">
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-[10px] font-bold text-[#94A3B8] uppercase tracking-[0.12em]">Staleness Runway</p>
        <span
          className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${RUNWAY_CHIP[runway.severity]}`}
          data-testid="amips-runway-severity"
        >
          {runway.severity}
        </span>
      </div>
      <p className="text-xs text-[#475569]">
        {dark ? (
          <>
            <span className="font-mono font-semibold text-[#DC2626]">{fmtNum(runway.alreadyWithheld)}</span>
            {" page(s) are past the staleness bound and returning 404 now."}
          </>
        ) : (
          <>
            <span className="font-mono font-semibold text-[#0F172A]">{fmtNum(days)}</span>
            {" day(s) until the first page stops serving"}
            {runway.firstWithholdDate ? (
              <>
                {" — "}
                <time dateTime={runway.firstWithholdDate}>{runway.firstWithholdDate}</time>
              </>
            ) : null}
            .
          </>
        )}
      </p>
      <p className="text-[10px] text-[#94A3B8] mt-1 leading-snug">
        {runway.isSingleDayCliff
          ? `All ${fmtNum(runway.servablePages)} servable pages share this date — the corpus goes dark in one day, not gradually.`
          : `${fmtNum(runway.within30)} within 30d · ${fmtNum(runway.within60)} within 60d · ${fmtNum(runway.within90)} within 90d`}
      </p>
      <p className="text-[10px] text-[#94A3B8] mt-1 leading-snug">
        Refresh is manual: run the vehicle-intelligence seed, or sync market intelligence.
        Regenerating pages does not clear it.
      </p>
    </div>
  );
}

function ContentPerformancePanel({
  content,
  runway,
}: {
  content: ContentPerformance;
  runway: StalenessRunway;
}) {
  const stats: Array<{ label: string; value: string; caption: string }> = [
    { label: "Active Pages", value: fmtNum(content.activePages), caption: `${content.published30d} published / 30d` },
    { label: "Impressions", value: fmtNum(content.impressions), caption: `${fmtNum(content.clicks)} clicks` },
    { label: "Avg CTR", value: content.ctr != null ? `${(content.ctr * 100).toFixed(1)}%` : "—", caption: content.avgPosition != null ? `Avg pos ${content.avgPosition.toFixed(1)}` : "No position data" },
    { label: "Leads", value: fmtNum(content.leads), caption: content.revenueAttributionCents > 0 ? `${fmtUsd(content.revenueAttributionCents)} attributed` : "Awaiting attribution" },
    { label: "Revenue Run-Rate", value: content.revenueRunRateCents > 0 ? fmtUsd(content.revenueRunRateCents) : "—", caption: "Annualised, trailing 4 wks" },
    { label: "Projected Output", value: `${fmtNum(content.projectedNext30d)}`, caption: "Pages next 30d (trend)" },
  ];
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-[#F1F5F9] bg-[#F8FAFC] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText size={13} className="text-al-primary" />
          <p className="text-[10px] font-bold text-[#94A3B8] uppercase tracking-[0.15em]">Content Performance Intelligence</p>
        </div>
        <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${DECISION_CHIP[content.indexationDecision]}`}>
          {content.indexationDecision} · {Math.round(content.indexationRate * 100)}% indexed
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-x divide-y divide-[#F1F5F9] sm:divide-y-0">
        {stats.map((s) => (
          <div key={s.label} className="p-4">
            <p className="text-[10px] text-[#94A3B8] font-medium">{s.label}</p>
            <p className="text-lg font-bold font-mono text-[#0F172A] mt-1 leading-none">{s.value}</p>
            <p className="text-[10px] text-[#94A3B8] mt-1 leading-snug">{s.caption}</p>
          </div>
        ))}
      </div>
      <StalenessRunwayRow runway={runway} />
      {content.topPages.length > 0 && (
        <div className="border-t border-[#F1F5F9] px-5 py-3">
          <p className="text-[10px] font-bold text-[#94A3B8] uppercase tracking-[0.12em] mb-2">Top Pages by Leads</p>
          <div className="space-y-1.5">
            {content.topPages.map((p) => (
              <div key={p.url} className="flex items-center justify-between gap-3 text-xs">
                <span className="text-[#475569] truncate font-mono">{p.url.replace(/^https?:\/\/[^/]+/, "")}</span>
                <span className="shrink-0 text-[#94A3B8]">
                  <span className="font-mono text-[#0F172A] font-semibold">{p.leads}</span> leads · {fmtNum(p.clicks)} clicks
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Operations (demoted) ---------------------------------------------------

function indexationBar(d: IndexationDecision): string {
  return d === "scale" ? "bg-[#059669]" : d === "hold" ? "bg-[#D97706]" : "bg-[#DC2626]";
}

function OperationsPanel({ ops }: { ops: OperationsSnapshot }) {
  const infra: Array<{ label: string; value: string; icon: LucideIcon }> = [
    { label: "Vehicle Records", value: fmtNum(ops.vehicleRecords), icon: Car },
    { label: "Dealer Records", value: fmtNum(ops.dealerRecords), icon: Building2 },
    { label: "Markets Scored", value: fmtNum(ops.marketsScored), icon: MapPinned },
    { label: "Cached Scores", value: fmtNum(ops.cachedScores), icon: Gauge },
    { label: "Data Freshness", value: `${Math.round(ops.freshnessPct * 100)}%`, icon: Activity },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {infra.map((m) => (
          <div key={m.label} className="bg-white border border-[#E2E8F0] rounded-xl p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <m.icon size={13} className="text-[#94A3B8]" />
              <p className="text-[10px] text-[#94A3B8] font-medium">{m.label}</p>
            </div>
            <p className="text-xl font-bold font-mono text-[#0F172A]">{m.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 shadow-sm">
        <p className="text-[10px] font-bold text-[#94A3B8] uppercase tracking-[0.12em] mb-3">Generation Queue</p>
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Pending", value: ops.queue.pending, color: "text-al-primary" },
            { label: "In Progress", value: ops.queue.inProgress, color: "text-[#D97706]" },
            { label: "Complete", value: ops.queue.complete, color: "text-[#059669]" },
            { label: "Failed", value: ops.queue.failed, color: ops.queue.failed > 0 ? "text-[#DC2626]" : "text-[#94A3B8]" },
          ].map((q) => (
            <div key={q.label}>
              <p className={`text-xl font-bold font-mono ${q.color}`}>{fmtNum(q.value)}</p>
              <p className="text-[10px] text-[#94A3B8] mt-0.5">{q.label}</p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="text-[10px] font-bold text-[#94A3B8] uppercase tracking-[0.12em] mb-2">Manual Sync Orchestration</p>
        <AmipsSyncControls />
      </div>

      <div className="rounded-2xl border border-[#E2E8F0] bg-white shadow-sm overflow-hidden">
        <p className="px-5 py-3 text-[10px] font-bold text-[#94A3B8] uppercase tracking-[0.12em] border-b border-[#F1F5F9] bg-[#F8FAFC]">
          Indexation Gate · Publish-Week Cohorts
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E2E8F0] text-left text-[10px] uppercase tracking-[0.12em] text-[#94A3B8]">
                <th className="px-5 py-2.5 font-bold">Cohort Week</th>
                <th className="px-5 py-2.5 font-bold text-right">Submitted</th>
                <th className="px-5 py-2.5 font-bold text-right">Indexed</th>
                <th className="px-5 py-2.5 font-bold">Rate</th>
                <th className="px-5 py-2.5 font-bold">Decision</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {ops.indexationGates.length === 0 ? (
                <tr><td className="px-5 py-6 text-center text-[#94A3B8]" colSpan={5}>No published cohorts yet.</td></tr>
              ) : (
                ops.indexationGates.map((g) => (
                  <tr key={g.cohortWeek} className="hover:bg-[#F8FAFF] transition-colors">
                    <td className="px-5 py-2.5 font-semibold text-[#0F172A]">{g.cohortWeek}</td>
                    <td className="px-5 py-2.5 text-right font-mono text-[#374151]">{g.submitted}</td>
                    <td className="px-5 py-2.5 text-right font-mono text-[#374151]">{g.indexed}</td>
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 rounded-full bg-[#F1F5F9] overflow-hidden">
                          <div className={`h-full rounded-full ${indexationBar(g.decision)}`} style={{ width: `${Math.min(g.indexationRate * 100, 100)}%` }} />
                        </div>
                        <span className="font-mono text-xs text-[#374151]">{(g.indexationRate * 100).toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="px-5 py-2.5">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${DECISION_CHIP[g.decision]}`}>{g.decision}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// --- Page composition -------------------------------------------------------

export default function ExecutiveIntelligenceDashboard({ data }: { data: ExecutiveIntelligence }) {
  const generated = new Date(data.generatedAt).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });

  return (
    <div className="min-h-screen bg-[#F4F6FA] p-6 md:p-8 max-w-[1400px] mx-auto" data-testid="admin-amips-page">
      {/* Header */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-7">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <div className="w-2 h-2 rounded-full bg-[#059669] animate-pulse" />
            <p className="text-[10px] text-[#94A3B8] font-semibold uppercase tracking-widest">
              Automotive Market Intelligence Platform
            </p>
          </div>
          <h1 className="text-2xl font-bold text-[#0F172A] tracking-tight">Market Intelligence Center</h1>
          <p className="text-sm text-[#94A3B8] mt-0.5">
            Real-time market health, opportunity, and content intelligence across {data.coverage.universe} metros.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          <span className="hidden lg:inline-flex items-center gap-1.5 px-2 py-2 text-[11px] text-[#94A3B8] font-medium">
            <Activity size={11} /> As of {generated}
          </span>
          <AmipsExportMenu />
          <Link href="/intelligence"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-white border border-[#E2E8F0] rounded-xl text-xs font-semibold text-[#475569] hover:border-[#BFDBFE] hover:text-al-primary transition-all shadow-sm">
            <ExternalLink size={12} /> Public
          </Link>
        </div>
      </header>

      {/* National Market Overview */}
      <section id="market-health" className="scroll-mt-6 grid grid-cols-1 lg:grid-cols-3 gap-5 mb-6">
        <div className="lg:col-span-1"><MarketHealthCard health={data.health} trend={data.healthTrend} /></div>
        <div className="lg:col-span-2 grid grid-cols-2 gap-4 content-start">
          {data.headline.length > 0 ? data.headline.map((m) => (
            <div key={m.key} className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-sm">
              <p className="text-[10px] text-[#94A3B8] font-medium uppercase tracking-wide">{m.label}</p>
              <p className="text-3xl font-bold font-mono text-[#0F172A] tracking-tight mt-2 leading-none">{m.value}</p>
              <div className="flex items-center justify-between mt-2 gap-2">
                <p className="text-[11px] text-[#94A3B8]">{m.caption}</p>
                <TrendBadge trend={m.trend} />
              </div>
            </div>
          )) : (
            <div className="col-span-2 flex items-center justify-center rounded-2xl border border-dashed border-[#CBD5E1] bg-white p-8 text-center">
              <div>
                <Database size={18} className="text-[#94A3B8] mx-auto mb-2" />
                <p className="text-sm font-semibold text-[#0F172A]">Intelligence is initializing</p>
                <p className="text-xs text-[#94A3B8] mt-0.5">Run the data syncs below to populate market intelligence.</p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* AI Executive Briefing (on-demand LLM narrative) */}
      <section className="mb-7">
        <ExecutiveSummaryCard />
      </section>

      {/* AI Insights Feed */}
      <section className="mb-7">
        <SectionLabel icon={Sparkles} right={
          <span className="text-[10px] text-[#94A3B8] font-medium">Auto-generated from live signals</span>
        }>
          AI Insights & Opportunity Alerts
        </SectionLabel>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {data.insights.map((i) => <InsightCard key={i.id} insight={i} />)}
        </div>
      </section>

      {/* Opportunity + Risk */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-7">
        <div className="lg:col-span-2">
          <SectionLabel icon={TrendingUp} right={
            <span className="text-[10px] text-[#94A3B8] font-medium">Demand × under-coverage</span>
          }>
            Top Market Opportunities
          </SectionLabel>
          <OpportunityTable rows={data.opportunities} />
        </div>
        <div className="lg:col-span-1">
          <div className="h-[26px]" />
          <RiskMonitor risks={data.risks} />
        </div>
      </section>

      {/* Vehicle Segment Intelligence */}
      <section className="mb-7">
        <SectionLabel icon={Car} right={
          <span className="text-[10px] text-[#94A3B8] font-medium">Avg buyer advantage by model</span>
        }>
          Vehicle Segment Intelligence
        </SectionLabel>
        <VehicleSegments segments={data.segments} />
      </section>

      {/* Content Performance */}
      <section id="content" className="scroll-mt-6 mb-7">
        <ContentPerformancePanel content={data.content} runway={data.stalenessRunway} />
      </section>

      {/* Operations (demoted) */}
      <section id="operations" className="scroll-mt-6">
        <SectionLabel icon={Globe} right={
          <span className="inline-flex items-center gap-1 text-[10px] text-[#94A3B8] font-medium">
            <Search size={10} /> Pipeline & data operations
          </span>
        }>
          Operations & Data Pipeline
        </SectionLabel>
        <OperationsPanel ops={data.operations} />
      </section>
    </div>
  );
}
