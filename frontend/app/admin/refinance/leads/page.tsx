"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { RefreshCw, Download, ExternalLink } from "lucide-react";

type LeadRow = {
  id: string;
  leadId: string;
  firstName: string;
  lastName: string;
  email: string;
  state: string;
  vehicleYear: number;
  loanBalanceCents: number;
  status: "SUBMITTED" | "QUALIFIED" | "INELIGIBLE" | "REDIRECTED" | "EXCLUDED_STATE";
  createdAt: string;
  redirectedAt: string | null;
};

type LeadsResponse = {
  success: boolean;
  data?: { items: LeadRow[]; total: number; page: number; totalPages: number; pageSize: number };
  error?: { code: string; message: string };
};

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "QUALIFIED", label: "Qualified" },
  { value: "INELIGIBLE", label: "Ineligible" },
  { value: "REDIRECTED", label: "Redirected" },
  { value: "EXCLUDED_STATE", label: "Excluded State" },
  { value: "SUBMITTED", label: "Submitted" },
];

const STATUS_BADGE: Record<string, string> = {
  SUBMITTED: "bg-[#E5E7EB] text-[#4B5563] border-[#DBEAFE]",
  QUALIFIED: "bg-[#50D14E]/15 text-[#1A6B18] border-[#50D14E]/30",
  INELIGIBLE: "bg-amber-50 text-amber-900 border-amber-200",
  REDIRECTED: "bg-[#53C8E7]/15 text-[#0A6A8A] border-[#53C8E7]/40",
  EXCLUDED_STATE: "bg-red-50 text-red-800 border-red-200",
};

function formatUsd(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function AdminRefinanceLeadsPage() {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<LeadsResponse["data"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    params.set("page", String(page));
    try {
      const res = await fetch(`/api/admin/refinance/leads?${params.toString()}`);
      const json: LeadsResponse = await res.json();
      if (!res.ok || !json.success || !json.data) {
        setError(json.error?.message ?? "Unable to load leads");
      } else {
        setData(json.data);
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [status, page]);

  useEffect(() => { load(); }, [load]);

  function handleExport() {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    params.set("format", "csv");
    window.location.href = `/api/admin/refinance/leads?${params.toString()}`;
  }

  return (
    <div className="p-6 md:p-10" data-testid="admin-refinance-leads-page">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#111827] tracking-tight">Refinance Leads</h1>
          <p className="text-sm text-[#4B5563] mt-1 max-w-lg">
            Read-only tracking of refinance leads referred to OpenRoad Lending. AutoLenis does not make credit decisions — there is no approve/reject action on this page.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            data-testid="leads-refresh-btn"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#4B5563] bg-white border border-[#E5E7EB] rounded-md hover:border-[#93C5FD] transition-colors disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          <button
            onClick={handleExport}
            data-testid="leads-export-csv-btn"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-al-primary rounded-md hover:bg-al-primary-hover transition-colors"
          >
            <Download size={13} /> Export CSV
          </button>
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap gap-1.5 mb-5" data-testid="leads-status-filter">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value || "all"}
            data-testid={`leads-filter-${f.value || "all"}`}
            onClick={() => { setPage(1); setStatus(f.value); }}
            className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors ${
              status === f.value
                ? "bg-al-primary text-white border-al-primary"
                : "bg-white text-[#4B5563] border-[#E5E7EB] hover:border-[#93C5FD]"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <p
          data-testid="leads-error"
          className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2 mb-4"
        >
          {error}
        </p>
      )}

      <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm" data-testid="leads-table">
            <thead className="bg-[#F8F9FB] border-b border-[#E5E7EB]">
              <tr className="text-left">
                <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-[#4B5563]">Name</th>
                <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-[#4B5563]">Email</th>
                <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-[#4B5563]">State</th>
                <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-[#4B5563]">Year</th>
                <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-[#4B5563]">Balance</th>
                <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-[#4B5563]">Status</th>
                <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-[#4B5563]">Submitted</th>
                <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-[#4B5563]">Redirected</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {loading && !data && (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-[#94A3B8]">Loading…</td></tr>
              )}
              {data && data.items.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-sm text-[#94A3B8]" data-testid="leads-empty">
                    No leads match this filter.
                  </td>
                </tr>
              )}
              {data?.items.map((row) => (
                <tr key={row.id} className="border-b border-al-primary-subtle last:border-0 hover:bg-[#FAF7FE] transition-colors" data-testid={`lead-row-${row.leadId}`}>
                  <td className="px-4 py-3 text-[#111827] font-medium">{row.firstName} {row.lastName}</td>
                  <td className="px-4 py-3 text-[#4B5563]">{row.email}</td>
                  <td className="px-4 py-3 text-[#4B5563]">{row.state}</td>
                  <td className="px-4 py-3 text-[#4B5563]">{row.vehicleYear}</td>
                  <td className="px-4 py-3 text-[#4B5563] font-[family-name:var(--font-mono)]">{formatUsd(row.loanBalanceCents)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${STATUS_BADGE[row.status] ?? ""}`}>
                      {row.status.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[#4B5563] text-xs">{formatDate(row.createdAt)}</td>
                  <td className="px-4 py-3 text-[#4B5563] text-xs">{formatDate(row.redirectedAt)}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/refinance/leads/${row.leadId}`}
                      data-testid={`lead-view-${row.leadId}`}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-al-primary hover:text-al-primary-hover"
                    >
                      View <ExternalLink size={11} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[#E5E7EB] bg-[#FAF7FE]" data-testid="leads-pagination">
            <p className="text-xs text-[#4B5563]">
              Page {data.page} of {data.totalPages} &middot; {data.total} total
            </p>
            <div className="flex gap-2">
              <button
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1.5 text-xs font-semibold bg-white border border-[#E5E7EB] rounded-md disabled:opacity-50"
              >
                Previous
              </button>
              <button
                disabled={page >= data.totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1.5 text-xs font-semibold bg-white border border-[#E5E7EB] rounded-md disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
