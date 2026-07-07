// Phase C3 — Admin Content Management UI.
//
// Command center for the national SEO content engine. Shows generation
// coverage, per-status totals, a cluster breakdown, a metro-level breakdown
// (the v3 addition — performance by metro, not just by cluster), and a
// filterable/paginated list of every generated ContentArticle. Each row links
// to the per-article review page where status can be changed.

import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin-session";
import { Badge } from "@/components/ui/badge";
import { Newspaper } from "lucide-react";
import {
  getContentDashboardStats,
  getContentArticleList,
  CLUSTER_OPTIONS,
  METRO_OPTIONS,
  type ContentBreakdownRow,
} from "@/lib/services/admin/admin-content.service";
import {
  ARTICLE_STATUSES,
  clusterLabel,
  statusMeta,
} from "@/lib/content/cluster-meta";
import ContentFilters from "@/components/admin/content/ContentFilters";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    cluster?: string;
    status?: string;
    metro?: string;
    q?: string;
    page?: string;
  }>;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function quality(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}/6`;
}

export default async function AdminContentPage({ searchParams }: PageProps) {
  await requireAdmin();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);

  const [stats, list] = await Promise.all([
    getContentDashboardStats(),
    getContentArticleList({
      cluster: sp.cluster,
      status: sp.status,
      metro: sp.metro,
      q: sp.q,
      page,
    }),
  ]);

  const kpis = [
    { label: "Total Articles", value: fmt(stats.total) },
    { label: "Published", value: fmt(stats.byStatus.PUBLISHED) },
    { label: "Review Needed", value: fmt(stats.byStatus.REVIEW_NEEDED) },
    { label: "Drafts", value: fmt(stats.byStatus.DRAFT) },
    { label: "Avg Quality", value: quality(stats.avgQuality) },
  ];

  return (
    <div className="p-6 md:p-8 max-w-6xl" data-testid="admin-content-page">
      <div className="flex items-center gap-3 mb-1">
        <Newspaper size={22} className="text-al-primary" />
        <h1 className="text-xl font-bold text-slate-900">Content Engine</h1>
        <Badge variant="secondary">Phase C3</Badge>
      </div>
      <p className="text-sm text-slate-500 mb-6">
        National SEO content management — {fmt(stats.total)} of {fmt(stats.keywordTotal)} Wave 1
        keywords generated ({stats.coveragePct}% coverage).
      </p>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6" data-testid="content-kpis">
        {kpis.map((k) => (
          <div
            key={k.label}
            className="bg-white border border-[#E2E8F0] rounded-xl p-4 text-center"
          >
            <p className="text-2xl font-bold text-al-primary">{k.value}</p>
            <p className="text-xs font-semibold text-slate-600 mt-0.5">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Coverage bar */}
      <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 mb-8" data-testid="content-coverage">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold text-slate-800">Wave 1 Generation Coverage</p>
          <p className="text-xs text-slate-500">
            {fmt(stats.total)} / {fmt(stats.keywordTotal)} · {fmt(stats.publishedWordTotal)} published words
          </p>
        </div>
        <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-full rounded-full bg-al-primary transition-all"
            style={{ width: `${stats.coveragePct}%` }}
          />
        </div>
      </div>

      {/* Cluster breakdown */}
      <BreakdownTable
        title="Breakdown by Cluster"
        keyHeader="Cluster"
        rows={stats.clusters}
        keyLabel={(key) => clusterLabel(key)}
        testid="content-cluster-table"
      />

      {/* Metro breakdown — the v3 addition */}
      <BreakdownTable
        title="Breakdown by Metro"
        keyHeader="Metro"
        rows={stats.metros}
        keyLabel={(key) => key}
        testid="content-metro-table"
        emptyHint="No articles generated yet — metro performance appears once Phase C2 runs."
      />

      {/* Article list */}
      <div className="flex flex-wrap items-center justify-between gap-3 mt-10 mb-4">
        <h2 className="text-base font-bold text-slate-900">
          Articles{" "}
          <span className="text-sm font-normal text-slate-400">({fmt(list.total)})</span>
        </h2>
        <ContentFilters
          clusters={CLUSTER_OPTIONS}
          metros={METRO_OPTIONS}
          statuses={[...ARTICLE_STATUSES]}
        />
      </div>

      <div
        className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden"
        data-testid="content-article-list"
      >
        {list.items.length === 0 ? (
          <div className="text-center py-16 text-slate-400" data-testid="content-list-empty">
            <p>No articles match these filters.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E2E8F0] text-left text-[11px] uppercase tracking-wide text-slate-400">
                <th className="px-4 py-2.5 font-semibold">Title</th>
                <th className="px-4 py-2.5 font-semibold">Cluster</th>
                <th className="px-4 py-2.5 font-semibold">Location</th>
                <th className="px-4 py-2.5 font-semibold">Quality</th>
                <th className="px-4 py-2.5 font-semibold">Words</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((a) => {
                const meta = statusMeta(a.status);
                return (
                  <tr
                    key={a.id}
                    className="border-b border-slate-50 hover:bg-[#F8FAFF] transition-colors"
                    data-testid={`content-row-${a.id}`}
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/content/${a.id}`}
                        className="font-medium text-slate-800 hover:text-al-primary"
                      >
                        {a.title}
                      </Link>
                      <p className="text-xs text-slate-400">{a.slug}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{clusterLabel(a.cluster)}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {a.city}, {a.state}
                      {a.metro ? <span className="text-slate-400"> · {a.metro}</span> : null}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{quality(a.qualityScore)}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {a.wordCount ? fmt(a.wordCount) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {list.pageCount > 1 && (
        <Pagination
          page={list.page}
          pageCount={list.pageCount}
          searchParams={sp}
        />
      )}
    </div>
  );
}

function BreakdownTable({
  title,
  keyHeader,
  rows,
  keyLabel,
  testid,
  emptyHint,
}: {
  title: string;
  keyHeader: string;
  rows: ContentBreakdownRow[];
  keyLabel: (key: string) => string;
  testid: string;
  emptyHint?: string;
}) {
  const hasData = rows.some((r) => r.total > 0);
  return (
    <div className="mb-8" data-testid={testid}>
      <h2 className="text-base font-bold text-slate-900 mb-3">{title}</h2>
      <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
        {rows.length === 0 || !hasData ? (
          <div className="text-center py-10 text-sm text-slate-400">
            {emptyHint ?? "No data yet."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E2E8F0] text-left text-[11px] uppercase tracking-wide text-slate-400">
                <th className="px-4 py-2.5 font-semibold">{keyHeader}</th>
                <th className="px-4 py-2.5 font-semibold text-right">Total</th>
                <th className="px-4 py-2.5 font-semibold text-right">Published</th>
                <th className="px-4 py-2.5 font-semibold text-right">Review</th>
                <th className="px-4 py-2.5 font-semibold text-right">Draft</th>
                <th className="px-4 py-2.5 font-semibold text-right">Avg Quality</th>
              </tr>
            </thead>
            <tbody>
              {rows
                .filter((r) => r.total > 0)
                .map((r) => (
                  <tr key={r.key} className="border-b border-slate-50">
                    <td className="px-4 py-2.5 font-medium text-slate-800">
                      {keyLabel(r.key)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-700">{fmt(r.total)}</td>
                    <td className="px-4 py-2.5 text-right text-green-700">{fmt(r.published)}</td>
                    <td className="px-4 py-2.5 text-right text-amber-700">{fmt(r.review)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500">{fmt(r.draft)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-700">
                      {r.avgQuality === null ? "—" : `${r.avgQuality.toFixed(1)}/6`}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Pagination({
  page,
  pageCount,
  searchParams,
}: {
  page: number;
  pageCount: number;
  searchParams: Record<string, string | undefined>;
}) {
  const buildHref = (target: number) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (value && key !== "page") next.set(key, value);
    }
    next.set("page", String(target));
    return `/admin/content?${next.toString()}`;
  };

  return (
    <div className="flex items-center justify-center gap-4 mt-6" data-testid="content-pagination">
      {page > 1 ? (
        <Link href={buildHref(page - 1)} className="text-sm text-al-primary hover:underline">
          ← Previous
        </Link>
      ) : (
        <span className="text-sm text-slate-300">← Previous</span>
      )}
      <span className="text-sm text-slate-500">
        Page {page} of {pageCount}
      </span>
      {page < pageCount ? (
        <Link href={buildHref(page + 1)} className="text-sm text-al-primary hover:underline">
          Next →
        </Link>
      ) : (
        <span className="text-sm text-slate-300">Next →</span>
      )}
    </div>
  );
}
