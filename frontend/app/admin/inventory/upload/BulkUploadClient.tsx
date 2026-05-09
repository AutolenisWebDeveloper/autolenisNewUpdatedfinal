"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Upload, Loader2, FileText, CheckCircle2, AlertCircle, History } from "lucide-react";

const REQUIRED = ["make", "model", "year", "priceCents"] as const;
const RECOGNIZED = [
  "make","model","year","trim","vin","priceCents","mileage",
  "condition","bodyType","exteriorColor","interiorColor","engine",
  "transmission","drivetrain","fuelType","city","state","zip","description","lane",
] as const;

type Row = Record<string, string>;
interface ValidationIssue { field: string; message: string }

interface ParsedFile {
  filename: string;
  headers: string[];
  rows: Row[];
}

function parseCSV(text: string): { headers: string[]; rows: Row[] } {
  // Simple CSV parser supporting quoted fields and escaped quotes
  const lines: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') { field += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { field += ch; }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { cur.push(field); field = ""; }
      else if (ch === "\n") { cur.push(field); lines.push(cur); cur = []; field = ""; }
      else if (ch === "\r") { /* skip */ }
      else { field += ch; }
    }
  }
  if (field.length > 0 || cur.length > 0) { cur.push(field); lines.push(cur); }
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = lines[0].map(h => h.trim());
  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.length === 1 && line[0] === "") continue;
    const obj: Row = {};
    headers.forEach((h, idx) => { obj[h] = (line[idx] ?? "").trim(); });
    rows.push(obj);
  }
  return { headers, rows };
}

function validateRow(row: Row, mapping: Record<string, string>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const v = (k: string) => row[mapping[k]] ?? "";

  for (const f of REQUIRED) {
    if (!v(f)) issues.push({ field: f, message: `${f} is required` });
  }
  if (v("year")) {
    const y = Number(v("year"));
    if (isNaN(y) || y < 2010 || y > 2026) issues.push({ field: "year", message: "Year must be 2010–2026" });
  }
  if (v("priceCents")) {
    const p = Number(v("priceCents"));
    if (isNaN(p) || p <= 0) issues.push({ field: "priceCents", message: "priceCents must be positive integer" });
  }
  if (v("mileage")) {
    const m = Number(v("mileage"));
    if (isNaN(m) || m < 0) issues.push({ field: "mileage", message: "mileage invalid" });
  }
  if (v("vin") && !/^[A-HJ-NPR-Z0-9]{17}$/i.test(v("vin"))) {
    issues.push({ field: "vin", message: "VIN must be 17 alphanumeric characters" });
  }
  if (v("lane") && !["LANE_1","LANE_2","LANE_3"].includes(v("lane"))) {
    issues.push({ field: "lane", message: "lane must be LANE_1/LANE_2/LANE_3" });
  }
  return issues;
}

interface UploadResult {
  batchId: string;
  totalRows: number;
  successCount: number;
  failureCount: number;
  results: { row: number; status: "success" | "error"; id?: string; error?: string }[];
}

export default function BulkUploadClient() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [validating, setValidating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);

  function autoMap(headers: string[]) {
    const next: Record<string, string> = {};
    for (const target of RECOGNIZED) {
      const exact = headers.find(h => h.toLowerCase() === target.toLowerCase());
      if (exact) { next[target] = exact; continue; }
      // common aliases
      const aliases: Record<string, string[]> = {
        priceCents: ["price", "asking_price", "askingprice", "list_price", "listprice"],
        bodyType: ["body_type", "body"],
        exteriorColor: ["exterior_color", "ext_color", "color"],
        interiorColor: ["interior_color", "int_color"],
        fuelType: ["fuel_type", "fuel"],
      };
      const al = aliases[target] ?? [];
      const aliasMatch = headers.find(h => al.includes(h.toLowerCase()));
      if (aliasMatch) next[target] = aliasMatch;
    }
    setMapping(next);
  }

  async function downloadTemplate() {
    setDownloadingTemplate(true);
    try {
      const res = await fetch("/api/admin/inventory/template");
      if (!res.ok) { setError("Failed to download template"); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "autolenis-inventory-template.csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingTemplate(false);
    }
  }

  async function handleFile(file: File) {
    setError(null);
    setResult(null);
    setValidating(true);
    try {
      const text = await file.text();
      const { headers, rows } = parseCSV(text);
      if (rows.length === 0) { setError("CSV has no rows"); return; }
      if (rows.length > 500) { setError("Max 500 rows per upload (got " + rows.length + "). Split your file."); return; }
      setParsed({ filename: file.name, headers, rows });
      autoMap(headers);
      setSelectedRows(new Set(rows.map((_, i) => i)));
    } catch {
      setError("Could not parse CSV file");
    } finally {
      setValidating(false);
    }
  }

  function toggleRow(idx: number) {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }

  function toggleAll() {
    if (!parsed) return;
    if (selectedRows.size === parsed.rows.length) setSelectedRows(new Set());
    else setSelectedRows(new Set(parsed.rows.map((_, i) => i)));
  }

  function reset() {
    setParsed(null);
    setMapping({});
    setSelectedRows(new Set());
    setResult(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  // Build per-row issues map
  const rowIssues = parsed
    ? parsed.rows.map(r => validateRow(r, mapping))
    : [];

  const selectedCount = selectedRows.size;
  const selectedValidCount = parsed
    ? Array.from(selectedRows).filter(i => rowIssues[i].length === 0).length
    : 0;
  const missingRequiredMap = REQUIRED.filter(f => !mapping[f]);

  async function submitImport() {
    if (!parsed) return;
    if (selectedValidCount === 0) { setError("No valid rows selected to import"); return; }
    setError(null);
    setSubmitting(true);
    try {
      // Build payload rows with mapped field names (only valid + selected)
      const payloadRows: Row[] = [];
      for (let i = 0; i < parsed.rows.length; i++) {
        if (!selectedRows.has(i)) continue;
        if (rowIssues[i].length > 0) continue;
        const src = parsed.rows[i];
        const mapped: Row = {};
        for (const target of RECOGNIZED) {
          const srcKey = mapping[target];
          if (srcKey && src[srcKey] !== undefined && src[srcKey] !== "") mapped[target] = src[srcKey];
        }
        payloadRows.push(mapped);
      }

      const res = await fetch("/api/admin/inventory/bulk-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: payloadRows, filename: parsed.filename }),
      });
      const data = await res.json() as { success?: boolean; data?: UploadResult; error?: { message?: string } };
      if (!res.ok || !data.success) {
        setError(data.error?.message ?? "Upload failed");
        return;
      }
      setResult(data.data!);
    } catch {
      setError("Network error during upload");
    } finally {
      setSubmitting(false);
    }
  }

  const labelCls = "text-xs font-semibold text-slate-700 mb-1 block";
  const inputCls = "w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/30 focus:border-[#0B5FD1]";

  return (
    <div className="p-6 md:p-8 max-w-6xl" data-testid="admin-inventory-upload-page">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <Link href="/admin/inventory" className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 mb-3" data-testid="back-to-inventory">
            <ArrowLeft size={14} /> Back to inventory
          </Link>
          <h1 className="text-2xl font-bold text-slate-900">Bulk CSV Upload</h1>
          <p className="text-sm text-slate-500 mt-1">Upload up to 500 vehicle rows. Map columns, validate, then import.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/inventory/upload/history" data-testid="upload-history-link" className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-300 hover:bg-slate-100 rounded-lg text-xs font-semibold text-slate-700">
            <History size={14} /> Upload History
          </Link>
          <button
            type="button"
            onClick={downloadTemplate}
            disabled={downloadingTemplate}
            data-testid="download-template-btn"
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#0B5FD1] hover:bg-[#0A4DB8] disabled:bg-slate-300 text-white rounded-lg text-xs font-semibold"
          >
            {downloadingTemplate ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Download Template
          </button>
        </div>
      </div>

      {error && (
        <div data-testid="upload-error-banner" className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {!parsed && !result && (
        <div className="bg-white border-2 border-dashed border-slate-300 rounded-xl p-12 text-center">
          <FileText size={32} className="mx-auto text-slate-300 mb-3" />
          <p className="text-sm font-semibold text-slate-700 mb-1">Drop a CSV file or click to upload</p>
          <p className="text-xs text-slate-400 mb-4">Required columns: make, model, year, priceCents</p>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={validating}
            data-testid="select-csv-btn"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#0B5FD1] hover:bg-[#0A4DB8] text-white rounded-lg text-sm font-semibold"
          >
            {validating ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            Select CSV File
          </button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} data-testid="csv-input" />
        </div>
      )}

      {parsed && !result && (
        <>
          <section className="bg-white border border-slate-200 rounded-xl p-5 mb-4" data-testid="csv-mapping-section">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Column Mapping — {parsed.filename}</h2>
                <p className="text-xs text-slate-500 mt-0.5">{parsed.rows.length} rows detected. Confirm or change column mapping below.</p>
              </div>
              <button onClick={reset} className="text-xs text-slate-500 hover:text-slate-900" data-testid="reset-upload-btn">Choose different file</button>
            </div>

            {missingRequiredMap.length > 0 && (
              <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                Missing required column mappings: {missingRequiredMap.join(", ")}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {RECOGNIZED.map(target => {
                const isReq = (REQUIRED as readonly string[]).includes(target);
                return (
                  <div key={target}>
                    <label className={labelCls}>{target}{isReq && " *"}</label>
                    <select
                      data-testid={`mapping-${target}`}
                      className={inputCls}
                      value={mapping[target] ?? ""}
                      onChange={e => setMapping(prev => ({ ...prev, [target]: e.target.value }))}
                    >
                      <option value="">— skip —</option>
                      {parsed.headers.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-5 mb-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Preview & Selection</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {selectedCount} of {parsed.rows.length} selected · <span className="text-green-600 font-semibold">{selectedValidCount} valid</span> · <span className="text-red-600 font-semibold">{selectedCount - selectedValidCount} with issues</span>
                </p>
              </div>
              <button onClick={toggleAll} className="text-xs text-[#0B5FD1] hover:underline font-semibold" data-testid="toggle-all-rows">
                {selectedRows.size === parsed.rows.length ? "Deselect All" : "Select All"}
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs" data-testid="preview-table">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="px-2 py-2 w-8"></th>
                    <th className="px-2 py-2">#</th>
                    <th className="px-2 py-2">Make</th>
                    <th className="px-2 py-2">Model</th>
                    <th className="px-2 py-2">Year</th>
                    <th className="px-2 py-2">Price</th>
                    <th className="px-2 py-2">VIN</th>
                    <th className="px-2 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.slice(0, 100).map((row, i) => {
                    const issues = rowIssues[i];
                    const ok = issues.length === 0;
                    const sel = selectedRows.has(i);
                    return (
                      <tr key={i} data-testid={`preview-row-${i}`} className={`border-b border-slate-100 ${!ok ? "bg-red-50" : ""}`}>
                        <td className="px-2 py-2"><input type="checkbox" checked={sel} onChange={() => toggleRow(i)} data-testid={`row-checkbox-${i}`} /></td>
                        <td className="px-2 py-2 text-slate-400">{i + 1}</td>
                        <td className="px-2 py-2 font-semibold text-slate-900">{row[mapping.make] ?? "—"}</td>
                        <td className="px-2 py-2 text-slate-700">{row[mapping.model] ?? "—"}</td>
                        <td className="px-2 py-2 text-slate-700">{row[mapping.year] ?? "—"}</td>
                        <td className="px-2 py-2 text-slate-700">{row[mapping.priceCents] ?? "—"}</td>
                        <td className="px-2 py-2 font-mono text-[10px] text-slate-500">{row[mapping.vin] ?? "—"}</td>
                        <td className="px-2 py-2">
                          {ok ? (
                            <span className="inline-flex items-center gap-1 text-green-600"><CheckCircle2 size={12} /> Valid</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-red-600" title={issues.map(x => x.message).join(", ")}>
                              <AlertCircle size={12} /> {issues.length} issue{issues.length > 1 ? "s" : ""}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {parsed.rows.length > 100 && (
                <p className="mt-3 text-xs text-slate-400">Showing first 100 of {parsed.rows.length} rows in preview. All selected valid rows will be imported.</p>
              )}
            </div>
          </section>

          <div className="flex items-center gap-3">
            <button
              onClick={submitImport}
              disabled={submitting || selectedValidCount === 0 || missingRequiredMap.length > 0}
              data-testid="import-rows-btn"
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-[#0B5FD1] hover:bg-[#0A4DB8] disabled:bg-slate-300 text-white rounded-lg text-sm font-semibold"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              Import {selectedValidCount} valid row{selectedValidCount !== 1 ? "s" : ""}
            </button>
            <button onClick={reset} disabled={submitting} className="px-6 py-2.5 border border-slate-300 hover:bg-slate-100 rounded-lg text-sm font-semibold text-slate-700" data-testid="cancel-upload-btn">Cancel</button>
          </div>
        </>
      )}

      {result && (
        <section className="bg-white border border-slate-200 rounded-xl p-6" data-testid="upload-result-section">
          <div className="flex items-start gap-3 mb-4">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${result.failureCount === 0 ? "bg-green-100 text-green-600" : "bg-amber-100 text-amber-600"}`}>
              {result.failureCount === 0 ? <CheckCircle2 size={22} /> : <AlertCircle size={22} />}
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Upload Complete</h2>
              <p className="text-xs text-slate-500">Batch ID: <code className="font-mono">{result.batchId}</code></p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="bg-slate-50 rounded-lg p-3" data-testid="result-total">
              <p className="text-xs text-slate-500">Total Rows</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">{result.totalRows}</p>
            </div>
            <div className="bg-green-50 rounded-lg p-3" data-testid="result-success">
              <p className="text-xs text-green-700">Imported</p>
              <p className="text-2xl font-bold text-green-700 mt-1">{result.successCount}</p>
            </div>
            <div className="bg-red-50 rounded-lg p-3" data-testid="result-failed">
              <p className="text-xs text-red-700">Failed</p>
              <p className="text-2xl font-bold text-red-700 mt-1">{result.failureCount}</p>
            </div>
          </div>

          {result.failureCount > 0 && (
            <div className="mb-5">
              <h3 className="text-sm font-bold text-slate-900 mb-2">Failed Rows</h3>
              <ul className="text-xs text-slate-700 space-y-1 max-h-60 overflow-y-auto">
                {result.results.filter(r => r.status === "error").map((r, i) => (
                  <li key={i} data-testid={`failed-row-${r.row}`} className="px-3 py-1.5 bg-red-50 rounded">
                    Row {r.row}: <span className="text-red-700">{r.error}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center gap-3">
            <Link href="/admin/inventory" data-testid="goto-inventory-btn" className="px-5 py-2 bg-[#0B5FD1] hover:bg-[#0A4DB8] text-white rounded-lg text-sm font-semibold">View Inventory</Link>
            <button onClick={reset} className="px-5 py-2 border border-slate-300 hover:bg-slate-100 rounded-lg text-sm font-semibold text-slate-700" data-testid="upload-another-btn">Upload Another</button>
          </div>
        </section>
      )}
    </div>
  );
}
