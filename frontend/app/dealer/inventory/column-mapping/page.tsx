"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const DETECTED_COLUMNS = ["VehicleID", "yr", "Mk", "Mdl", "Miles", "ListPrice"];

const STANDARD_FIELDS = [
  "VIN",
  "Year",
  "Make",
  "Model",
  "Trim",
  "Mileage",
  "Price",
  "Skip",
] as const;

type StandardField = (typeof STANDARD_FIELDS)[number];

const DEFAULT_MAPPING: Record<string, StandardField> = {
  VehicleID: "VIN",
  yr: "Year",
  Mk: "Make",
  Mdl: "Model",
  Miles: "Mileage",
  ListPrice: "Price",
};

export default function ColumnMappingPage() {
  const router = useRouter();
  const [mapping, setMapping] = useState<Record<string, StandardField>>(DEFAULT_MAPPING);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateMapping(col: string, field: StandardField) {
    setMapping((prev) => ({ ...prev, [col]: field }));
  }

  async function handleSave() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dealer/inventory/column-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mapping }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: { message?: string } };
        setError(data.error?.message ?? "Failed to save mapping");
        return;
      }
      router.push("/dealer/inventory/bulk-upload");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="column-mapping-page">
      <div className="flex items-center gap-3 mb-2">
        <Link
          href="/dealer/inventory/bulk-upload"
          className="text-sm text-slate-400 hover:text-[#0B5FD1] transition-colors"
        >
          ← Back
        </Link>
        <h1 className="text-xl font-bold text-slate-900">Column Mapping</h1>
      </div>
      <p className="text-sm text-slate-500 mb-6">
        Your CSV has non-standard column names. Map each detected column to the corresponding
        AutoLenis field so we can import your data correctly.
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-5 text-sm">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-6">
        <div className="grid grid-cols-2 px-5 py-3 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-400 uppercase tracking-wide">
          <span>Detected Column</span>
          <span>Map to Field</span>
        </div>
        {DETECTED_COLUMNS.map((col, i) => (
          <div
            key={col}
            className={`grid grid-cols-2 items-center px-5 py-3 ${
              i < DETECTED_COLUMNS.length - 1 ? "border-b border-slate-100" : ""
            }`}
            data-testid={`mapping-row-${col}`}
          >
            <span className="text-sm font-medium text-slate-800 font-mono">{col}</span>
            <select
              value={mapping[col] ?? "Skip"}
              onChange={(e) => updateMapping(col, e.target.value as StandardField)}
              className="border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/30"
              data-testid={`mapping-select-${col}`}
            >
              {STANDARD_FIELDS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <button
        onClick={handleSave}
        disabled={loading}
        className="w-full bg-[#0B5FD1] hover:bg-[#1A6FE0] disabled:opacity-50 text-white font-semibold py-3 rounded-lg transition-colors text-sm"
        data-testid="save-mapping-btn"
      >
        {loading ? "Saving..." : "Save Mapping"}
      </button>
    </div>
  );
}
