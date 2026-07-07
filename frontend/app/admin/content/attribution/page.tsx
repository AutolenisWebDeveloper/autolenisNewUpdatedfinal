// /admin/content/attribution — Phase C-Attribution dashboard.
// Reports content-engine leads and conversions by cluster, metro, state, and
// city — the national metro/state dimensions sit alongside cluster and city.
// Server component; reads the report directly from the analytics service.
// Renders cleanly against an empty database (zero state).
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/admin-session";
import {
  getContentAttributionReport,
  type AttributionDimensionRow,
} from "@/lib/services/analytics/content-attribution-analytics.service";
import { formatCentsAsUsd } from "@/lib/constants";
import {
  BarChart2, Layers, Map as MapIcon, Flag, Building2, FileText, Download, TrendingUp,
} from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Content Attribution — Admin" };

const BLUE = "#0B5FD1";
const GREEN = "#059669";
const PURPLE = "#643293";

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

function DimensionTable({
  title, icon: Icon, accent = BLUE, testId, keyHeader, rows,
}: {
  title: string;
  icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>;
  accent?: string;
  testId: string;
  keyHeader: string;
  rows: AttributionDimensionRow[];
}) {
  return (
    <section
      data-testid={testId}
      className="bg-white border border-[#E2E8F0] rounded-2xl p-5 md:p-6 shadow-sm"
    >
      <div className="flex items-center gap-2.5 mb-5">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${accent}15` }}>
          <Icon size={15} style={{ color: accent }} />
        </div>
        <h2 className="text-sm font-bold tracking-tight" style={{ color: accent }}>{title}</h2>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-[#94A3B8] py-4 text-center">No content-attributed leads yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] font-bold text-[#94A3B8] uppercase tracking-[0.12em] border-b border-[#F1F5F9]">
                <th className="text-left py-2 pr-3 font-bold">{keyHeader}</th>
                <th className="text-right py-2 px-3 font-bold">Leads</th>
                <th className="text-right py-2 px-3 font-bold">Conv.</th>
                <th className="text-right py-2 px-3 font-bold">Rate</th>
                <th className="text-right py-2 pl-3 font-bold">Value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-[#F8FAFC] last:border-0">
                  <td className="py-2.5 pr-3 text-[#0F172A] capitalize">{r.key.replace(/[_]/g, " ")}</td>
                  <td className="py-2.5 px-3 text-right font-mono text-[#475569]">{r.leads.toLocaleString("en-US")}</td>
                  <td className="py-2.5 px-3 text-right font-mono font-bold" style={{ color: GREEN }}>{r.conversions.toLocaleString("en-US")}</td>
                  <td className="py-2.5 px-3 text-right font-mono text-[#0F172A]">{r.conversionRate}%</td>
                  <td className="py-2.5 pl-3 text-right font-mono text-[#0F172A]">{formatCentsAsUsd(r.valueCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function TrendChart({
  points,
}: {
  points: { date: string; leads: number; conversions: number }[];
}) {
  const max = Math.max(1, ...points.map((p) => p.leads));
  return (
    <section
      data-testid="attribution-trend"
      className="bg-white border border-[#E2E8F0] rounded-2xl p-5 md:p-6 shadow-sm"
    >
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${BLUE}15` }}>
            <TrendingUp size={15} style={{ color: BLUE }} />
          </div>
          <h2 className="text-sm font-bold tracking-tight" style={{ color: BLUE }}>Last 30 Days</h2>
        </div>
        <div className="flex items-center gap-4 text-[11px] text-[#94A3B8]">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: BLUE }} /> Leads
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: GREEN }} /> Conversions
          </span>
        </div>
      </div>
      <div className="flex items-end gap-1 h-28">
        {points.map((p) => (
          <div
            key={p.date}
            className="flex-1 flex flex-col items-center justify-end gap-0.5"
            title={`${p.date}: ${p.leads} leads, ${p.conversions} conversions`}
          >
            <div className="w-full flex flex-col justify-end items-center" style={{ height: "100%" }}>
              <div
                className="w-full rounded-t"
                style={{
                  height: `${Math.round((p.leads / max) * 100)}%`,
                  backgroundColor: BLUE,
                  opacity: p.leads === 0 ? 0.15 : 1,
                }}
              />
              <div
                className="w-full"
                style={{
                  height: `${Math.round((p.conversions / max) * 100)}%`,
                  backgroundColor: GREEN,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default async function ContentAttributionPage() {
  await requireAdmin();
  const report = await getContentAttributionReport();

  return (
    <div
      data-testid="content-attribution-page"
      className="min-h-screen bg-[#F4F6FA] p-6 md:p-8 max-w-[1400px] mx-auto space-y-6"
    >
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <BarChart2 size={16} style={{ color: BLUE }} />
            <p className="text-[10px] text-[#94A3B8] font-semibold uppercase tracking-widest">
              Content Engine
            </p>
          </div>
          <h1 className="text-2xl font-bold text-[#0F172A] tracking-tight">Content Attribution</h1>
          <p className="text-sm text-[#94A3B8] mt-0.5">
            Leads &amp; conversions by cluster, metro, state, and city · Last updated:{" "}
            {new Date(report.generatedAt).toLocaleString("en-US")}
          </p>
        </div>
        <a
          href="/api/admin/content/attribution/export"
          data-testid="attribution-export-csv"
          className="inline-flex shrink-0 items-center gap-2 px-4 py-2.5 bg-white border border-[#E2E8F0] rounded-xl text-sm font-semibold text-[#0F172A] hover:border-al-primary hover:text-al-primary transition-colors shadow-sm"
        >
          <Download size={15} />
          Export CSV
        </a>
      </header>

      {/* Totals */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KPICard label="Content Leads" value={report.totals.leads.toLocaleString("en-US")} sub="attributed to articles" />
        <KPICard label="Conversions" value={report.totals.conversions.toLocaleString("en-US")} sub="deal / paid deposit" accent={GREEN} />
        <KPICard label="Conversion" value={`${report.totals.conversionRate}%`} sub="leads → converted" accent={PURPLE} />
        <KPICard label="Attributed Value" value={formatCentsAsUsd(report.totals.valueCents)} sub="deposit value" accent="#D97706" />
      </div>

      <TrendChart points={report.dailyTrend} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DimensionTable title="By Cluster" icon={Layers} testId="attribution-by-cluster" keyHeader="Cluster" rows={report.byCluster} />
        <DimensionTable title="By Metro" icon={MapIcon} testId="attribution-by-metro" accent={GREEN} keyHeader="Metro" rows={report.byMetro} />
        <DimensionTable title="By State" icon={Flag} testId="attribution-by-state" accent={PURPLE} keyHeader="State" rows={report.byState} />
        <DimensionTable title="By City" icon={Building2} testId="attribution-by-city" accent="#D97706" keyHeader="City" rows={report.byCity} />
      </div>

      <DimensionTable title="Top Articles" icon={FileText} testId="attribution-top-articles" keyHeader="Article Slug" rows={report.topArticles} />
    </div>
  );
}
