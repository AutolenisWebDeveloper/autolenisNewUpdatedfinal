"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Upload } from "lucide-react";

type UploadState = "idle" | "file-selected" | "parsing" | "preview" | "uploading" | "committed" | "error";

interface CsvRow {
  vin: string;
  year: string;
  make: string;
  model: string;
  price: string;
}

// Raw-row preview rendered when CSV headers don't match the standard set.
// In this case the dealer's saved column mapping (set on
// /dealer/inventory/column-mapping → cookie) is applied server-side.
interface RawCsvData {
  headers: string[];
  rows: Array<Record<string, string>>;
}

function convertToPriceCents(priceStr: string): number {
  const cleaned = priceStr.replace(/[^0-9.]/g, "");
  const num = parseFloat(cleaned);
  if (isNaN(num) || num <= 0) return 0;
  // If value has a decimal point, treat as dollars; otherwise check if it looks like cents already
  if (priceStr.includes(".")) return Math.round(num * 100);
  return num < 10000 ? Math.round(num * 100) : Math.round(num);
}

function parseCsvLine(line: string): string[] {
  return line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
}

function parseCsv(text: string): CsvRow[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/^"|"$/g, ""));
  const vinIdx   = headers.indexOf("vin");
  const yearIdx  = headers.indexOf("year");
  const makeIdx  = headers.indexOf("make");
  const modelIdx = headers.indexOf("model");
  const priceIdx = headers.findIndex((h) => h === "price" || h === "pricecents" || h === "price_cents");

  if (vinIdx === -1 || yearIdx === -1 || makeIdx === -1 || modelIdx === -1 || priceIdx === -1) {
    throw new Error("CSV must have columns: vin, year, make, model, price (or pricecents/price_cents)");
  }

  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    return {
      vin:   cols[vinIdx]   ?? "",
      year:  cols[yearIdx]  ?? "",
      make:  cols[makeIdx]  ?? "",
      model: cols[modelIdx] ?? "",
      price: cols[priceIdx] ?? "",
    };
  }).filter((r) => r.vin.length >= 11);
}

// Parse CSV without assuming any specific headers. Used when the file has
// non-standard headers (the column-mapping page has already saved a mapping).
function parseCsvRaw(text: string): RawCsvData {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = cols[i] ?? ""; });
    return obj;
  });
  return { headers, rows };
}

export default function BulkUploadPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [rawData, setRawData] = useState<RawCsvData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsMapping, setNeedsMapping] = useState(false);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setCsvRows([]);
    setRawData(null);
    setNeedsMapping(false);
    setState(f ? "file-selected" : "idle");
    setError(null);
  }

  async function handleUpload() {
    if (!file) return;
    setState("parsing");
    setError(null);
    try {
      const text = await file.text();
      try {
        const rows = parseCsv(text);
        if (rows.length === 0) {
          setError("No valid rows found. Check that the CSV has vin, year, make, model, price columns.");
          setState("error");
          return;
        }
        setCsvRows(rows);
        setRawData(null);
        setState("preview");
      } catch {
        // Non-standard headers — fall back to raw-rows mode (server applies saved mapping)
        const raw = parseCsvRaw(text);
        if (raw.rows.length === 0) {
          setError("No rows detected in CSV.");
          setState("error");
          return;
        }
        setRawData(raw);
        setCsvRows([]);
        setState("preview");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse CSV.");
      setState("error");
    }
  }

  async function handleCommit() {
    setState("uploading");
    setError(null);
    try {
      let body: string;
      if (rawData) {
        body = JSON.stringify({ rawRows: rawData.rows });
      } else if (csvRows.length > 0) {
        const rows = csvRows.map((r) => ({
          vin: r.vin,
          year: parseInt(r.year, 10),
          make: r.make,
          model: r.model,
          priceCents: convertToPriceCents(r.price),
        })).filter((r) => !isNaN(r.year) && r.priceCents > 0);
        body = JSON.stringify({ rows });
      } else {
        return;
      }

      const res = await fetch("/api/dealer/inventory/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: { code?: string; message?: string } };
        if (data.error?.code === "MAPPING_REQUIRED") {
          setNeedsMapping(true);
          setError("This CSV has non-standard headers. Please save a column mapping first.");
        } else {
          setError(data.error?.message ?? "Upload failed");
        }
        setState("error");
        return;
      }
      setState("committed");
      router.push("/dealer/inventory");
    } catch {
      setError("Network error. Please try again.");
      setState("error");
    }
  }

  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="bulk-upload-page">
      <h1 className="text-xl font-bold text-slate-900 mb-1">Bulk Upload Inventory</h1>
      <p className="text-sm text-slate-500 mb-6">
        Upload a CSV file to import multiple vehicles at once.
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-5 text-sm" data-testid="bulk-upload-error">
          {error}
          {needsMapping && (
            <div className="mt-2">
              <Link
                href="/dealer/inventory/column-mapping"
                className="inline-block bg-al-primary hover:bg-[#1A6FE0] text-white font-semibold px-3 py-1.5 rounded-md text-xs"
                data-testid="goto-column-mapping-link"
              >
                Configure Column Mapping →
              </Link>
            </div>
          )}
        </div>
      )}

      {/* Drop Zone */}
      <div
        onClick={() => fileRef.current?.click()}
        className="border-2 border-dashed border-slate-200 rounded-xl p-10 text-center cursor-pointer hover:border-al-primary/40 transition-colors mb-5"
        data-testid="csv-drop-zone"
      >
        <Upload size={28} className="text-slate-300 mx-auto mb-3" />
        {file ? (
          <p className="text-sm font-medium text-slate-700">{file.name}</p>
        ) : (
          <>
            <p className="text-sm text-slate-500 mb-1">Click to select a CSV file</p>
            <p className="text-xs text-slate-400">Standard headers (vin, year, make, model, price) are auto-detected. Other formats use your saved column mapping.</p>
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          onChange={handleFileChange}
          className="hidden"
          data-testid="csv-file-input"
        />
      </div>

      {/* Upload Button */}
      {(state === "file-selected" || state === "parsing") && (
        <button
          onClick={handleUpload}
          disabled={state === "parsing"}
          className="w-full bg-al-primary hover:bg-[#1A6FE0] disabled:opacity-50 text-white font-semibold py-3 rounded-lg transition-colors text-sm mb-4"
          data-testid="upload-csv-btn"
        >
          {state === "parsing" ? "Parsing CSV..." : "Upload & Preview"}
        </button>
      )}

      {/* Standard Preview Table */}
      {(state === "preview" || state === "uploading" || state === "committed") && csvRows.length > 0 && (
        <div className="mb-5" data-testid="preview-table">
          <p className="text-sm font-semibold text-slate-700 mb-3">
            Preview — {csvRows.length} row{csvRows.length !== 1 ? "s" : ""} detected
          </p>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="grid grid-cols-5 px-4 py-2 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-400 uppercase tracking-wide">
              <span>VIN</span>
              <span>Year</span>
              <span>Make</span>
              <span>Model</span>
              <span>Price</span>
            </div>
            {csvRows.map((row, i) => (
              <div
                key={i}
                className={`grid grid-cols-5 px-4 py-3 text-sm ${i < csvRows.length - 1 ? "border-b border-slate-100" : ""}`}
              >
                <span className="text-slate-500 text-xs truncate">{row.vin}</span>
                <span className="text-slate-800">{row.year}</span>
                <span className="text-slate-800">{row.make}</span>
                <span className="text-slate-800">{row.model}</span>
                <span className="text-slate-800">${parseInt(row.price).toLocaleString()}</span>
              </div>
            ))}
          </div>

          <button
            onClick={handleCommit}
            disabled={state === "uploading"}
            className="w-full mt-4 bg-al-primary hover:bg-[#1A6FE0] disabled:opacity-50 text-white font-semibold py-3 rounded-lg transition-colors text-sm"
            data-testid="commit-import-btn"
          >
            {state === "uploading" ? "Importing..." : "Commit Import"}
          </button>
        </div>
      )}

      {/* Raw Preview Table — shown when headers are non-standard */}
      {(state === "preview" || state === "uploading" || state === "committed") && rawData && rawData.rows.length > 0 && (
        <div className="mb-5" data-testid="preview-raw-table">
          <p className="text-sm font-semibold text-slate-700 mb-1">
            Preview — {rawData.rows.length} row{rawData.rows.length !== 1 ? "s" : ""} (non-standard headers)
          </p>
          <p className="text-xs text-slate-500 mb-3">
            Your saved column mapping will be applied during import.{" "}
            <Link href="/dealer/inventory/column-mapping" className="text-al-primary underline">
              Edit mapping
            </Link>
          </p>
          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {rawData.headers.map((h) => (
                    <th key={h} className="text-xs font-semibold text-slate-400 uppercase tracking-wide text-left px-3 py-2 font-mono">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rawData.rows.slice(0, 25).map((row, i) => (
                  <tr key={i} className="border-b border-slate-100 last:border-0">
                    {rawData.headers.map((h) => (
                      <td key={h} className="px-3 py-2 text-slate-700 truncate max-w-[140px]">{row[h]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {rawData.rows.length > 25 && (
              <p className="text-xs text-slate-400 text-center py-2">…and {rawData.rows.length - 25} more rows</p>
            )}
          </div>

          <button
            onClick={handleCommit}
            disabled={state === "uploading"}
            className="w-full mt-4 bg-al-primary hover:bg-[#1A6FE0] disabled:opacity-50 text-white font-semibold py-3 rounded-lg transition-colors text-sm"
            data-testid="commit-import-btn"
          >
            {state === "uploading" ? "Importing..." : "Apply Mapping & Import"}
          </button>
        </div>
      )}
    </div>
  );
}
