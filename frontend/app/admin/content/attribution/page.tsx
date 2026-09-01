// /admin/content/attribution — content-engine leads and conversions.
//
// Reports by cluster, metro, state and city, plus a 30-day trend and the top
// articles. Server component; reads the report from the analytics service.
// Renders cleanly against an empty database.
//
// This page was the one Content surface with no link back to its parent, and
// the only one still carrying module-level colour constants instead of the
// al-* tokens. Both are fixed here. Its server authorization is deliberately
// UNCHANGED — requireAdmin() only, every operational role keeps access, and the
// CSV export is neither hidden nor gated in the UI. The export's PII exposure
// is a known finding awaiting a separately authorized security batch; the
// control now states what the file contains so nobody downloads buyer email
// without knowing.

import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  BarChart2,
  Building2,
  Download,
  FileText,
  Flag,
  Layers,
  Map as MapIcon,
  TrendingUp,
} from "lucide-react";

import { requireAdmin } from "@/lib/auth/admin-session";
import {
  getContentAttributionReport,
  type AttributionDimensionRow,
} from "@/lib/services/analytics/content-attribution-analytics.service";
import { formatCentsAsUsd } from "@/lib/constants";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Content Attribution — Admin" };

/** Accent roles, from the token layer rather than restated hex. */
type Accent = "primary" | "success" | "accent" | "warning";

const ACCENT_TEXT: Record<Accent, string> = {
  primary: "text-al-primary",
  success: "text-al-success",
  accent: "text-al-accent",
  warning: "text-al-warning",
};
const ACCENT_DOT: Record<Accent, string> = {
  primary: "bg-al-primary",
  success: "bg-al-success",
  accent: "bg-al-accent",
  warning: "bg-al-warning",
};
const ACCENT_WASH: Record<Accent, string> = {
  primary: "bg-al-primary-subtle",
  success: "bg-al-success-subtle",
  accent: "bg-al-accent/10",
  warning: "bg-al-warning-subtle",
};

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function KpiCard({
  label,
  value,
  sub,
  accent = "primary",
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: Accent;
}) {
  return (
    <div
      data-testid={`kpi-${label.toLowerCase().replace(/\s+/g, "-")}`}
      className="rounded-al-lg border border-al-border bg-white p-5 shadow-al-1"
    >
      <div className="mb-3 flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${ACCENT_DOT[accent]}`} aria-hidden />
        <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">{label}</p>
      </div>
      <p className="font-mono text-3xl font-bold tracking-tight tabular-nums text-al-text">{value}</p>
      {sub && <p className="mt-1 text-xs font-medium text-slate-400">{sub}</p>}
    </div>
  );
}

function DimensionTable({
  title,
  icon: Icon,
  accent = "primary",
  testId,
  keyHeader,
  rows,
}: {
  title: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  accent?: Accent;
  testId: string;
  keyHeader: string;
  rows: AttributionDimensionRow[];
}) {
  return (
    <section
      data-testid={testId}
      className="rounded-al-lg border border-al-border bg-white p-5 shadow-al-1 md:p-6"
    >
      <div className="mb-5 flex items-center gap-2.5">
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-al-lg ${ACCENT_WASH[accent]}`}
          aria-hidden
        >
          <Icon size={15} className={ACCENT_TEXT[accent]} />
        </span>
        <h2 className={`text-sm font-bold tracking-tight ${ACCENT_TEXT[accent]}`}>{title}</h2>
      </div>

      {rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">No content-attributed leads yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="border-b border-slate-100 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                <th scope="col" className="py-2 pr-3 text-left font-bold">{keyHeader}</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Leads</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Conv.</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Rate</th>
                <th scope="col" className="py-2 pl-3 text-right font-bold">Value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-slate-50 last:border-0">
                  <th scope="row" className="py-2.5 pr-3 text-left font-normal capitalize text-al-text">
                    {r.key.replace(/[_]/g, " ")}
                  </th>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-600">
                    {fmt(r.leads)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono font-bold tabular-nums text-al-success">
                    {fmt(r.conversions)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums text-al-text">
                    {r.conversionRate}%
                  </td>
                  <td className="py-2.5 pl-3 text-right font-mono tabular-nums text-al-text">
                    {formatCentsAsUsd(r.valueCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * 30-day trend.
 *
 * The bars carry a `title` only, which is mouse-only and unreadable to a screen
 * reader — so the same series is also published as a real table in a
 * disclosure. Sighted users get the shape; everyone can get the numbers.
 */
function TrendChart({ points }: { points: { date: string; leads: number; conversions: number }[] }) {
  const max = Math.max(1, ...points.map((p) => p.leads));
  const totals = points.reduce(
    (acc, p) => ({ leads: acc.leads + p.leads, conversions: acc.conversions + p.conversions }),
    { leads: 0, conversions: 0 },
  );

  return (
    <section
      data-testid="attribution-trend"
      className="rounded-al-lg border border-al-border bg-white p-5 shadow-al-1 md:p-6"
    >
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span
            className={`flex h-8 w-8 items-center justify-center rounded-al-lg ${ACCENT_WASH.primary}`}
            aria-hidden
          >
            <TrendingUp size={15} className={ACCENT_TEXT.primary} />
          </span>
          <h2 className="text-sm font-bold tracking-tight text-al-primary">Last 30 days</h2>
        </div>
        <div className="flex items-center gap-4 text-[11px] text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-al-primary" aria-hidden /> Leads
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-al-success" aria-hidden /> Conversions
          </span>
        </div>
      </div>

      <div
        className="flex h-28 items-end gap-1"
        role="img"
        aria-label={`Daily leads and conversions over the last ${points.length} days: ${fmt(totals.leads)} leads and ${fmt(totals.conversions)} conversions in total. The same figures are listed in the table below.`}
      >
        {points.map((p) => (
          <div key={p.date} className="flex flex-1 flex-col items-center justify-end gap-0.5">
            <div className="flex h-full w-full flex-col items-center justify-end">
              <div
                className="w-full rounded-t bg-al-primary"
                style={{
                  height: `${Math.round((p.leads / max) * 100)}%`,
                  opacity: p.leads === 0 ? 0.15 : 1,
                }}
              />
              <div
                className="w-full bg-al-success"
                style={{ height: `${Math.round((p.conversions / max) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <details className="group mt-4" data-testid="attribution-trend-table">
        <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded text-xs font-semibold text-al-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus">
          <span aria-hidden className="transition-transform group-open:rotate-90">▸</span>
          View the daily figures as a table
        </summary>
        <div className="mt-3 max-h-64 overflow-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Daily content-attributed leads and conversions, last {points.length} days
            </caption>
            <thead>
              <tr className="border-b border-slate-100 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                <th scope="col" className="py-2 pr-3 text-left font-bold">Date</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Leads</th>
                <th scope="col" className="py-2 pl-3 text-right font-bold">Conversions</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.date} className="border-b border-slate-50 last:border-0">
                  <th scope="row" className="py-2 pr-3 text-left font-normal text-al-text">{p.date}</th>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-600">{fmt(p.leads)}</td>
                  <td className="py-2 pl-3 text-right font-mono tabular-nums text-al-success">
                    {fmt(p.conversions)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

export default async function ContentAttributionPage() {
  await requireAdmin();
  const report = await getContentAttributionReport();

  return (
    <div data-testid="content-attribution-page" className="p-6 md:p-8">
      <Link
        href="/admin/content"
        data-testid="attribution-parent-link"
        className="mb-4 inline-flex items-center gap-1.5 rounded text-sm text-al-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus"
      >
        <ArrowLeft size={14} aria-hidden /> Content Engine
      </Link>

      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1.5 flex items-center gap-2">
            <BarChart2 size={16} className="text-al-primary" aria-hidden />
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
              Content Engine
            </p>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-al-text">Content Attribution</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Leads and conversions by cluster, metro, state and city · Last updated{" "}
            {new Date(report.generatedAt).toLocaleString("en-US")}
          </p>
        </div>

        <div className="shrink-0">
          <a
            href="/api/admin/content/attribution/export"
            data-testid="attribution-export-csv"
            className="inline-flex items-center gap-2 rounded-al-lg border border-al-border bg-white px-4 py-2.5 text-sm font-semibold text-al-text shadow-al-1 transition-colors hover:border-al-primary hover:text-al-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus"
          >
            <Download size={15} aria-hidden />
            Export CSV
          </a>
          {/* Says what leaves the building. The file carries buyer email; the
              control is not hidden or gated here, and the route's authorization
              is unchanged — this is disclosure, not enforcement. */}
          <p
            className="mt-1.5 max-w-[15rem] text-xs text-al-warning-fg"
            data-testid="attribution-export-pii-notice"
          >
            Contains buyer email addresses — personal data. Handle per the PII policy.
          </p>
        </div>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard
          label="Content Leads"
          value={fmt(report.totals.leads)}
          sub="attributed to articles"
        />
        <KpiCard
          label="Conversions"
          value={fmt(report.totals.conversions)}
          sub="deal / paid deposit"
          accent="success"
        />
        <KpiCard
          label="Conversion"
          value={`${report.totals.conversionRate}%`}
          sub="leads → converted"
          accent="accent"
        />
        <KpiCard
          label="Attributed Value"
          value={formatCentsAsUsd(report.totals.valueCents)}
          sub="deposit value"
          accent="warning"
        />
      </div>

      <div className="mb-6">
        <TrendChart points={report.dailyTrend} />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <DimensionTable
          title="By cluster"
          icon={Layers}
          testId="attribution-by-cluster"
          keyHeader="Cluster"
          rows={report.byCluster}
        />
        <DimensionTable
          title="By metro"
          icon={MapIcon}
          accent="success"
          testId="attribution-by-metro"
          keyHeader="Metro"
          rows={report.byMetro}
        />
        <DimensionTable
          title="By state"
          icon={Flag}
          accent="accent"
          testId="attribution-by-state"
          keyHeader="State"
          rows={report.byState}
        />
        <DimensionTable
          title="By city"
          icon={Building2}
          accent="warning"
          testId="attribution-by-city"
          keyHeader="City"
          rows={report.byCity}
        />
      </div>

      <DimensionTable
        title="Top articles"
        icon={FileText}
        testId="attribution-top-articles"
        keyHeader="Article slug"
        rows={report.topArticles}
      />
    </div>
  );
}
