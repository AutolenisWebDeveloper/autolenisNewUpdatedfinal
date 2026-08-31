// Filter state for the Content worktable — pure, so the list query, the bulk
// payload and the URL all derive from one place instead of drifting apart.
//
// Every predicate here reaches BOTH the list query and the bulk mutation. That
// includes `search`: the bulk endpoint accepts it and resolves it through the
// same lib/content/article-filter builder the list uses, so "select all
// matching" during a search targets exactly the rows on screen. An earlier
// revision withheld select-all while searching to avoid drift — that capped a
// real capability to work around a gap that was fixable, and it is fixed.

export interface ContentFilterState {
  status: string;
  cluster: string;
  metro: string;
  quality: string;
  search: string;
  sort: string;
  /** Lens: articles with a future/pending scheduled publish. "1" or "". */
  scheduled: string;
  /** Lens: articles whose last publish attempt was blocked. "1" or "". */
  failed: string;
}

export const EMPTY_FILTERS: ContentFilterState = {
  status: "",
  cluster: "",
  metro: "",
  quality: "",
  search: "",
  sort: "",
  scheduled: "",
  failed: "",
};

export const QUALITY_OPTIONS = [
  { value: "", label: "All quality" },
  { value: "6", label: "Score 6" },
  { value: "5", label: "Score 5" },
  { value: "le4", label: "Score 4 and below" },
] as const;

export const SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "quality_asc", label: "Quality — low first" },
  { value: "quality_desc", label: "Quality — high first" },
  { value: "word_count_desc", label: "Word count — high first" },
  { value: "title_asc", label: "Title A–Z" },
] as const;

const SORT_VALUES = new Set(SORT_OPTIONS.map((o) => o.value as string));
const QUALITY_VALUES = new Set(QUALITY_OPTIONS.map((o) => o.value as string));

export function qualityRange(band: string): { min?: number; max?: number } {
  switch (band) {
    case "6":
      return { min: 6, max: 6 };
    case "5":
      return { min: 5, max: 5 };
    case "le4":
      return { min: undefined, max: 4 };
    default:
      return { min: undefined, max: undefined };
  }
}

/**
 * A stable key for "which rows does this filter match".
 *
 * Sort is excluded on purpose — it reorders the same set. Anything included
 * here invalidates a cached `total`, which is what stops a confirmation dialog
 * from quoting a count that belongs to a filter the operator already left.
 */
export function filterSignature(f: ContentFilterState): string {
  return JSON.stringify([f.status, f.cluster, f.metro, f.quality, f.search, f.scheduled, f.failed]);
}

/** Params for GET /api/admin/content/articles. */
export function toQueryParams(
  f: ContentFilterState,
  extra: Record<string, string> = {},
): URLSearchParams {
  const p = new URLSearchParams();
  if (f.status) p.set("status", f.status);
  if (f.cluster) p.set("cluster", f.cluster);
  if (f.metro) p.set("metro", f.metro);
  if (f.search) p.set("search", f.search);
  if (f.sort) p.set("sort", f.sort);
  if (f.scheduled) p.set("scheduled", f.scheduled);
  if (f.failed) p.set("failed", f.failed);

  const { min, max } = qualityRange(f.quality);
  if (min !== undefined) p.set("quality_score_min", String(min));
  if (max !== undefined) p.set("quality_score_max", String(max));

  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return p;
}

/**
 * The `filter` object for POST /api/admin/content/articles/bulk.
 *
 * Must stay in step with toQueryParams for every predicate the server supports,
 * or "select all matching" targets more rows than the list showed.
 */
export function toBulkFilter(f: ContentFilterState): Record<string, string | number> {
  const obj: Record<string, string | number> = {};
  if (f.status) obj.status = f.status;
  if (f.cluster) obj.cluster = f.cluster;
  if (f.metro) obj.metro = f.metro;
  if (f.scheduled) obj.scheduled = f.scheduled;
  if (f.failed) obj.failed = f.failed;
  if (f.search.trim()) obj.search = f.search.trim();

  const { min, max } = qualityRange(f.quality);
  if (min !== undefined) obj.quality_score_min = min;
  if (max !== undefined) obj.quality_score_max = max;

  return obj;
}

/** Filters as URL search params, for a shareable, Back-button-safe address. */
export function toSearchParams(f: ContentFilterState): URLSearchParams {
  const p = new URLSearchParams();
  if (f.status) p.set("status", f.status);
  if (f.cluster) p.set("cluster", f.cluster);
  if (f.metro) p.set("metro", f.metro);
  if (f.quality) p.set("quality", f.quality);
  if (f.search) p.set("q", f.search);
  if (f.sort) p.set("sort", f.sort);
  if (f.scheduled) p.set("scheduled", f.scheduled);
  if (f.failed) p.set("failed", f.failed);
  return p;
}

export function fromSearchParams(p: URLSearchParams): ContentFilterState {
  const sort = p.get("sort") ?? "";
  const quality = p.get("quality") ?? "";
  return {
    status: p.get("status") ?? "",
    cluster: p.get("cluster") ?? "",
    metro: p.get("metro") ?? "",
    quality: QUALITY_VALUES.has(quality) ? quality : "",
    search: p.get("q") ?? "",
    sort: SORT_VALUES.has(sort) ? sort : "",
    scheduled: p.get("scheduled") === "1" ? "1" : "",
    failed: p.get("failed") === "1" ? "1" : "",
  };
}
