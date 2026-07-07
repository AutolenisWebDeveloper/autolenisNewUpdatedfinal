"use client";

// Phase C3 — Content article filter bar.
// Drives the /admin/content list via URL search params so the server component
// can read the filters and re-query. Keeps state in the URL (shareable,
// back-button friendly) rather than local React state.

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Search } from "lucide-react";
import { CLUSTER_LABELS } from "@/lib/content/cluster-meta";

interface Props {
  clusters: string[];
  metros: string[];
  statuses: string[];
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  REVIEW_NEEDED: "Review Needed",
  PUBLISHED: "Published",
  ARCHIVED: "Archived",
};

export default function ContentFilters({ clusters, metros, statuses }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");

  function pushWith(updates: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    // Any filter change resets pagination.
    next.delete("page");
    router.push(`/admin/content?${next.toString()}`);
  }

  const selectClass =
    "rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-al-primary/20";

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="content-filters">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          pushWith({ q });
        }}
        className="relative"
      >
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search title, slug, keyword…"
          data-testid="content-search"
          className="w-60 rounded-lg border border-[#E2E8F0] bg-white pl-8 pr-3 py-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-al-primary/20"
        />
      </form>

      <select
        value={params.get("cluster") ?? ""}
        onChange={(e) => pushWith({ cluster: e.target.value })}
        data-testid="content-filter-cluster"
        className={selectClass}
      >
        <option value="">All clusters</option>
        {clusters.map((c) => (
          <option key={c} value={c}>
            {CLUSTER_LABELS[c] ?? c}
          </option>
        ))}
      </select>

      <select
        value={params.get("status") ?? ""}
        onChange={(e) => pushWith({ status: e.target.value })}
        data-testid="content-filter-status"
        className={selectClass}
      >
        <option value="">All statuses</option>
        {statuses.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABELS[s] ?? s}
          </option>
        ))}
      </select>

      <select
        value={params.get("metro") ?? ""}
        onChange={(e) => pushWith({ metro: e.target.value })}
        data-testid="content-filter-metro"
        className={selectClass}
      >
        <option value="">All metros</option>
        {metros.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>

      {(params.get("q") || params.get("cluster") || params.get("status") || params.get("metro")) && (
        <button
          type="button"
          onClick={() => {
            setQ("");
            router.push("/admin/content");
          }}
          data-testid="content-filter-clear"
          className="text-xs text-al-primary hover:underline px-2"
        >
          Clear
        </button>
      )}
    </div>
  );
}
