"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";

export interface PrequalListRow {
  id: string;
  buyerId: string;
  buyerName: string;
  buyerEmail: string;
  decision: string;
  tier: string | null;
  maxOtdAmountCents: number;
  expiresAt: string;
  expired: boolean;
  isExternal: boolean;
  createdAt: string;
}

const DECISION_FILTERS: { value: string; label: string }[] = [
  { value: "ALL", label: "All decisions" },
  { value: "APPROVED", label: "Approved" },
  { value: "DECLINED", label: "Declined" },
  { value: "PENDING", label: "Pending" },
  { value: "MANUAL_REVIEW", label: "Manual review" },
  { value: "OFAC_REVIEW", label: "OFAC review" },
  { value: "OFAC_ESCALATED", label: "OFAC escalated" },
];

function decisionBadge(decision: string, expired: boolean) {
  const base = "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border";
  const map: Record<string, string> = {
    APPROVED: "bg-emerald-50 text-emerald-700 border-emerald-200",
    DECLINED: "bg-red-50 text-red-700 border-red-200",
    PENDING: "bg-slate-50 text-slate-600 border-slate-200",
    MANUAL_REVIEW: "bg-amber-50 text-amber-700 border-amber-200",
    OFAC_REVIEW: "bg-red-50 text-red-700 border-red-200",
    OFAC_ESCALATED: "bg-red-50 text-red-700 border-red-200",
  };
  const cls = map[decision] ?? "bg-slate-50 text-slate-700 border-slate-200";
  return (
    <span className="flex items-center gap-1.5">
      <span className={`${base} ${cls}`}>{decision.replace(/_/g, " ")}</span>
      {expired && (
        <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-slate-50 text-slate-500 border-slate-200">
          EXPIRED
        </span>
      )}
    </span>
  );
}

function fmtCents(cents: number) {
  return `$${(cents / 100).toLocaleString()}`;
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function PrequalListClient({ initialRows }: { initialRows: PrequalListRow[] }) {
  const [decision, setDecision] = useState("ALL");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return initialRows.filter((r) => {
      if (decision !== "ALL" && r.decision !== decision) return false;
      if (q && !r.buyerName.toLowerCase().includes(q) && !r.buyerEmail.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [initialRows, decision, query]);

  return (
    <>
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            data-testid="prequal-list-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by buyer name or email…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-al-primary focus:ring-1 focus:ring-al-primary"
          />
        </div>
        <select
          data-testid="prequal-list-decision-filter"
          value={decision}
          onChange={(e) => setDecision(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-al-primary"
        >
          {DECISION_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="hidden md:grid grid-cols-[1.6fr_1.4fr_1fr_0.7fr_1fr_1fr_0.8fr_0.5fr] gap-3 px-5 py-3 bg-slate-50 border-b border-slate-100">
          {["Buyer", "Email", "Decision", "Tier", "Max OTD", "Expires", "Source", ""].map((h) => (
            <span key={h} className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
              {h}
            </span>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-slate-400" data-testid="prequal-list-empty">
            No prequalifications match the current filters.
          </div>
        ) : (
          filtered.map((r) => (
            <div
              key={r.id}
              className="grid md:grid-cols-[1.6fr_1.4fr_1fr_0.7fr_1fr_1fr_0.8fr_0.5fr] gap-3 px-5 py-4 items-center border-b border-slate-50 last:border-0 hover:bg-slate-50/60 transition-colors"
              data-testid={`prequal-list-row-${r.id}`}
            >
              <div>
                <p className="text-sm font-semibold text-slate-800 truncate">{r.buyerName || "—"}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Submitted {fmtDate(r.createdAt)}</p>
              </div>
              <span className="text-xs text-slate-500 truncate">{r.buyerEmail}</span>
              {decisionBadge(r.decision, r.expired)}
              <span className="text-xs text-slate-500">{r.tier ?? "—"}</span>
              <span className="text-xs font-medium text-slate-700">{fmtCents(r.maxOtdAmountCents)}</span>
              <span className={`text-xs ${r.expired ? "text-slate-400" : "text-slate-500"}`}>
                {fmtDate(r.expiresAt)}
              </span>
              <span className="text-[11px] text-slate-500">
                {r.isExternal ? (
                  <span className="inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-semibold border bg-amber-50 text-amber-700 border-amber-200">EXTERNAL</span>
                ) : (
                  <span className="inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-semibold border bg-blue-50 text-blue-700 border-blue-200">INTERNAL</span>
                )}
              </span>
              <Link
                href={`/admin/prequal/${r.id}`}
                className="inline-flex items-center gap-1 text-xs font-semibold text-al-primary hover:underline justify-self-end"
                data-testid={`prequal-list-open-${r.id}`}
              >
                View
                <ArrowRight size={11} />
              </Link>
            </div>
          ))
        )}
      </div>

      <p className="text-[11px] text-slate-400 mt-3">
        Showing {filtered.length} of {initialRows.length} records (most recent first, capped at 500).
      </p>
    </>
  );
}
