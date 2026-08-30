"use client";

// The Content worktable — ONE article list, used by both /admin/content and
// /admin/content/bulk (the review queue).
//
// It replaces two divergent tables: a read-only server-rendered list on the
// dashboard and a separate actionable client table on /bulk, which differed in
// columns, page size, search semantics, filters and status vocabulary. Deciding
// which one to open was itself an operator step.
//
// Three things here are load-bearing rather than cosmetic:
//
//  • Selection lives in ./selection, which models "all matching EXCEPT these".
//    Un-ticking one row used to collapse the whole batch to that single row.
//  • The confirmation dialog is never opened while the count is stale. The
//    count comes from a fetch keyed on filterSignature(); until that fetch
//    matches the active filter the action button stays busy, so an irreversible
//    dialog can never quote a number belonging to a filter already left.
//  • Select-all-matching is withheld while a free-text search is active,
//    because the bulk endpoint has no free-text predicate and would otherwise
//    act on a wider set than the list showed.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  Loader2,
  Search,
  XCircle,
} from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api/client";
import { ConfirmDialog } from "@/components/ui/kit";
import {
  TONE_DOT,
  TONE_TEXT,
  clusterLabel,
  parseQualityFlags,
  qualityTone,
  statusMeta,
  wordCountTone,
} from "@/lib/content/cluster-meta";
import ArticlePreviewDialog from "./ArticlePreviewDialog";
import {
  EMPTY_FILTERS,
  QUALITY_OPTIONS,
  SORT_OPTIONS,
  type ContentFilterState,
  filterSignature,
  fromSearchParams,
  isBulkFilterable,
  toBulkFilter,
  toQueryParams,
  toSearchParams,
} from "./content-filters";
import {
  EMPTY_SELECTION,
  type SelectionState,
  clearSelection,
  hasSelection,
  isPageFullySelected,
  isRowSelected,
  selectAllMatching,
  selectedCount,
  toBulkTarget,
  togglePage,
  toggleRow,
} from "./selection";

const PAGE_SIZE = 50;

interface Article {
  id: string;
  slug: string;
  title: string;
  cluster: string;
  metro: string | null;
  city?: string | null;
  state?: string | null;
  status: string;
  wordCount: number | null;
  qualityScore: number | null;
  qualityFlags: string | null;
  publishedAt: string | null;
  createdAt: string;
}

interface Stats {
  total: number;
  published: number;
  review_needed: number;
  draft: number;
  retired: number;
  scheduled: number;
  failed: number;
}

const EMPTY_STATS: Stats = {
  total: 0,
  published: 0,
  review_needed: 0,
  draft: 0,
  retired: 0,
  scheduled: 0,
  failed: 0,
};

type BulkAction = "publish" | "reject" | "draft";

const ACTION_COPY: Record<BulkAction, { verb: string; past: string; variant: "primary" | "danger" }> = {
  publish: { verb: "Publish", past: "Published", variant: "primary" },
  reject: { verb: "Archive", past: "Archived", variant: "danger" },
  draft: { verb: "Move to draft", past: "Moved to draft", variant: "primary" },
};

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * The triage strip. Ordered by operational urgency rather than by enum order:
 * the two chips that represent WORK come first, the rest are inventory.
 */
function triageChips(stats: Stats) {
  return [
    { key: "review", label: "Needs review", value: stats.review_needed, tone: "warn" as const, filter: { status: "REVIEW_NEEDED", scheduled: "", failed: "" } },
    { key: "failed", label: "Failed", value: stats.failed, tone: "bad" as const, filter: { status: "", scheduled: "", failed: "1" } },
    { key: "scheduled", label: "Scheduled", value: stats.scheduled, tone: "info" as const, filter: { status: "", scheduled: "1", failed: "" } },
    { key: "draft", label: "Draft", value: stats.draft, tone: "neutral" as const, filter: { status: "DRAFT", scheduled: "", failed: "" } },
    { key: "published", label: "Published", value: stats.published, tone: "good" as const, filter: { status: "PUBLISHED", scheduled: "", failed: "" } },
    { key: "archived", label: "Archived", value: stats.retired, tone: "muted" as const, filter: { status: "ARCHIVED", scheduled: "", failed: "" } },
    { key: "all", label: "All articles", value: stats.total, tone: "muted" as const, filter: { status: "", scheduled: "", failed: "" } },
  ];
}

const CHIP_TONE: Record<string, string> = {
  warn: "text-al-warning",
  bad: "text-al-danger",
  info: "text-al-info",
  good: "text-al-success",
  neutral: "text-slate-600",
  muted: "text-slate-500",
};

export interface ContentWorktableProps {
  clusters: string[];
  metros: string[];
  /**
   * Filters this surface is pinned to. The review queue passes
   * { status: "REVIEW_NEEDED" }; the dashboard passes nothing and reads the URL.
   */
  scopeFilters?: Partial<ContentFilterState>;
  /** Write filter state back to the URL. Off for the pinned review queue. */
  syncUrl?: boolean;
  /** Hide the triage strip where the surface is already scoped to one chip. */
  showTriage?: boolean;
}

export default function ContentWorktable({
  clusters,
  metros,
  scopeFilters,
  syncUrl = false,
  showTriage = true,
}: ContentWorktableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const urlParams = useSearchParams();

  // Seeded once, lazily: after mount this component owns the filter state and
  // pushes it to the URL, so re-deriving from the params would fight its own
  // writes. A lazy initializer says exactly that, with no lint suppression.
  const [filters, setFilters] = useState<ContentFilterState>(() => ({
    ...EMPTY_FILTERS,
    ...(syncUrl ? fromSearchParams(urlParams) : {}),
    ...scopeFilters,
  }));
  const [searchInput, setSearchInput] = useState(filters.search);
  const [page, setPage] = useState(1);

  const [articles, setArticles] = useState<Article[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** The filter the current `total` was measured against. */
  const [totalsSignature, setTotalsSignature] = useState<string | null>(null);

  const [selection, setSelection] = useState<SelectionState>(EMPTY_SELECTION);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [openFlags, setOpenFlags] = useState<string | null>(null);

  const [pendingAction, setPendingAction] = useState<BulkAction | null>(null);
  /**
   * A shortcut that must first CHANGE the filter, then act on everything the
   * new filter matches. It cannot do both in one tick: changing the filter
   * clears the selection (below), which would wipe a selection set alongside
   * it. So the intent is parked against the signature it is waiting for.
   */
  const [queuedIntent, setQueuedIntent] = useState<{ signature: string; action: BulkAction } | null>(
    null,
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [breakdown, setBreakdown] = useState<Record<string, number> | null>(null);

  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const toastTimer = useRef<number | null>(null);

  const activeSignature = filterSignature(filters);
  const countIsCurrent = totalsSignature === activeSignature;

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, []);

  // Debounce typing into the active filter.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setFilters((f) => (f.search === searchInput ? f : { ...f, search: searchInput }));
    }, 350);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  // Any change to the matching set invalidates both the page and the selection.
  useEffect(() => {
    setPage(1);
    setSelection(clearSelection());
  }, [activeSignature]);

  // Declared AFTER the clear above so it runs second in the same commit: the
  // shortcut's selection survives the filter change that triggered it.
  useEffect(() => {
    if (!queuedIntent || queuedIntent.signature !== activeSignature) return;
    setSelection(selectAllMatching(EMPTY_SELECTION));
    setPendingAction(queuedIntent.action);
    setQueuedIntent(null);
  }, [queuedIntent, activeSignature]);

  // Mirror filters into the URL so a filtered view is shareable and Back works.
  useEffect(() => {
    if (!syncUrl) return;
    const next = toSearchParams(filters).toString();
    if (next === urlParams.toString()) return;
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  }, [filters, syncUrl, pathname, router, urlParams]);

  const fetchArticles = useCallback(async () => {
    const signature = filterSignature(filters);
    setLoading(true);
    setLoadError(null);
    try {
      const params = toQueryParams(filters, { page: String(page), limit: String(PAGE_SIZE) });
      const data = await api.get<{
        articles: Article[];
        total: number;
        hasMore: boolean;
        stats: Stats;
      }>(`/api/admin/content/articles?${params.toString()}`);
      setArticles(data.articles);
      setTotal(data.total);
      setHasMore(data.hasMore);
      setStats(data.stats);
      setTotalsSignature(signature);
    } catch (e) {
      const message = apiErrorMessage(e, "Failed to load articles");
      setLoadError(message);
      showToast(message, "error");
      // Drop any parked bulk intent. Its count can no longer be verified, and
      // leaving it armed would let the dialog open later against a different
      // fetch than the one the operator acted on.
      setPendingAction(null);
      setQueuedIntent(null);
    } finally {
      setLoading(false);
    }
  }, [filters, page, showToast]);

  useEffect(() => {
    void fetchArticles();
  }, [fetchArticles]);

  const patchFilter = useCallback(
    (patch: Partial<ContentFilterState>) => {
      setFilters((f) => ({ ...f, ...patch, ...scopeFilters }));
      if (patch.search !== undefined) setSearchInput(patch.search);
    },
    [scopeFilters],
  );

  const pageIds = useMemo(() => articles.map((a) => a.id), [articles]);
  const count = selectedCount(selection, total);
  const anySelected = hasSelection(selection, total);
  const canSelectAll = isBulkFilterable(filters);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const changeRowStatus = useCallback(
    async (id: string, status: "PUBLISHED" | "ARCHIVED") => {
      setRowBusy(id);
      try {
        await api.patch<unknown>(`/api/admin/content/articles/${id}`, { status });
        showToast(status === "PUBLISHED" ? "Article published." : "Article archived.");
        setPreviewId(null);
        await fetchArticles();
      } catch (e) {
        showToast(apiErrorMessage(e, "Update failed"), "error");
      } finally {
        setRowBusy(null);
      }
    },
    [showToast, fetchArticles],
  );

  /**
   * Ask to run a bulk action. The dialog does not open here — it opens from the
   * effect below, once the count is known to describe the CURRENT filter. That
   * ordering is the stale-count fix.
   */
  const requestBulk = useCallback(
    (action: BulkAction) => {
      setPendingAction(action);
      setBreakdown(null);
    },
    [],
  );

  useEffect(() => {
    if (!pendingAction || confirmOpen || !countIsCurrent || loading) return;
    setConfirmOpen(true);

    if (selection.mode === "all-matching") {
      const params = toQueryParams(filters, { breakdown: "1", limit: "1", page: "1" });
      api
        .get<{ breakdown?: { clusters: Record<string, number> } }>(
          `/api/admin/content/articles?${params.toString()}`,
        )
        .then((d) => d.breakdown && setBreakdown(d.breakdown.clusters))
        .catch(() => {
          /* the breakdown is context, not a precondition */
        });
    }
  }, [pendingAction, confirmOpen, countIsCurrent, loading, selection.mode, filters]);

  const runBulk = useCallback(async () => {
    if (!pendingAction) return;
    const target = toBulkTarget(selection, toBulkFilter(filters), total);
    if (!target) {
      showToast("Nothing is selected.", "error");
      return;
    }
    try {
      const data = await api.post<{ updated: number }>("/api/admin/content/articles/bulk", {
        action: pendingAction,
        ...target,
      });
      showToast(
        `${ACTION_COPY[pendingAction].past} ${fmt(data.updated)} article${data.updated === 1 ? "" : "s"}.`,
      );
      setSelection(clearSelection());
      await fetchArticles();
    } catch (e) {
      showToast(apiErrorMessage(e, "Bulk action failed"), "error");
      throw e; // keeps the kit dialog open on failure
    }
  }, [pendingAction, selection, filters, total, showToast, fetchArticles]);

  // ── Render ────────────────────────────────────────────────────────────────
  const chips = triageChips(stats);
  const noArticlesAtAll = stats.total === 0;
  const busyCount = !countIsCurrent || loading;

  return (
    <div data-testid="content-worktable">
      {/* Review shortcut. The old copy asserted "All are compliance-clean" next
          to a one-click bulk publish; nothing computed that, so it is gone. The
          two actions it offered are not. */}
      {showTriage && stats.review_needed > 0 && filters.status !== "REVIEW_NEEDED" && (
        <div
          className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-al-lg border border-amber-200 bg-al-warning-subtle px-5 py-4"
          data-testid="review-banner"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="mt-0.5 shrink-0 text-al-warning" aria-hidden />
            <div>
              <p className="text-sm font-semibold text-al-warning-fg">
                {fmt(stats.review_needed)} article{stats.review_needed === 1 ? "" : "s"} waiting for
                review
              </p>
              <p className="text-xs text-al-warning-fg/80">
                Publish them together, or open the queue to decide one at a time.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const next = { ...filters, status: "REVIEW_NEEDED", scheduled: "", failed: "" };
                setQueuedIntent({ signature: filterSignature(next), action: "publish" });
                setFilters(next);
              }}
              data-testid="banner-publish-all"
              className="rounded-al-md bg-al-success px-4 py-2 text-sm font-semibold text-white hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus"
            >
              Publish all {fmt(stats.review_needed)}
            </button>
            <button
              type="button"
              onClick={() => patchFilter({ status: "REVIEW_NEEDED", scheduled: "", failed: "" })}
              data-testid="banner-review-first"
              className="rounded-al-md border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-al-warning-fg hover:bg-al-warning-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus"
            >
              Review first
            </button>
          </div>
        </div>
      )}

      {showTriage && (
        <div className="mb-5" data-testid="content-kpis">
          <h2 className="sr-only">Content pipeline</h2>
          <div className="flex flex-wrap gap-2" data-testid="stat-strip" role="group" aria-label="Filter by pipeline state">
            {chips.map((c) => {
              const active =
                filters.status === c.filter.status &&
                filters.scheduled === c.filter.scheduled &&
                filters.failed === c.filter.failed;
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => patchFilter(c.filter)}
                  aria-pressed={active}
                  data-testid={`stat-card-${c.key}`}
                  className={`inline-flex items-baseline gap-2 rounded-al-md border px-3.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus ${
                    active
                      ? "border-al-primary bg-al-primary-subtle"
                      : "border-al-border bg-white hover:border-al-border-strong"
                  }`}
                >
                  <span className={`text-lg font-bold tabular-nums ${CHIP_TONE[c.tone]}`}>
                    {fmt(c.value)}
                  </span>
                  <span className="text-xs font-semibold text-slate-600">{c.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div
        className="mb-3 rounded-al-lg border border-al-border bg-white p-3 shadow-al-1"
        data-testid="toolbar"
      >
        <div className="flex flex-wrap items-center gap-2" data-testid="content-filters">
          <div className="relative min-w-[200px] flex-1">
            <Search
              size={15}
              aria-hidden
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <label htmlFor="content-search" className="sr-only">
              Search articles by title, slug, keyword or city
            </label>
            <input
              id="content-search"
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search title, slug, keyword or city…"
              data-testid="search-input"
              className="w-full rounded-al-md border border-al-border py-2 pl-9 pr-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-al-focus"
            />
          </div>

          {!scopeFilters?.status && (
            <Select
              label="Status"
              value={filters.status}
              onChange={(v) => patchFilter({ status: v, scheduled: "", failed: "" })}
              testid="filter-status"
              options={[
                { value: "", label: "All statuses" },
                { value: "REVIEW_NEEDED", label: "Review needed" },
                { value: "PUBLISHED", label: "Published" },
                { value: "DRAFT", label: "Draft" },
                { value: "ARCHIVED", label: "Archived" },
              ]}
            />
          )}
          <Select
            label="Cluster"
            value={filters.cluster}
            onChange={(v) => patchFilter({ cluster: v })}
            testid="filter-cluster"
            options={[
              { value: "", label: "All clusters" },
              ...clusters.map((c) => ({ value: c, label: clusterLabel(c) })),
            ]}
          />
          <Select
            label="Metro"
            value={filters.metro}
            onChange={(v) => patchFilter({ metro: v })}
            testid="filter-metro"
            options={[
              { value: "", label: "All metros" },
              ...metros.map((m) => ({ value: m, label: m })),
            ]}
          />
          <Select
            label="Quality"
            value={filters.quality}
            onChange={(v) => patchFilter({ quality: v })}
            testid="filter-quality"
            options={[...QUALITY_OPTIONS]}
          />
          <Select
            label="Sort"
            value={filters.sort}
            onChange={(v) => patchFilter({ sort: v })}
            testid="filter-sort"
            options={[{ value: "", label: "Newest" }, ...SORT_OPTIONS.filter((o) => o.value !== "newest")]}
          />
          {(filters.search ||
            filters.cluster ||
            filters.metro ||
            filters.quality ||
            (!scopeFilters?.status && (filters.status || filters.scheduled || filters.failed))) && (
            <button
              type="button"
              onClick={() => {
                setSearchInput("");
                setFilters({ ...EMPTY_FILTERS, ...scopeFilters });
              }}
              data-testid="content-filter-clear"
              className="rounded px-2 py-1 text-xs font-semibold text-al-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus"
            >
              Clear filters
            </button>
          )}
        </div>

        {/* Selection + bulk actions */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <span className="text-sm font-semibold text-slate-700" data-testid="selected-count">
            {fmt(count)} selected
          </span>
          {canSelectAll ? (
            <button
              type="button"
              onClick={() => setSelection(selectAllMatching(selection))}
              data-testid="select-all-matching"
              className="rounded text-xs font-semibold text-al-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus"
            >
              Select all matching ({fmt(total)})
            </button>
          ) : (
            <span className="text-xs text-slate-400">
              Clear the search to select all matching
            </span>
          )}
          {anySelected && (
            <button
              type="button"
              onClick={() => setSelection(clearSelection())}
              data-testid="clear-selection"
              className="rounded text-xs font-semibold text-slate-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus"
            >
              Clear selection
            </button>
          )}
          {selection.mode === "all-matching" && (
            <span className="rounded-full border border-amber-200 bg-al-warning-subtle px-2 py-0.5 text-xs text-al-warning-fg">
              {selection.excluded.size === 0
                ? `All ${fmt(total)} matching rows selected`
                : `All matching except ${fmt(selection.excluded.size)}`}
            </span>
          )}

          <div className="flex-1" />

          {anySelected && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busyCount}
                onClick={() => requestBulk("publish")}
                data-testid="bulk-publish"
                className="inline-flex items-center gap-1.5 rounded-al-md bg-al-success px-3.5 py-1.5 text-sm font-semibold text-white hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus disabled:opacity-50"
              >
                {busyCount ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <CheckCircle2 size={15} aria-hidden />}
                Publish ({fmt(count)})
              </button>
              <button
                type="button"
                disabled={busyCount}
                onClick={() => requestBulk("draft")}
                data-testid="bulk-draft"
                className="rounded-al-md border border-al-border bg-white px-3.5 py-1.5 text-sm font-semibold text-slate-600 hover:bg-al-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus disabled:opacity-50"
              >
                Move to draft
              </button>
              <button
                type="button"
                disabled={busyCount}
                onClick={() => requestBulk("reject")}
                data-testid="bulk-retire"
                className="rounded-al-md border border-red-300 bg-white px-3.5 py-1.5 text-sm font-semibold text-al-danger hover:bg-al-danger-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus disabled:opacity-50"
              >
                Archive ({fmt(count)})
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div
        className="rounded-al-lg border border-al-border bg-white shadow-al-1"
        data-testid="content-article-list"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="article-table">
            <caption className="sr-only">
              Generated articles matching the current filters. {fmt(total)} results.
            </caption>
            <thead>
              <tr className="border-b border-al-border text-left text-[11px] uppercase tracking-wide text-slate-400">
                <th scope="col" className="w-10 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={isPageFullySelected(selection, pageIds)}
                    onChange={() => setSelection(togglePage(selection, pageIds))}
                    data-testid="select-page"
                    aria-label="Select all rows on this page"
                    className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus"
                  />
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Title</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Cluster</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Location</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Words</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Quality</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Status</th>
                <th scope="col" className="px-3 py-2.5 text-center font-semibold">Flags</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Published</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} className="py-16 text-center text-slate-400" data-testid="table-loading">
                    <Loader2 size={20} className="inline animate-spin" aria-hidden />
                    <span className="sr-only">Loading articles…</span>
                  </td>
                </tr>
              ) : loadError ? (
                <tr>
                  <td colSpan={10} className="py-16 text-center" data-testid="table-error">
                    <p className="font-semibold text-al-danger">Couldn&rsquo;t load articles</p>
                    <p className="mt-1 text-sm text-slate-500">{loadError}</p>
                    <button
                      type="button"
                      onClick={() => void fetchArticles()}
                      data-testid="table-retry"
                      className="mt-3 rounded-al-md border border-al-border px-3 py-1.5 text-sm font-semibold text-al-primary hover:bg-al-primary-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus"
                    >
                      Try again
                    </button>
                  </td>
                </tr>
              ) : articles.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-16 text-center text-slate-500" data-testid="table-empty">
                    {noArticlesAtAll ? (
                      <div data-testid="content-list-empty-no-content">
                        <p className="font-semibold text-slate-700">No articles yet</p>
                        <p className="mt-1 text-sm">
                          The content engine hasn&rsquo;t generated anything for these keywords.
                          Start a generation batch to populate the pipeline.
                        </p>
                      </div>
                    ) : (
                      <div data-testid="content-list-empty">
                        <p className="font-semibold text-slate-700">No articles match these filters</p>
                        <p className="mt-1 text-sm">
                          {fmt(stats.total)} articles exist — try clearing a filter.
                        </p>
                      </div>
                    )}
                  </td>
                </tr>
              ) : (
                articles.map((a) => {
                  const selected = isRowSelected(selection, a.id);
                  const flags = parseQualityFlags(a.qualityFlags);
                  const meta = statusMeta(a.status);
                  return (
                    <tr
                      key={a.id}
                      data-testid={`article-row-${a.id}`}
                      className={`border-b border-slate-50 transition-colors hover:bg-al-bg ${
                        a.status === "REVIEW_NEEDED" ? "border-l-2 border-l-al-warning" : ""
                      } ${a.status === "ARCHIVED" ? "opacity-60" : ""} ${selected ? "bg-al-primary-subtle" : ""}`}
                    >
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => setSelection(toggleRow(selection, a.id))}
                          data-testid={`row-check-${a.id}`}
                          aria-label={`Select ${a.title}`}
                          className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus"
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <Link
                          href={`/admin/content/${a.id}`}
                          data-testid={`content-row-${a.id}`}
                          className="font-medium text-slate-800 hover:text-al-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus"
                        >
                          {a.title}
                        </Link>
                        <p className="font-mono text-xs text-slate-400">{a.slug}</p>
                      </td>
                      <td className="px-3 py-2.5 text-slate-600">{clusterLabel(a.cluster)}</td>
                      <td className="px-3 py-2.5 text-slate-600">
                        {a.city ? `${a.city}, ${a.state}` : (a.metro ?? "—")}
                        {a.city && a.metro ? <span className="text-slate-400"> · {a.metro}</span> : null}
                      </td>
                      <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${TONE_TEXT[wordCountTone(a.wordCount)]}`}>
                        {a.wordCount ? fmt(a.wordCount) : "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center gap-1.5">
                          <span className={`h-2 w-2 rounded-full ${TONE_DOT[qualityTone(a.qualityScore)]}`} aria-hidden />
                          <span className="tabular-nums text-slate-700">{a.qualityScore ?? "—"}/6</span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge status={a.status} label={meta.label} />
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {flags.length > 0 ? (
                          <>
                            <button
                              type="button"
                              onClick={() => setOpenFlags(openFlags === a.id ? null : a.id)}
                              aria-expanded={openFlags === a.id}
                              data-testid={`row-flags-${a.id}`}
                              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-al-warning hover:bg-al-warning-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus"
                            >
                              <AlertTriangle size={13} aria-hidden />
                              <span className="tabular-nums">{flags.length}</span>
                              <span className="sr-only">failed checks — show details</span>
                            </button>
                            {openFlags === a.id && (
                              <ul className="mt-1 text-left text-[11px] text-al-warning-fg">
                                {flags.map((f) => (
                                  <li key={f}>{f}</li>
                                ))}
                              </ul>
                            )}
                          </>
                        ) : (
                          <span className="text-slate-300" aria-label="No failed checks">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{fmtDate(a.publishedAt)}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setPreviewId(a.id)}
                            data-testid={`row-preview-${a.id}`}
                            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-al-primary hover:bg-al-primary-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus"
                          >
                            <Eye size={13} aria-hidden /> Preview
                            <span className="sr-only"> {a.title}</span>
                          </button>
                          {a.status !== "PUBLISHED" && (
                            <button
                              type="button"
                              disabled={rowBusy === a.id}
                              onClick={() => changeRowStatus(a.id, "PUBLISHED")}
                              data-testid={`row-publish-${a.id}`}
                              className="rounded px-2 py-1 text-xs font-semibold text-al-success hover:bg-al-success-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus disabled:opacity-50"
                            >
                              Publish<span className="sr-only"> {a.title}</span>
                            </button>
                          )}
                          {a.status !== "ARCHIVED" && (
                            <button
                              type="button"
                              disabled={rowBusy === a.id}
                              onClick={() => changeRowStatus(a.id, "ARCHIVED")}
                              data-testid={`row-retire-${a.id}`}
                              className="rounded px-2 py-1 text-xs font-semibold text-al-danger hover:bg-al-danger-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus disabled:opacity-50"
                            >
                              Archive<span className="sr-only"> {a.title}</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      <div className="mt-4 flex items-center justify-between" data-testid="content-pagination">
        <p className="text-sm text-slate-500" data-testid="pagination">
          {total === 0
            ? "No articles"
            : `Showing ${fmt((page - 1) * PAGE_SIZE + 1)}–${fmt(Math.min(page * PAGE_SIZE, total))} of ${fmt(total)}`}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            data-testid="page-prev"
            className="inline-flex items-center gap-1 rounded-al-md border border-al-border bg-white px-3 py-1.5 text-sm font-semibold hover:bg-al-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus disabled:opacity-40"
          >
            <ChevronLeft size={15} aria-hidden /> Previous
          </button>
          <button
            type="button"
            disabled={!hasMore || loading}
            onClick={() => setPage((p) => p + 1)}
            data-testid="page-next"
            className="inline-flex items-center gap-1 rounded-al-md border border-al-border bg-white px-3 py-1.5 text-sm font-semibold hover:bg-al-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus disabled:opacity-40"
          >
            Next <ChevronRight size={15} aria-hidden />
          </button>
        </div>
      </div>

      <ArticlePreviewDialog
        articleId={previewId}
        onClose={() => setPreviewId(null)}
        onStatusChange={changeRowStatus}
        busy={rowBusy !== null}
      />

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          if (!open) setPendingAction(null);
        }}
        title={
          pendingAction
            ? `${ACTION_COPY[pendingAction].verb} ${fmt(count)} article${count === 1 ? "" : "s"}?`
            : ""
        }
        description={
          <span>
            {selection.mode === "all-matching"
              ? "This applies to every article matching the current filters"
              : "This applies to the articles you selected"}
            {selection.mode === "all-matching" && selection.excluded.size > 0
              ? `, except the ${fmt(selection.excluded.size)} you un-ticked`
              : ""}
            . {pendingAction === "publish" ? "Published articles go live immediately." : null}
            {breakdown && Object.keys(breakdown).length > 0 && (
              <span className="mt-3 block" data-testid="confirm-breakdown">
                <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-400">
                  By cluster
                </span>
                <span className="flex flex-wrap gap-1.5">
                  {Object.entries(breakdown)
                    .sort((a, b) => b[1] - a[1])
                    .map(([k, n]) => (
                      <span key={k} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                        {clusterLabel(k)} ({fmt(n)})
                      </span>
                    ))}
                </span>
              </span>
            )}
          </span>
        }
        confirmLabel={pendingAction ? ACTION_COPY[pendingAction].verb : "Confirm"}
        variant={pendingAction ? ACTION_COPY[pendingAction].variant : "primary"}
        onConfirm={runBulk}
        data-testid="confirm"
      />

      {/* Toast — a live region, so the result of a bulk write is announced. */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {toast?.msg}
      </div>
      {toast && (
        <div
          data-testid="toast"
          aria-hidden
          className={`fixed bottom-6 right-6 z-[60] flex items-center gap-2 rounded-al-lg px-4 py-3 text-sm font-semibold text-white shadow-al-3 ${
            toast.type === "success" ? "bg-al-success" : "bg-al-danger"
          }`}
        >
          {toast.type === "success" ? (
            <CheckCircle2 size={16} aria-hidden />
          ) : (
            <XCircle size={16} aria-hidden />
          )}
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ── Small local pieces ───────────────────────────────────────────────────────

function Select({
  label,
  value,
  onChange,
  options,
  testid,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly { value: string; label: string }[];
  testid: string;
}) {
  return (
    <>
      <label htmlFor={testid} className="sr-only">
        {label}
      </label>
      <select
        id={testid}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testid}
        className="rounded-al-md border border-al-border bg-white px-2.5 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-al-focus"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </>
  );
}

/** Status pill. One vocabulary, from cluster-meta — never a local restatement. */
function Badge({ status, label }: { status: string; label: string }) {
  const cls =
    status === "PUBLISHED"
      ? "bg-al-success-subtle text-al-success-fg"
      : status === "REVIEW_NEEDED"
        ? "bg-al-warning-subtle text-al-warning-fg"
        : status === "ARCHIVED"
          ? "bg-slate-100 text-slate-600"
          : "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
      {label}
    </span>
  );
}
