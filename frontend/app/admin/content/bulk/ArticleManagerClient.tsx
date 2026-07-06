"use client";

// Bulk Article Management — client worktable.
//
// Dense ops UI: a clickable stat strip, a filter/sort toolbar, a multi-select
// article table, a slide-in preview drawer, and a confirmation modal for bulk
// publish/retire. "Select All Matching" selects every row matching the current
// filters across all pages (not just the visible page) by sending the filter to
// the bulk API instead of an id list.
//
// Vocabulary note: the platform's terminal status is ARCHIVED; this tool labels
// that state "Retired" per the ops spec. Both refer to the same DB value.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  X,
  Search,
  Loader2,
  Eye,
  ExternalLink,
  FileText,
  Trash2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────
interface Article {
  id: string;
  slug: string;
  title: string;
  cluster: string;
  metro: string | null;
  make: string | null;
  model: string | null;
  status: string;
  wordCount: number | null;
  qualityScore: number | null;
  qualityFlags: string | null;
  publishedAt: string | null;
  createdAt: string;
  searchGrounded: boolean | null;
}

interface Stats {
  total: number;
  published: number;
  review_needed: number;
  draft: number;
  retired: number;
}

interface FullArticle extends Article {
  body: string;
  faqJson: string | null;
  metaDescription: string;
  h1: string;
}

type BulkAction = "publish" | "reject";
type ToastType = "success" | "error";

const PAGE_SIZE = 50;

const CLUSTER_BADGE: Record<string, string> = {
  dealer_quotes: "bg-blue-100 text-blue-700",
  otd_price: "bg-emerald-100 text-emerald-700",
  dealer_fees: "bg-amber-100 text-amber-700",
  trade_in: "bg-purple-100 text-purple-700",
  leasing: "bg-indigo-100 text-indigo-700",
};

const CLUSTER_LABELS: Record<string, string> = {
  dealer_quotes: "Dealer Quotes",
  otd_price: "OTD Price",
  dealer_fees: "Dealer Fees",
  trade_in: "Trade-In",
  leasing: "Leasing",
};

const STATUS_DISPLAY: Record<string, { label: string; cls: string }> = {
  PUBLISHED: { label: "Published", cls: "bg-green-100 text-green-700" },
  REVIEW_NEEDED: { label: "Review", cls: "bg-amber-100 text-amber-700" },
  DRAFT: { label: "Draft", cls: "bg-slate-100 text-slate-600" },
  ARCHIVED: { label: "Retired", cls: "bg-red-100 text-red-700" },
};

const QUALITY_OPTIONS = [
  { value: "", label: "All Quality" },
  { value: "6", label: "Score 6" },
  { value: "5", label: "Score 5" },
  { value: "le4", label: "Score 4 and below" },
];

const SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "quality_asc", label: "Quality ↑" },
  { value: "quality_desc", label: "Quality ↓" },
  { value: "word_count_desc", label: "Word Count ↓" },
];

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function clusterLabel(c: string): string {
  return CLUSTER_LABELS[c] ?? c;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function wordColor(wc: number | null): string {
  if (wc === null) return "text-slate-400";
  if (wc < 700) return "text-red-600";
  if (wc < 800) return "text-amber-600";
  return "text-green-600";
}

function qualityDot(score: number | null): string {
  if (score === null) return "bg-slate-300";
  if (score >= 6) return "bg-green-500";
  if (score === 5) return "bg-amber-500";
  return "bg-red-500";
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function parseFlags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data.filter((f): f is string => typeof f === "string");
  } catch {
    /* ignore */
  }
  return [];
}

function parseFaqs(raw: string | null): { question: string; answer: string }[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    if (Array.isArray(data)) {
      return data.filter(
        (f): f is { question: string; answer: string } =>
          f && typeof f.question === "string" && typeof f.answer === "string",
      );
    }
  } catch {
    /* ignore */
  }
  return [];
}

interface FilterState {
  status: string;
  cluster: string;
  metro: string;
  quality: string;
  search: string;
  sort: string;
}

const EMPTY_STATS: Stats = { total: 0, published: 0, review_needed: 0, draft: 0, retired: 0 };

export default function ArticleManagerClient({
  clusters,
  metros,
}: {
  clusters: string[];
  metros: string[];
}) {
  const [filters, setFilters] = useState<FilterState>({
    status: "",
    cluster: "",
    metro: "",
    quality: "",
    search: "",
    sort: "newest",
  });
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);

  const [articles, setArticles] = useState<Article[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [matchingAll, setMatchingAll] = useState(false);

  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [drawerArticle, setDrawerArticle] = useState<FullArticle | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);

  const [confirmAction, setConfirmAction] = useState<BulkAction | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmBreakdown, setConfirmBreakdown] = useState<{
    clusters: Record<string, number>;
    metros: Record<string, number>;
  } | null>(null);

  const [toast, setToast] = useState<{ msg: string; type: ToastType } | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  // Remembers cluster/metro for every row ever loaded so the confirmation modal
  // can build an id-mode breakdown even for selections that span pages.
  const rowMetaRef = useRef<Map<string, { cluster: string; metro: string }>>(new Map());
  const tableRef = useRef<HTMLDivElement>(null);

  const showToast = useCallback((msg: string, type: ToastType = "success") => {
    setToast({ msg, type });
    window.setTimeout(() => setToast(null), 3500);
  }, []);

  // Debounce the search input into the active filter.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setFilters((f) => (f.search === searchInput ? f : { ...f, search: searchInput }));
      setPage(1);
    }, 350);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const quality = useMemo(() => {
    switch (filters.quality) {
      case "6":
        return { min: 6, max: 6 };
      case "5":
        return { min: 5, max: 5 };
      case "le4":
        return { min: undefined, max: 4 };
      default:
        return { min: undefined, max: undefined };
    }
  }, [filters.quality]);

  const buildParams = useCallback(
    (extra?: Record<string, string>) => {
      const p = new URLSearchParams();
      if (filters.status) p.set("status", filters.status);
      if (filters.cluster) p.set("cluster", filters.cluster);
      if (filters.metro) p.set("metro", filters.metro);
      if (filters.search) p.set("search", filters.search);
      if (filters.sort) p.set("sort", filters.sort);
      if (quality.min !== undefined) p.set("quality_score_min", String(quality.min));
      if (quality.max !== undefined) p.set("quality_score_max", String(quality.max));
      for (const [k, v] of Object.entries(extra ?? {})) p.set(k, v);
      return p;
    },
    [filters, quality],
  );

  // The filter object sent to the bulk API for "select all matching".
  const filterObject = useMemo(() => {
    const obj: Record<string, string | number> = {};
    if (filters.status) obj.status = filters.status;
    if (filters.cluster) obj.cluster = filters.cluster;
    if (filters.metro) obj.metro = filters.metro;
    if (quality.min !== undefined) obj.quality_score_min = quality.min;
    if (quality.max !== undefined) obj.quality_score_max = quality.max;
    return obj;
  }, [filters, quality]);

  const fetchArticles = useCallback(async () => {
    setLoading(true);
    try {
      const params = buildParams({ page: String(page), limit: String(PAGE_SIZE) });
      const res = await fetch(`/api/admin/content/articles?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed to load articles");
      const data = json.data as { articles: Article[]; total: number; hasMore: boolean; stats: Stats };
      setArticles(data.articles);
      setTotal(data.total);
      setHasMore(data.hasMore);
      setStats(data.stats);
      for (const a of data.articles) {
        rowMetaRef.current.set(a.id, { cluster: a.cluster, metro: a.metro ?? "Unassigned" });
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to load articles", "error");
    } finally {
      setLoading(false);
    }
  }, [buildParams, page, showToast]);

  useEffect(() => {
    void fetchArticles();
  }, [fetchArticles]);

  // Changing any filter invalidates the current selection.
  const patchFilter = useCallback((patch: Partial<FilterState>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
    setSelectedIds(new Set());
    setMatchingAll(false);
  }, []);

  const selectedCount = matchingAll ? total : selectedIds.size;

  const toggleRow = useCallback((id: string) => {
    setMatchingAll(false);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allOnPageSelected = articles.length > 0 && articles.every((a) => selectedIds.has(a.id));

  const togglePage = useCallback(() => {
    setMatchingAll(false);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const everySelected = articles.every((a) => next.has(a.id));
      for (const a of articles) {
        if (everySelected) next.delete(a.id);
        else next.add(a.id);
      }
      return next;
    });
  }, [articles]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setMatchingAll(false);
  }, []);

  // ── Drawer ─────────────────────────────────────────────────────────────────
  const openDrawer = useCallback(
    async (id: string) => {
      setDrawerId(id);
      setDrawerArticle(null);
      setDrawerError(null);
      setDrawerLoading(true);
      try {
        const res = await fetch(`/api/admin/content/${id}`);

        // Guard the response before parsing. A failed route can return an empty
        // body or an HTML error page; calling res.json() on either throws the
        // opaque "Unexpected end of JSON input". Read the raw text instead and
        // surface a legible status + message.
        const contentType = res.headers.get("content-type") ?? "";
        const isJson = contentType.includes("application/json");

        if (!res.ok || !isJson) {
          const raw = (await res.text()).trim();
          let message = `Preview failed (HTTP ${res.status})`;
          if (isJson && raw) {
            try {
              const parsed = JSON.parse(raw);
              message = parsed?.error?.message ?? message;
            } catch {
              /* fall through to the status-only message */
            }
          } else if (raw) {
            message = `${message}: ${raw.slice(0, 200)}`;
          }
          throw new Error(message);
        }

        const json = await res.json();
        const article = json?.data?.article as FullArticle | undefined;
        if (!article) throw new Error("Preview response was missing article data");
        setDrawerArticle(article);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Failed to load article";
        // Keep the drawer open and show the error in place so the failure is
        // legible, rather than silently dismissing it behind a transient toast.
        setDrawerError(message);
        showToast(message, "error");
      } finally {
        setDrawerLoading(false);
      }
    },
    [showToast],
  );

  const closeDrawer = useCallback(() => {
    setDrawerId(null);
    setDrawerArticle(null);
    setDrawerError(null);
  }, []);

  // ── Single-article status change ─────────────────────────────────────────────
  const patchArticle = useCallback(
    async (id: string, status: "PUBLISHED" | "RETIRED", fromDrawer = false) => {
      setRowBusy(id);
      try {
        const res = await fetch(`/api/admin/content/articles/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error?.message ?? "Update failed");
        showToast(status === "PUBLISHED" ? "Article published." : "Article retired.");
        if (fromDrawer) closeDrawer();
        await fetchArticles();
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Update failed", "error");
      } finally {
        setRowBusy(null);
      }
    },
    [showToast, closeDrawer, fetchArticles],
  );

  // ── Bulk confirm ─────────────────────────────────────────────────────────────
  const openConfirm = useCallback(
    async (action: BulkAction) => {
      setConfirmAction(action);
      setConfirmBreakdown(null);
      if (matchingAll) {
        // Pull a server-side breakdown for the full matching set.
        try {
          const params = buildParams({ breakdown: "1", limit: "1", page: "1" });
          const res = await fetch(`/api/admin/content/articles?${params.toString()}`);
          const json = await res.json();
          if (res.ok && json.data.breakdown) setConfirmBreakdown(json.data.breakdown);
        } catch {
          /* breakdown is best-effort */
        }
      } else {
        // Build the breakdown locally from remembered row metadata.
        const clustersAcc: Record<string, number> = {};
        const metrosAcc: Record<string, number> = {};
        for (const id of selectedIds) {
          const meta = rowMetaRef.current.get(id);
          if (!meta) continue;
          clustersAcc[meta.cluster] = (clustersAcc[meta.cluster] ?? 0) + 1;
          metrosAcc[meta.metro] = (metrosAcc[meta.metro] ?? 0) + 1;
        }
        setConfirmBreakdown({ clusters: clustersAcc, metros: metrosAcc });
      }
    },
    [matchingAll, buildParams, selectedIds],
  );

  const runBulk = useCallback(async () => {
    if (!confirmAction) return;
    setConfirmBusy(true);
    try {
      const payload: Record<string, unknown> = { action: confirmAction };
      if (matchingAll) payload.filter = filterObject;
      else payload.ids = [...selectedIds];
      const res = await fetch(`/api/admin/content/articles/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Bulk action failed");
      const verb = confirmAction === "publish" ? "Published" : "Retired";
      showToast(`${verb} ${fmt(json.data.updated)} article${json.data.updated === 1 ? "" : "s"}.`);
      setConfirmAction(null);
      clearSelection();
      await fetchArticles();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Bulk action failed", "error");
    } finally {
      setConfirmBusy(false);
    }
  }, [confirmAction, matchingAll, filterObject, selectedIds, showToast, clearSelection, fetchArticles]);

  // Banner action — publish every REVIEW_NEEDED article.
  const publishAllReview = useCallback(() => {
    setFilters({ status: "REVIEW_NEEDED", cluster: "", metro: "", quality: "", search: "", sort: "newest" });
    setSearchInput("");
    setPage(1);
    setSelectedIds(new Set());
    setMatchingAll(true);
    setConfirmAction("publish");
    setConfirmBreakdown(null);
    // Breakdown fetch keyed on the filter we just set.
    const params = new URLSearchParams({ status: "REVIEW_NEEDED", breakdown: "1", limit: "1", page: "1" });
    fetch(`/api/admin/content/articles?${params.toString()}`)
      .then((r) => r.json())
      .then((j) => {
        if (j?.data?.breakdown) setConfirmBreakdown(j.data.breakdown);
      })
      .catch(() => {});
  }, []);

  const reviewFirst = useCallback(() => {
    patchFilter({ status: "REVIEW_NEEDED" });
    window.setTimeout(() => tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }, [patchFilter]);

  // ESC closes the topmost overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (confirmAction) setConfirmAction(null);
      else if (drawerId) closeDrawer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmAction, drawerId, closeDrawer]);

  const showFrom = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const showTo = Math.min(page * PAGE_SIZE, total);

  // ── Render ───────────────────────────────────────────────────────────────────
  const statCards = [
    { key: "", label: "Total Articles", value: stats.total, tone: "text-al-primary", ring: "" },
    { key: "PUBLISHED", label: "Published", value: stats.published, tone: "text-green-600", ring: "" },
    { key: "REVIEW_NEEDED", label: "Review Needed", value: stats.review_needed, tone: "text-amber-600", ring: "" },
    { key: "DRAFT", label: "Draft", value: stats.draft, tone: "text-slate-600", ring: "" },
    { key: "ARCHIVED", label: "Retired", value: stats.retired, tone: "text-red-600", ring: "" },
  ];

  return (
    <div className="min-h-screen bg-[#F4F6FA] p-6 md:p-8" data-testid="bulk-article-page">
      <div className="flex items-center gap-3 mb-1">
        <FileText size={22} className="text-al-primary" />
        <h1 className="text-xl font-bold text-slate-900">Bulk Article Management</h1>
      </div>
      <p className="text-sm text-slate-500 mb-6">
        Select, filter, preview, and bulk publish or retire generated articles.
        <Link href="/admin/content" className="text-al-primary hover:underline ml-1">
          Content Engine overview →
        </Link>
      </p>

      {/* Quick publish banner */}
      {stats.review_needed > 0 && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 mb-6"
          data-testid="review-banner"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-900">
                {fmt(stats.review_needed)} article{stats.review_needed === 1 ? "" : "s"} need review
              </p>
              <p className="text-xs text-amber-700">All are compliance-clean. Publish all at once?</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={publishAllReview}
              data-testid="banner-publish-all"
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-4 py-2 rounded-lg"
            >
              Publish All {fmt(stats.review_needed)}
            </button>
            <button
              type="button"
              onClick={reviewFirst}
              data-testid="banner-review-first"
              className="bg-white border border-amber-300 text-amber-800 text-sm font-semibold px-4 py-2 rounded-lg hover:bg-amber-100"
            >
              Review First
            </button>
          </div>
        </div>
      )}

      {/* Stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6" data-testid="stat-strip">
        {statCards.map((c) => {
          const active = filters.status === c.key;
          return (
            <button
              type="button"
              key={c.label}
              onClick={() => patchFilter({ status: c.key })}
              data-testid={`stat-card-${c.key || "all"}`}
              className={`bg-white border rounded-2xl shadow-sm px-4 py-3 text-left transition-all ${
                active ? "border-al-primary ring-1 ring-al-primary" : "border-[#E2E8F0] hover:border-[#CBD5E1]"
              }`}
            >
              <p className={`text-2xl font-bold ${c.tone}`}>{fmt(c.value)}</p>
              <p className="text-xs font-semibold text-slate-600 mt-0.5">{c.label}</p>
            </button>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm p-3 mb-4" data-testid="toolbar">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search article titles..."
              data-testid="search-input"
              className="w-full pl-9 pr-3 py-2 text-sm border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-1 focus:ring-al-primary"
            />
          </div>
          <Select
            value={filters.status}
            onChange={(v) => patchFilter({ status: v })}
            testid="filter-status"
            options={[
              { value: "", label: "All Statuses" },
              { value: "PUBLISHED", label: "Published" },
              { value: "REVIEW_NEEDED", label: "Review Needed" },
              { value: "DRAFT", label: "Draft" },
              { value: "ARCHIVED", label: "Retired" },
            ]}
          />
          <Select
            value={filters.cluster}
            onChange={(v) => patchFilter({ cluster: v })}
            testid="filter-cluster"
            options={[{ value: "", label: "All Clusters" }, ...clusters.map((c) => ({ value: c, label: clusterLabel(c) }))]}
          />
          <Select
            value={filters.metro}
            onChange={(v) => patchFilter({ metro: v })}
            testid="filter-metro"
            options={[{ value: "", label: "All Metros" }, ...metros.map((m) => ({ value: m, label: m }))]}
          />
          <Select
            value={filters.quality}
            onChange={(v) => patchFilter({ quality: v })}
            testid="filter-quality"
            options={QUALITY_OPTIONS}
          />
          <Select
            value={filters.sort}
            onChange={(v) => patchFilter({ sort: v })}
            testid="filter-sort"
            options={SORT_OPTIONS}
          />
        </div>

        {/* Selection row */}
        <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-[#F1F5F9]">
          <span className="text-sm font-semibold text-slate-700" data-testid="selected-count">
            {fmt(selectedCount)} selected
          </span>
          <button
            type="button"
            onClick={() => setMatchingAll(true)}
            data-testid="select-all-matching"
            className="text-xs font-semibold text-al-primary hover:underline"
          >
            Select All Matching ({fmt(total)})
          </button>
          {selectedCount > 0 && (
            <button
              type="button"
              onClick={clearSelection}
              data-testid="clear-selection"
              className="text-xs font-semibold text-slate-500 hover:underline"
            >
              Clear Selection
            </button>
          )}
          {matchingAll && (
            <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
              All {fmt(total)} matching rows selected
            </span>
          )}
          <div className="flex-1" />
          {selectedCount > 0 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => openConfirm("publish")}
                data-testid="bulk-publish"
                className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-3.5 py-1.5 rounded-lg"
              >
                <CheckCircle2 size={15} /> Publish All ({fmt(selectedCount)})
              </button>
              <button
                type="button"
                onClick={() => openConfirm("reject")}
                data-testid="bulk-retire"
                className="inline-flex items-center gap-1.5 bg-white border border-red-300 text-red-600 hover:bg-red-50 text-sm font-semibold px-3.5 py-1.5 rounded-lg"
              >
                <Trash2 size={15} /> Retire All ({fmt(selectedCount)})
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div
        ref={tableRef}
        className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm overflow-hidden"
        data-testid="article-table"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E2E8F0] text-left text-[11px] uppercase tracking-wide text-slate-400">
                <th className="px-3 py-2.5 w-10">
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    onChange={togglePage}
                    data-testid="select-page"
                    aria-label="Select page"
                  />
                </th>
                <th className="px-3 py-2.5 font-semibold">Title</th>
                <th className="px-3 py-2.5 font-semibold">Cluster</th>
                <th className="px-3 py-2.5 font-semibold">Metro</th>
                <th className="px-3 py-2.5 font-semibold text-right">Words</th>
                <th className="px-3 py-2.5 font-semibold">Quality</th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
                <th className="px-3 py-2.5 font-semibold text-center">Flags</th>
                <th className="px-3 py-2.5 font-semibold">Published</th>
                <th className="px-3 py-2.5 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} className="text-center py-16 text-slate-400" data-testid="table-loading">
                    <Loader2 size={20} className="animate-spin inline" />
                  </td>
                </tr>
              ) : articles.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-16 text-slate-400" data-testid="table-empty">
                    No articles match these filters.
                  </td>
                </tr>
              ) : (
                articles.map((a) => {
                  const selected = matchingAll || selectedIds.has(a.id);
                  const flags = parseFlags(a.qualityFlags);
                  const sd = STATUS_DISPLAY[a.status] ?? { label: a.status, cls: "bg-slate-100 text-slate-600" };
                  return (
                    <tr
                      key={a.id}
                      data-testid={`article-row-${a.id}`}
                      className={`border-b border-slate-50 hover:bg-[#F8FAFC] transition-colors ${
                        a.status === "REVIEW_NEEDED" ? "border-l-2 border-l-amber-400" : ""
                      } ${a.status === "ARCHIVED" ? "opacity-50" : ""} ${selected ? "bg-blue-50" : ""}`}
                    >
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleRow(a.id)}
                          data-testid={`row-check-${a.id}`}
                          aria-label={`Select ${a.title}`}
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <p className="font-medium text-slate-800">{truncate(a.title, 60)}</p>
                        <p className="text-xs text-slate-400 font-mono">{a.slug}</p>
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            CLUSTER_BADGE[a.cluster] ?? "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {clusterLabel(a.cluster)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-slate-600">{a.metro ?? "—"}</td>
                      <td className={`px-3 py-2.5 text-right font-semibold ${wordColor(a.wordCount)}`}>
                        {a.wordCount ? fmt(a.wordCount) : "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full ${qualityDot(a.qualityScore)}`} />
                          <span className="text-slate-700">{a.qualityScore ?? "—"}/6</span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${sd.cls}`}>
                          {sd.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {flags.length > 0 ? (
                          <span
                            title={flags.join("\n")}
                            data-testid={`row-flags-${a.id}`}
                            className="inline-flex items-center gap-1 text-amber-600 cursor-help"
                          >
                            <AlertTriangle size={13} />
                            {flags.length}
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{fmtDate(a.publishedAt)}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openDrawer(a.id)}
                            data-testid={`row-preview-${a.id}`}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-al-primary hover:bg-blue-50 px-2 py-1 rounded"
                          >
                            <Eye size={13} /> Preview
                          </button>
                          {a.status !== "PUBLISHED" && (
                            <button
                              type="button"
                              disabled={rowBusy === a.id}
                              onClick={() => patchArticle(a.id, "PUBLISHED")}
                              data-testid={`row-publish-${a.id}`}
                              className="text-xs font-semibold text-emerald-700 hover:bg-emerald-50 px-2 py-1 rounded disabled:opacity-50"
                            >
                              Publish
                            </button>
                          )}
                          {a.status !== "ARCHIVED" && (
                            <button
                              type="button"
                              disabled={rowBusy === a.id}
                              onClick={() => patchArticle(a.id, "RETIRED")}
                              data-testid={`row-retire-${a.id}`}
                              className="text-xs font-semibold text-red-600 hover:bg-red-50 px-2 py-1 rounded disabled:opacity-50"
                            >
                              Retire
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
      <div className="flex items-center justify-between mt-4" data-testid="pagination">
        <p className="text-sm text-slate-500">
          {total === 0 ? "No articles" : `Showing ${fmt(showFrom)}–${fmt(showTo)} of ${fmt(total)} articles`}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            data-testid="page-prev"
            className="inline-flex items-center gap-1 text-sm font-semibold px-3 py-1.5 rounded-lg border border-[#E2E8F0] bg-white disabled:opacity-40 hover:bg-[#F8FAFC]"
          >
            <ChevronLeft size={15} /> Previous
          </button>
          <button
            type="button"
            disabled={!hasMore || loading}
            onClick={() => setPage((p) => p + 1)}
            data-testid="page-next"
            className="inline-flex items-center gap-1 text-sm font-semibold px-3 py-1.5 rounded-lg border border-[#E2E8F0] bg-white disabled:opacity-40 hover:bg-[#F8FAFC]"
          >
            Next <ChevronRight size={15} />
          </button>
        </div>
      </div>

      {/* Preview drawer */}
      {drawerId && (
        <>
          <div
            className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-[1px]"
            onClick={closeDrawer}
            data-testid="drawer-backdrop"
          />
          <aside
            className="fixed top-0 right-0 z-50 h-screen w-full max-w-[600px] bg-white shadow-xl flex flex-col"
            data-testid="preview-drawer"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2E8F0]">
              <p className="text-sm font-bold text-slate-700">Article Preview</p>
              <button
                type="button"
                onClick={closeDrawer}
                data-testid="drawer-close-x"
                className="p-1.5 rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {drawerLoading ? (
                <div className="text-center py-20 text-slate-400">
                  <Loader2 size={22} className="animate-spin inline" />
                </div>
              ) : drawerError ? (
                <div
                  data-testid="drawer-error"
                  className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-5 text-sm text-red-700"
                >
                  <p className="flex items-center gap-2 font-semibold">
                    <AlertTriangle size={15} /> Couldn’t load this preview
                  </p>
                  <p className="mt-2 text-red-600 break-words">{drawerError}</p>
                  <button
                    type="button"
                    onClick={() => drawerId && openDrawer(drawerId)}
                    data-testid="drawer-retry"
                    className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-red-700 hover:bg-red-100 px-2.5 py-1.5 rounded"
                  >
                    Retry
                  </button>
                </div>
              ) : drawerArticle ? (
                <DrawerBody article={drawerArticle} />
              ) : null}
            </div>
            {drawerArticle && (
              <div className="flex items-center gap-2 px-6 py-4 border-t border-[#E2E8F0]">
                {drawerArticle.status !== "PUBLISHED" && (
                  <button
                    type="button"
                    disabled={rowBusy === drawerArticle.id}
                    onClick={() => patchArticle(drawerArticle.id, "PUBLISHED", true)}
                    data-testid="drawer-publish"
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
                  >
                    Publish This Article
                  </button>
                )}
                {drawerArticle.status !== "ARCHIVED" && (
                  <button
                    type="button"
                    disabled={rowBusy === drawerArticle.id}
                    onClick={() => patchArticle(drawerArticle.id, "RETIRED", true)}
                    data-testid="drawer-retire"
                    className="flex-1 bg-white border border-red-300 text-red-600 hover:bg-red-50 text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
                  >
                    Retire This Article
                  </button>
                )}
                <button
                  type="button"
                  onClick={closeDrawer}
                  data-testid="drawer-close"
                  className="px-4 py-2 text-sm font-semibold text-slate-600 border border-[#E2E8F0] rounded-lg hover:bg-[#F8FAFC]"
                >
                  Close
                </button>
              </div>
            )}
          </aside>
        </>
      )}

      {/* Bulk confirmation modal */}
      {confirmAction && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
          onClick={() => !confirmBusy && setConfirmAction(null)}
          data-testid="confirm-backdrop"
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6"
            onClick={(e) => e.stopPropagation()}
            data-testid="confirm-modal"
          >
            <h2 className="text-lg font-bold text-slate-900 mb-1">
              {confirmAction === "publish" ? "Publish" : "Retire"} {fmt(selectedCount)} article
              {selectedCount === 1 ? "" : "s"}?
            </h2>
            <p className="text-sm text-slate-500 mb-4">
              This will {confirmAction === "publish" ? "publish" : "retire"} all {fmt(selectedCount)}{" "}
              {matchingAll ? "articles matching your current filters" : "selected articles"}. This action cannot be
              undone.
            </p>
            {confirmBreakdown && (
              <div className="space-y-3 mb-5 max-h-56 overflow-y-auto" data-testid="confirm-breakdown">
                <BreakdownBlock title="By Cluster" data={confirmBreakdown.clusters} labeller={clusterLabel} />
                <BreakdownBlock title="By Metro" data={confirmBreakdown.metros} labeller={(k) => k} />
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={confirmBusy}
                onClick={() => setConfirmAction(null)}
                data-testid="confirm-cancel"
                className="px-4 py-2 text-sm font-semibold text-slate-600 border border-[#E2E8F0] rounded-lg hover:bg-[#F8FAFC] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={confirmBusy}
                onClick={runBulk}
                data-testid="confirm-run"
                className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50 ${
                  confirmAction === "publish" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"
                }`}
              >
                {confirmBusy && <Loader2 size={15} className="animate-spin" />}
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-[60] flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-semibold text-white ${
            toast.type === "success" ? "bg-emerald-600" : "bg-red-600"
          }`}
          data-testid="toast"
        >
          {toast.type === "success" ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────────────
function Select({
  value,
  onChange,
  options,
  testid,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  testid: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      data-testid={testid}
      className="text-sm border border-[#E2E8F0] rounded-lg px-2.5 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-al-primary"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function BreakdownBlock({
  title,
  data,
  labeller,
}: {
  title: string;
  data: Record<string, number>;
  labeller: (k: string) => string;
}) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-1.5">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {entries.map(([k, n]) => (
          <span key={k} className="text-xs bg-slate-100 text-slate-700 rounded-full px-2 py-0.5">
            {labeller(k)} ({fmt(n)})
          </span>
        ))}
      </div>
    </div>
  );
}

function DrawerBody({ article }: { article: FullArticle }) {
  const flags = parseFlags(article.qualityFlags);
  const faqs = parseFaqs(article.faqJson);
  const sd = STATUS_DISPLAY[article.status] ?? { label: article.status, cls: "bg-slate-100 text-slate-600" };
  return (
    <div data-testid="drawer-body">
      <div className="flex items-center gap-2 mb-2">
        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${sd.cls}`}>{sd.label}</span>
        {article.status === "PUBLISHED" && (
          <Link
            href={`/buying-guide/${article.slug}`}
            target="_blank"
            className="inline-flex items-center gap-1 text-xs text-al-primary hover:underline"
          >
            View live <ExternalLink size={11} />
          </Link>
        )}
      </div>
      <h1 className="text-xl font-bold text-slate-900 mb-1.5">{article.title}</h1>
      <p className="text-sm text-slate-500 mb-3">{article.metaDescription}</p>
      <div className="flex items-center gap-3 text-xs text-slate-500 mb-4">
        <span className="inline-flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${qualityDot(article.qualityScore)}`} />
          Quality {article.qualityScore ?? "—"}/6
        </span>
        <span className={wordColor(article.wordCount)}>
          {article.wordCount ? `${fmt(article.wordCount)} words` : "Word count unknown"}
        </span>
      </div>
      {flags.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5" data-testid="drawer-flags">
          {flags.map((f) => (
            <span key={f} className="inline-flex items-center gap-1 text-[11px] font-semibold bg-amber-100 text-amber-700 rounded-full px-2 py-0.5">
              <AlertTriangle size={11} /> {f}
            </span>
          ))}
        </div>
      )}
      <div
        className="content-article-preview text-sm text-slate-700 leading-relaxed [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-slate-900 [&_h2]:mt-5 [&_h2]:mb-2 [&_h3]:font-semibold [&_h3]:text-slate-800 [&_h3]:mt-4 [&_p]:mb-3 [&_a]:text-al-primary [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-3 [&_li]:mb-1"
        dangerouslySetInnerHTML={{ __html: article.body }}
      />
      {faqs.length > 0 && (
        <div className="mt-6 pt-5 border-t border-[#E2E8F0]" data-testid="drawer-faqs">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-3">FAQ ({faqs.length})</p>
          <div className="space-y-3">
            {faqs.map((f, i) => (
              <div key={i}>
                <p className="text-sm font-semibold text-slate-800">{f.question}</p>
                <p className="text-sm text-slate-600 mt-0.5">{f.answer}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
