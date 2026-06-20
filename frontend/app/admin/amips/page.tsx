import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { haversineMiles } from "@/lib/utils/zip-coords";
import { getMetroDefs, METRO_MEMBERSHIP_RADIUS_MILES } from "@/lib/amips/metros";
import AmipsSyncControls from "@/components/admin/amips/AmipsSyncControls";
import {
  computeIndexationGates,
  type IndexationDecision,
} from "@/lib/amips/indexation-gate";
import {
  Car, Building2, MapPinned, Gauge, ListChecks, FileText,
  Globe, ShieldCheck, Lock, Activity, Sparkles, Search, Layers,
  TrendingUp, ChevronRight, ExternalLink, CircleDot, ArrowUpRight,
} from "lucide-react";

export const dynamic = "force-dynamic";

// Indexation-gate decision → badge styling.
function indexationCls(decision: IndexationDecision): string {
  switch (decision) {
    case "scale":
      return "bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0]";
    case "hold":
      return "bg-[#FFFBEB] text-[#D97706] border border-[#FDE68A]";
    case "pause":
      return "bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA]";
  }
}

function indexationBar(decision: IndexationDecision): string {
  switch (decision) {
    case "scale":
      return "bg-[#059669]";
    case "hold":
      return "bg-[#D97706]";
    case "pause":
      return "bg-[#DC2626]";
  }
}

function fmtDate(d: Date | null | undefined): string {
  return d ? new Date(d).toISOString().slice(0, 10) : "—";
}

// Readiness: ready (green) needs a scored market + 3+ dealers; partial (amber)
// has a market record or any dealer; red is insufficient data.
function readiness(
  dealers: number,
  leverage: number | null | undefined,
): { label: string; cls: string; dot: string } {
  if (dealers >= 3 && (leverage ?? 0) > 0) {
    return {
      label: "Ready",
      cls: "bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0]",
      dot: "bg-[#059669]",
    };
  }
  if (dealers > 0 || (leverage ?? 0) > 0) {
    return {
      label: "Partial",
      cls: "bg-[#FFFBEB] text-[#D97706] border border-[#FDE68A]",
      dot: "bg-[#D97706]",
    };
  }
  return {
    label: "Insufficient",
    cls: "bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA]",
    dot: "bg-[#DC2626]",
  };
}

export default async function AdminAmipsPage() {
  await requireAdmin();

  const metroDefs = getMetroDefs();

  const [
    vehicleCount,
    vehicleLast,
    dealerCount,
    dealerRows,
    markets,
    queueByStatus,
    pagesByLifecycle,
    queueByMetro,
    marketScoreCount,
    indexationGates,
  ] = await Promise.all([
    prisma.vehicleIntelligence.count(),
    prisma.vehicleIntelligence.findFirst({
      orderBy: { lastUpdated: "desc" },
      select: { lastUpdated: true },
    }),
    prisma.dealerIntelligence.count(),
    prisma.dealerIntelligence.findMany({
      where: { latitude: { not: null }, longitude: { not: null } },
      select: { latitude: true, longitude: true },
    }),
    prisma.marketIntelligence.findMany({
      select: { metroName: true, buyerLeverageScore: true, lastUpdated: true },
    }),
    prisma.contentQueue.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.amipsPage.groupBy({ by: ["lifecycleStatus"], _count: { _all: true } }),
    prisma.contentQueue.groupBy({
      by: ["metro"],
      _count: { _all: true },
      where: { metro: { not: null } },
    }),
    prisma.amipsMarketScore.count(),
    computeIndexationGates(),
  ]);

  const dealerCoords = dealerRows.map((d) => ({
    lat: d.latitude as number,
    lng: d.longitude as number,
  }));

  // Per-metro dealer counts (membership radius from each metro center).
  const dealersInMetro = new Map<string, number>();
  for (const def of metroDefs) {
    let n = 0;
    for (const c of dealerCoords) {
      if (haversineMiles(def.center, c) <= METRO_MEMBERSHIP_RADIUS_MILES) n++;
    }
    dealersInMetro.set(def.metro, n);
  }
  const metrosCovered = [...dealersInMetro.values()].filter((n) => n > 0).length;

  const marketByMetro = new Map(markets.map((m) => [m.metroName, m]));
  const marketLast = markets.reduce<Date | null>(
    (acc, m) => (!acc || m.lastUpdated > acc ? m.lastUpdated : acc),
    null,
  );
  const queueByMetroMap = new Map(
    queueByMetro.map((q) => [q.metro as string, q._count._all]),
  );
  const statusCount = (s: string) =>
    queueByStatus.find((q) => q.status === s)?._count._all ?? 0;
  const lifecycleCount = (s: string) =>
    pagesByLifecycle.find((p) => p.lifecycleStatus === s)?._count._all ?? 0;

  // Pre-build metro rows so we can both render and summarize readiness.
  const metroRows = metroDefs.map((def) => {
    const dealers = dealersInMetro.get(def.metro) ?? 0;
    const leverage = marketByMetro.get(def.metro)?.buyerLeverageScore ?? null;
    const queue = queueByMetroMap.get(def.metro) ?? 0;
    return { def, dealers, leverage, queue, r: readiness(dealers, leverage) };
  });
  const readyMetros = metroRows.filter((m) => m.r.label === "Ready").length;

  // Derived headline metrics (no extra queries — communicate platform health).
  const coveragePct = Math.round((metrosCovered / 25) * 100);
  const scoredPct = Math.round((markets.length / 25) * 100);
  const queueTotal =
    statusCount("pending") + statusCount("in_progress") + statusCount("complete");
  const queueDonePct =
    queueTotal > 0 ? Math.round((statusCount("complete") / queueTotal) * 100) : 0;
  const totalPages =
    lifecycleCount("ACTIVE") + lifecycleCount("UNDER_REVIEW") + lifecycleCount("RETIRED");
  const indexedTotal = indexationGates.reduce((a, g) => a + g.indexed, 0);
  const submittedTotal = indexationGates.reduce((a, g) => a + g.submitted, 0);
  const indexationRate =
    submittedTotal > 0 ? Math.round((indexedTotal / submittedTotal) * 100) : 0;

  const health = [
    {
      label: "Vehicle Intelligence",
      value: vehicleCount.toLocaleString("en-US"),
      unit: "records",
      sub: `Updated ${fmtDate(vehicleLast?.lastUpdated)}`,
      icon: Car,
      iconBg: "bg-[#EFF6FF]",
      iconColor: "text-[#0B5FD1]",
    },
    {
      label: "Dealer Intelligence",
      value: dealerCount.toLocaleString("en-US"),
      unit: "records",
      sub: `${metrosCovered}/25 metros covered`,
      icon: Building2,
      iconBg: "bg-[#ECFDF5]",
      iconColor: "text-[#059669]",
    },
    {
      label: "Market Intelligence",
      value: markets.length.toLocaleString("en-US"),
      unit: "metros scored",
      sub: `Updated ${fmtDate(marketLast)}`,
      icon: MapPinned,
      iconBg: "bg-[#EEF2FF]",
      iconColor: "text-[#4F46E5]",
    },
    {
      label: "Market Scores",
      value: marketScoreCount.toLocaleString("en-US"),
      unit: "cached",
      sub: "make/model × metro",
      icon: Gauge,
      iconBg: "bg-[#FFFBEB]",
      iconColor: "text-[#D97706]",
    },
    {
      label: "Content Queue",
      value: statusCount("pending").toLocaleString("en-US"),
      unit: "pending",
      sub: `${statusCount("in_progress")} in progress · ${statusCount("complete")} complete`,
      icon: ListChecks,
      iconBg: "bg-[#F0F9FF]",
      iconColor: "text-[#0891B2]",
    },
    {
      label: "AMIPS Pages",
      value: lifecycleCount("ACTIVE").toLocaleString("en-US"),
      unit: "active",
      sub: `${lifecycleCount("UNDER_REVIEW")} review · ${lifecycleCount("RETIRED")} retired`,
      icon: FileText,
      iconBg: "bg-[#FDF4FF]",
      iconColor: "text-[#A21CAF]",
    },
  ];

  // Five-stage intelligence pipeline — the innovation/sophistication story.
  const pipeline = [
    { label: "Discover", icon: Search, detail: `${dealerCount.toLocaleString("en-US")} dealers` },
    { label: "Enrich", icon: Layers, detail: `${vehicleCount.toLocaleString("en-US")} vehicles` },
    { label: "Score", icon: Gauge, detail: `${marketScoreCount.toLocaleString("en-US")} scores` },
    { label: "Generate", icon: Sparkles, detail: `${queueTotal.toLocaleString("en-US")} queued` },
    { label: "Index", icon: Globe, detail: `${indexationRate}% indexed` },
  ];

  // Trust / governance signals — credibility & security.
  const trust = [
    { icon: ShieldCheck, label: "Computed, never estimated", sub: "Scores derived from live market data" },
    { icon: Lock, label: "MFA-gated access", sub: "Admin JWT + verified authenticator" },
    { icon: Globe, label: "25-metro coverage model", sub: "Geo-anchored dealer membership" },
    { icon: Activity, label: "Self-governing indexation", sub: "Cohort gate scales or pauses output" },
  ];

  return (
    <div
      className="min-h-screen bg-[#F4F6FA] p-6 md:p-8 max-w-[1400px] mx-auto"
      data-testid="admin-amips-page"
    >
      {/* Header */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <div className="w-2 h-2 rounded-full bg-[#059669] animate-pulse" />
            <p className="text-[10px] text-[#94A3B8] font-semibold uppercase tracking-widest">
              Automotive Market Intelligence Publishing System
            </p>
          </div>
          <h1 className="text-2xl font-bold text-[#0F172A] tracking-tight">
            AMIPS Intelligence
          </h1>
          <p className="text-sm text-[#94A3B8] mt-0.5">
            Database health, sync orchestration, and metro readiness for Tier C/D
            content generation.
          </p>
        </div>
        <Link
          href="/intelligence"
          className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 bg-white border border-[#E2E8F0] rounded-xl text-xs font-semibold text-[#475569] hover:border-[#BFDBFE] hover:text-[#0B5FD1] transition-all shadow-sm"
        >
          <ExternalLink size={12} />
          View Public Intelligence
        </Link>
      </header>

      {/* KPI band */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        {health.map((h) => (
          <div
            key={h.label}
            className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-sm"
          >
            <div className={`w-9 h-9 rounded-xl ${h.iconBg} flex items-center justify-center mb-4`}>
              <h.icon size={15} className={h.iconColor} />
            </div>
            <p className="text-2xl font-bold text-[#0F172A] font-mono tracking-tight leading-none">
              {h.value}
            </p>
            <p className="text-[10px] text-[#94A3B8] font-medium mt-1">{h.unit}</p>
            <p className="text-xs font-semibold text-[#0F172A] mt-3">{h.label}</p>
            <p className="text-[10px] text-[#94A3B8] mt-0.5 leading-snug">{h.sub}</p>
          </div>
        ))}
      </div>

      {/* Coverage rollup */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Metro Coverage", pct: coveragePct, caption: `${metrosCovered} of 25 metros with dealers`, bar: "bg-[#0B5FD1]" },
          { label: "Markets Scored", pct: scoredPct, caption: `${markets.length} of 25 metros scored`, bar: "bg-[#4F46E5]" },
          { label: "Queue Throughput", pct: queueDonePct, caption: `${statusCount("complete")} of ${queueTotal} items complete`, bar: "bg-[#0891B2]" },
          { label: "Indexation Rate", pct: indexationRate, caption: `${indexedTotal} of ${submittedTotal} URLs indexed`, bar: "bg-[#059669]" },
        ].map((m) => (
          <div key={m.label} className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-sm">
            <div className="flex items-baseline justify-between">
              <p className="text-[10px] font-bold text-[#94A3B8] uppercase tracking-[0.15em]">
                {m.label}
              </p>
              <p className="text-lg font-bold font-mono text-[#0F172A]">{m.pct}%</p>
            </div>
            <div className="mt-3 h-1.5 w-full rounded-full bg-[#F1F5F9] overflow-hidden">
              <div className={`h-full rounded-full ${m.bar}`} style={{ width: `${Math.min(m.pct, 100)}%` }} />
            </div>
            <p className="text-[10px] text-[#94A3B8] mt-2">{m.caption}</p>
          </div>
        ))}
      </div>

      {/* Intelligence pipeline */}
      <section className="mb-6">
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={13} className="text-[#0B5FD1]" />
            <p className="text-[10px] font-bold text-[#94A3B8] uppercase tracking-[0.15em]">
              Intelligence Pipeline
            </p>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-stretch gap-3">
            {pipeline.map((stage, i) => (
              <div key={stage.label} className="flex items-center gap-3 flex-1">
                <div className="flex-1 flex items-center gap-3 rounded-xl border border-[#E2E8F0] bg-[#F8FAFF] px-4 py-3">
                  <div className="w-8 h-8 rounded-lg bg-white border border-[#E2E8F0] flex items-center justify-center shrink-0">
                    <stage.icon size={14} className="text-[#0B5FD1]" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-[#0F172A] leading-tight">{stage.label}</p>
                    <p className="text-[10px] text-[#94A3B8] font-mono truncate">{stage.detail}</p>
                  </div>
                </div>
                {i < pipeline.length - 1 && (
                  <ChevronRight size={14} className="text-[#CBD5E1] shrink-0 hidden sm:block" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Sync Controls */}
      <section className="mb-6">
        <p className="text-[10px] font-bold text-[#94A3B8] uppercase tracking-[0.15em] mb-3">
          Sync Orchestration
        </p>
        <AmipsSyncControls />
      </section>

      {/* Trust / governance strip */}
      <section className="mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {trust.map((t) => (
            <div
              key={t.label}
              className="flex items-start gap-3 bg-white border border-[#E2E8F0] rounded-2xl p-4 shadow-sm"
            >
              <div className="w-8 h-8 rounded-lg bg-[#EFF6FF] flex items-center justify-center shrink-0">
                <t.icon size={14} className="text-[#0B5FD1]" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-[#0F172A] leading-tight">{t.label}</p>
                <p className="text-[10px] text-[#94A3B8] mt-0.5 leading-snug">{t.sub}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Metro Readiness */}
      <section className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] font-bold text-[#94A3B8] uppercase tracking-[0.15em]">
            Top Metro Readiness
          </p>
          <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[#059669]">
            <CircleDot size={11} />
            {readyMetros} of {metroRows.length} metros ready
          </span>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-[#E2E8F0] bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E2E8F0] text-left text-[10px] uppercase tracking-[0.12em] text-[#94A3B8] bg-[#F8FAFC]">
                <th className="px-5 py-3 font-bold">Metro</th>
                <th className="px-5 py-3 font-bold">State</th>
                <th className="px-5 py-3 font-bold text-right">Dealers</th>
                <th className="px-5 py-3 font-bold text-right">Market Score</th>
                <th className="px-5 py-3 font-bold text-right">Queue Items</th>
                <th className="px-5 py-3 font-bold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {metroRows.map(({ def, dealers, leverage, queue, r }) => (
                <tr key={def.metro} className="hover:bg-[#F8FAFF] transition-colors">
                  <td className="px-5 py-3 font-semibold text-[#0F172A]">{def.metro}</td>
                  <td className="px-5 py-3 text-[#94A3B8]">{def.state}</td>
                  <td className="px-5 py-3 text-right font-mono text-[#374151]">{dealers}</td>
                  <td className="px-5 py-3 text-right font-mono text-[#374151]">
                    {leverage === null ? "—" : leverage.toFixed(1)}
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-[#374151]">{queue}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${r.cls}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${r.dot}`} />
                      {r.label}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Indexation Gate */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] font-bold text-[#94A3B8] uppercase tracking-[0.15em]">
            Indexation Gate
          </p>
          {submittedTotal > 0 && (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[#0B5FD1]">
              <ArrowUpRight size={11} />
              {indexationRate}% indexed across cohorts
            </span>
          )}
        </div>
        <div className="rounded-2xl border border-[#E2E8F0] bg-white shadow-sm overflow-hidden">
          <p className="px-5 py-3 text-[11px] text-[#94A3B8] border-b border-[#F1F5F9] bg-[#F8FAFC]">
            Indexed ÷ submitted per publish-week cohort. ≥70% scale · 50–69% hold ·
            &lt;50% pause.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E2E8F0] text-left text-[10px] uppercase tracking-[0.12em] text-[#94A3B8]">
                  <th className="px-5 py-3 font-bold">Cohort Week</th>
                  <th className="px-5 py-3 font-bold text-right">Submitted</th>
                  <th className="px-5 py-3 font-bold text-right">Indexed</th>
                  <th className="px-5 py-3 font-bold">Rate</th>
                  <th className="px-5 py-3 font-bold">Decision</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9]">
                {indexationGates.length === 0 ? (
                  <tr>
                    <td className="px-5 py-8 text-center text-[#94A3B8]" colSpan={5}>
                      No published cohorts yet.
                    </td>
                  </tr>
                ) : (
                  indexationGates.map((g) => (
                    <tr key={g.cohortWeek} className="hover:bg-[#F8FAFF] transition-colors">
                      <td className="px-5 py-3 font-semibold text-[#0F172A]">{g.cohortWeek}</td>
                      <td className="px-5 py-3 text-right font-mono text-[#374151]">{g.submitted}</td>
                      <td className="px-5 py-3 text-right font-mono text-[#374151]">{g.indexed}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-20 rounded-full bg-[#F1F5F9] overflow-hidden">
                            <div
                              className={`h-full rounded-full ${indexationBar(g.decision)}`}
                              style={{ width: `${Math.min(g.indexationRate * 100, 100)}%` }}
                            />
                          </div>
                          <span className="font-mono text-xs text-[#374151]">
                            {(g.indexationRate * 100).toFixed(0)}%
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${indexationCls(g.decision)}`}>
                          {g.decision}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
