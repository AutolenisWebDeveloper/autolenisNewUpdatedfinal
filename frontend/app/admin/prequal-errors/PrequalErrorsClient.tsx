"use client";

import { useMemo, useState } from "react";

export interface PrequalErrorRow {
  id: string;
  buyerId: string;
  buyerName: string;
  buyerEmail: string;
  prequalApplicationId: string | null;
  errorStage: string;
  errorCode: string;
  errorMessage: string | null;
  httpStatus: number | null;
  attemptedAt: string;
}

export default function PrequalErrorsClient({
  initialRows,
}: {
  initialRows: PrequalErrorRow[];
}) {
  const [rows, setRows] = useState<PrequalErrorRow[]>(initialRows);
  const [stageFilter, setStageFilter] = useState<string>("ALL");
  const [codeFilter, setCodeFilter] = useState<string>("ALL");
  const [resolving, setResolving] = useState<string | null>(null);

  const stages = useMemo(
    () => Array.from(new Set(initialRows.map((r) => r.errorStage))).sort(),
    [initialRows],
  );
  const codes = useMemo(
    () => Array.from(new Set(initialRows.map((r) => r.errorCode))).sort(),
    [initialRows],
  );

  const visible = rows.filter(
    (r) =>
      (stageFilter === "ALL" || r.errorStage === stageFilter) &&
      (codeFilter === "ALL" || r.errorCode === codeFilter),
  );

  async function resolve(row: PrequalErrorRow) {
    setResolving(row.id);
    try {
      const res = await fetch(
        `/api/admin/buyers/${row.buyerId}/prequal/errors/${row.id}/resolve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      if (res.ok) {
        setRows((prev) => prev.filter((r) => r.id !== row.id));
      } else {
        alert("Failed to resolve. Check your permissions and try again.");
      }
    } finally {
      setResolving(null);
    }
  }

  return (
    <div data-testid="prequal-errors-client">
      <div className="flex flex-wrap gap-3 mb-4">
        <select
          aria-label="Filter by stage"
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm"
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
        >
          <option value="ALL">All stages</option>
          {stages.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          aria-label="Filter by code"
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm"
          value={codeFilter}
          onChange={(e) => setCodeFilter(e.target.value)}
        >
          <option value="ALL">All codes</option>
          {codes.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <span className="text-sm text-slate-500 self-center">
          {visible.length} unresolved
        </span>
      </div>

      {visible.length === 0 ? (
        <div
          className="bg-white border border-dashed border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-500"
          data-testid="prequal-errors-empty"
        >
          No unresolved provider errors. 🎉
        </div>
      ) : (
        <div className="overflow-x-auto bg-white border border-slate-200 rounded-2xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-100">
                <th className="px-4 py-3 font-medium">Attempted</th>
                <th className="px-4 py-3 font-medium">Buyer</th>
                <th className="px-4 py-3 font-medium">Stage</th>
                <th className="px-4 py-3 font-medium">Code</th>
                <th className="px-4 py-3 font-medium">Detail</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 align-top">
                  <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                    {new Date(r.attemptedAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <a
                      href={`/admin/buyers/${r.buyerId}`}
                      className="text-[#0B5FD1] hover:underline font-medium"
                    >
                      {r.buyerName || r.buyerEmail}
                    </a>
                    <div className="text-xs text-slate-400">{r.buyerEmail}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-block rounded-full bg-amber-50 text-amber-700 px-2 py-0.5 text-xs font-medium">
                      {r.errorStage}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-block rounded-full bg-red-50 text-red-700 px-2 py-0.5 text-xs font-medium">
                      {r.errorCode}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600 max-w-md">
                    {r.errorMessage ?? "—"}
                    {r.httpStatus ? (
                      <span className="text-slate-400"> (HTTP {r.httpStatus})</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => resolve(r)}
                      disabled={resolving === r.id}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {resolving === r.id ? "Resolving…" : "Mark resolved"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
