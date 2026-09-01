// Admin Content Engine — the Growth rail's content destination.
//
// Batch 2 established the IA: this page is the canonical parent of
// /admin/content/bulk (the review queue), /admin/content/attribution and
// /admin/content/[id]. That relationship is unchanged and asserted by
// lib/admin/__tests__/nav-capability-preservation.test.ts.
//
// What changed here is the ORDER OF THE PAGE. It used to open with five static
// KPI cards, a coverage bar and two six-column breakdown tables, which pushed
// the only actionable thing — the article list — below the fold, and the list
// itself could not act on anything. Now the pipeline reads as a triage strip of
// one-click filters, the worktable sits directly beneath it with row and bulk
// actions, and the breakdowns are a disclosure for the periodic reporting read.

import { Suspense } from "react";
import Link from "next/link";
import { Newspaper } from "lucide-react";

import { requireAdmin } from "@/lib/auth/admin-session";
import {
  CLUSTER_OPTIONS,
  METRO_OPTIONS,
  getContentDashboardStats,
  type ContentBreakdownRow,
} from "@/lib/services/admin/admin-content.service";
import { clusterLabel } from "@/lib/content/cluster-meta";
import ContentWorktable from "@/components/admin/content/ContentWorktable";
import ContentJobsPanel from "@/components/admin/content/ContentJobsPanel";

export const dynamic = "force-dynamic";

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export default async function AdminContentPage() {
  const admin = await requireAdmin();
  const stats = await getContentDashboardStats();

  return (
    <div className="p-6 md:p-8" data-testid="admin-content-page">
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <Newspaper size={22} className="text-al-primary" aria-hidden />
          <h1 className="text-xl font-bold text-slate-900">Content Engine</h1>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <ContentJobsPanel adminRole={admin.role} />
            <Link
              href="/admin/content/bulk"
              data-testid="admin-content-bulk-link"
              className="inline-flex items-center gap-1.5 rounded-al-md border border-al-border px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-al-primary hover:bg-al-primary-subtle hover:text-al-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus"
            >
              Review queue
            </Link>
            <Link
              href="/admin/content/attribution"
              data-testid="admin-content-attribution-link"
              className="inline-flex items-center gap-1.5 rounded-al-md border border-al-border px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-al-primary hover:bg-al-primary-subtle hover:text-al-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus"
            >
              Attribution
            </Link>
          </div>
        </div>

        {/* Coverage and quality as a readout, not five cards competing with the
            work. The numbers are the same; the prominence is not. */}
        <div
          className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-slate-500"
          data-testid="content-coverage"
        >
          <span>
            <span className="font-semibold tabular-nums text-slate-700">{fmt(stats.total)}</span> of{" "}
            <span className="tabular-nums">{fmt(stats.keywordTotal)}</span> Wave&nbsp;1 keywords
            generated
          </span>
          <span aria-hidden className="text-slate-300">·</span>
          <span className="inline-flex items-center gap-2">
            <span className="tabular-nums">{stats.coveragePct}% coverage</span>
            <span
              className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100"
              role="img"
              aria-label={`${stats.coveragePct} percent of Wave 1 keywords generated`}
            >
              <span
                className="block h-full rounded-full bg-al-primary"
                style={{ width: `${stats.coveragePct}%` }}
              />
            </span>
          </span>
          <span aria-hidden className="text-slate-300">·</span>
          <span>
            Avg quality{" "}
            <span className="font-semibold tabular-nums text-slate-700">
              {stats.avgQuality === null ? "—" : `${stats.avgQuality.toFixed(1)}/6`}
            </span>
          </span>
          <span aria-hidden className="text-slate-300">·</span>
          <span className="tabular-nums">{fmt(stats.publishedWordTotal)} published words</span>
        </div>
      </header>

      <Suspense fallback={<WorktableSkeleton />}>
        <ContentWorktable
          clusters={[...CLUSTER_OPTIONS]}
          metros={[...METRO_OPTIONS]}
          syncUrl
          showTriage
        />
      </Suspense>

      {/* Reporting, not work — a disclosure so it stops displacing the list. */}
      <details className="group mt-8" data-testid="content-breakdowns">
        <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-al-md px-1 py-1 text-sm font-semibold text-slate-700 hover:text-al-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus">
          <span aria-hidden className="transition-transform group-open:rotate-90">▸</span>
          Coverage breakdown — by cluster and metro
        </summary>

        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <BreakdownTable
            title="By cluster"
            keyHeader="Cluster"
            rows={stats.clusters}
            keyLabel={clusterLabel}
            testid="content-cluster-table"
          />
          <BreakdownTable
            title="By metro"
            keyHeader="Metro"
            rows={stats.metros}
            keyLabel={(k) => k}
            testid="content-metro-table"
            emptyHint="No articles generated yet — metro performance appears once content exists."
          />
        </div>
      </details>
    </div>
  );
}

function WorktableSkeleton() {
  return (
    <div className="animate-pulse space-y-3" aria-hidden>
      <div className="h-10 rounded-al-md bg-slate-100" />
      <div className="h-14 rounded-al-lg bg-slate-100" />
      <div className="h-96 rounded-al-lg bg-slate-100" />
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
  const populated = rows.filter((r) => r.total > 0);

  return (
    <section data-testid={testid}>
      <h3 className="mb-2 text-sm font-bold text-slate-900">{title}</h3>
      <div className="rounded-al-lg border border-al-border bg-white">
        {populated.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">{emptyHint ?? "No data yet."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">{title}</caption>
              <thead>
                <tr className="border-b border-al-border text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th scope="col" className="px-4 py-2.5 font-semibold">{keyHeader}</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold">Total</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold">Published</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold">Review</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold">Draft</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold">Avg quality</th>
                </tr>
              </thead>
              <tbody>
                {populated.map((r) => (
                  <tr key={r.key} className="border-b border-slate-50 last:border-0">
                    <th scope="row" className="px-4 py-2.5 text-left font-medium text-slate-800">
                      {keyLabel(r.key)}
                    </th>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{fmt(r.total)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-al-success">{fmt(r.published)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-al-warning">{fmt(r.review)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{fmt(r.draft)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                      {r.avgQuality === null ? "—" : `${r.avgQuality.toFixed(1)}/6`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
