"use client";
// Bulk Upload modal — extracted from SocialDashboardClient.tsx (lazy-loaded).
import { useEffect, useState } from "react";
import { X, AlertTriangle, ImageIcon, UploadCloud, Trash2, Plus } from "lucide-react";
import { fetchJson } from "../_shared/fetchJson";
import { uploadComposeImage } from "../_shared/upload";
import type { FranchiseRow } from "../_shared/types";

const BULK_PLATFORMS = ["tiktok", "instagram", "facebook", "youtube", "linkedin"] as const;

interface BulkRow {
  platform: string;
  franchiseSlug: string;
  hook: string;
  caption: string;
  hashtags: string;
  scheduledAt: string;
  imageUrl: string;
  imageName: string;
  uploading: boolean;
}

function emptyBulkRow(franchiseSlug: string): BulkRow {
  return {
    platform: "tiktok",
    franchiseSlug,
    hook: "",
    caption: "",
    hashtags: "",
    scheduledAt: "",
    imageUrl: "",
    imageName: "",
    uploading: false,
  };
}

// Minimal RFC-4180-ish CSV parser: handles quoted fields, embedded commas, and
// escaped double-quotes. Returns header + row objects keyed by lowercased header.
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length > 0) { row.push(field); if (row.some((f) => f.trim() !== "")) rows.push(row); }
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { obj[h] = (r[idx] ?? "").trim(); });
    return obj;
  });
}

function BulkUploadModal({
  franchises, onClose, onCreated, showToast,
}: {
  franchises: FranchiseRow[];
  onClose: () => void;
  onCreated: () => void;
  showToast: (m: string) => void;
}) {
  const defaultFranchise = franchises[0]?.slug ?? "dealer_secret_daily";
  const [mode, setMode] = useState<"form" | "csv">("form");
  const [rows, setRows] = useState<BulkRow[]>([emptyBulkRow(defaultFranchise)]);
  const [submitting, setSubmitting] = useState(false);

  // CSV state
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [imageFiles, setImageFiles] = useState<Record<string, File>>({});
  const [progress, setProgress] = useState<string | null>(null);

  const updateRow = (i: number, patch: Partial<BulkRow>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const handleRowImage = async (i: number, file: File) => {
    updateRow(i, { uploading: true, imageName: file.name });
    try {
      const url = await uploadComposeImage(file);
      updateRow(i, { imageUrl: url, uploading: false });
    } catch (err) {
      updateRow(i, { uploading: false, imageName: "" });
      showToast(err instanceof Error ? err.message : "Image upload failed");
    }
  };

  const submitForm = async () => {
    const valid = rows.filter((r) => r.hook.trim() && r.caption.trim());
    if (valid.length === 0) { showToast("Add at least one row with a hook and caption"); return; }
    setSubmitting(true);
    try {
      const payload = valid.map((r) => ({
        platform: r.platform,
        franchiseSlug: r.franchiseSlug,
        hook: r.hook.trim(),
        caption: r.caption.trim(),
        hashtags: r.hashtags,
        scheduledAt: r.scheduledAt ? new Date(r.scheduledAt).toISOString() : undefined,
        imageUrl: r.imageUrl || undefined,
      }));
      const res = await fetchJson<{ created: number; failed: { index: number; error: string }[]; total: number }>(
        "/api/admin/social/posts/bulk-create",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: payload }) },
      );
      showToast(`Created ${res.created} of ${res.total} posts${res.failed.length ? ` (${res.failed.length} failed)` : ""}`);
      onCreated();
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Bulk create failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCsvFile = async (file: File) => {
    setCsvError(null);
    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      if (parsed.length === 0) { setCsvError("No data rows found. Expected a header row + at least one row."); setCsvRows([]); return; }
      const missingPlatform = parsed.some((r) => !r.platform || !BULK_PLATFORMS.includes(r.platform as typeof BULK_PLATFORMS[number]));
      const missingContent = parsed.some((r) => !r.hook || !r.caption);
      if (missingPlatform) setCsvError("Some rows are missing a valid 'platform' (tiktok/instagram/facebook/youtube/linkedin).");
      else if (missingContent) setCsvError("Some rows are missing 'hook' or 'caption'.");
      setCsvRows(parsed);
    } catch {
      setCsvError("Could not read the CSV file.");
      setCsvRows([]);
    }
  };

  const handleCsvImages = (files: FileList) => {
    const map: Record<string, File> = {};
    Array.from(files).forEach((f) => { map[f.name] = f; });
    setImageFiles((prev) => ({ ...prev, ...map }));
  };

  const submitCsv = async () => {
    if (csvRows.length === 0) { showToast("Upload a CSV first"); return; }
    const validRows = csvRows.filter(
      (r) => r.platform && BULK_PLATFORMS.includes(r.platform as typeof BULK_PLATFORMS[number]) && r.hook && r.caption,
    );
    if (validRows.length === 0) { showToast("No valid rows to import"); return; }
    setSubmitting(true);
    try {
      const payload: Array<Record<string, unknown>> = [];
      for (let i = 0; i < validRows.length; i++) {
        const r = validRows[i];
        let imageUrl: string | undefined;
        const imageName = r.image || r.imagefile || r.imagename || "";
        if (imageName && imageFiles[imageName]) {
          setProgress(`Uploading image ${i + 1}/${validRows.length}…`);
          imageUrl = await uploadComposeImage(imageFiles[imageName]).catch(() => undefined);
        }
        payload.push({
          platform: r.platform,
          franchiseSlug: r.franchiseslug || r.franchise || defaultFranchise,
          hook: r.hook,
          caption: r.caption,
          hashtags: r.hashtags || "",
          scheduledAt: r.scheduledat ? new Date(r.scheduledat).toISOString() : undefined,
          imageUrl,
        });
      }
      setProgress("Creating posts…");
      const res = await fetchJson<{ created: number; failed: { index: number; error: string }[]; total: number }>(
        "/api/admin/social/posts/bulk-create",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: payload }) },
      );
      showToast(`Created ${res.created} of ${res.total} posts${res.failed.length ? ` (${res.failed.length} failed)` : ""}`);
      onCreated();
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "CSV import failed");
    } finally {
      setSubmitting(false);
      setProgress(null);
    }
  };

  const matchedImages = csvRows.filter((r) => {
    const n = r.image || r.imagefile || r.imagename || "";
    return n && imageFiles[n];
  }).length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Bulk upload posts" className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" data-testid="bulk-modal">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2E8F0]">
          <div>
            <h2 className="text-sm font-bold text-[#0F172A] flex items-center gap-2"><UploadCloud size={16} /> Bulk Upload Posts</h2>
            <p className="text-xs text-[#64748B]">Create many posts at once, with optional images.</p>
          </div>
          <button onClick={onClose} className="text-[#64748B] hover:text-[#0F172A]"><X size={18} /></button>
        </div>

        <div className="flex gap-1 px-5 pt-3 border-b border-[#E2E8F0]">
          {(["form", "csv"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-4 py-2 text-xs font-semibold border-b-2 ${mode === m ? "border-al-primary text-al-primary" : "border-transparent text-[#64748B]"}`}>
              {m === "form" ? "Multi-row form" : "CSV + images"}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto p-5">
          {mode === "form" ? (
            <div className="space-y-3">
              {rows.map((r, i) => (
                <div key={i} className="border border-[#E2E8F0] rounded-xl p-3 space-y-2 relative">
                  <div className="grid grid-cols-2 gap-2">
                    <select value={r.platform} onChange={(e) => updateRow(i, { platform: e.target.value })}
                      className="text-xs border border-[#E2E8F0] rounded-lg px-2 py-1.5">
                      {BULK_PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                    <select value={r.franchiseSlug} onChange={(e) => updateRow(i, { franchiseSlug: e.target.value })}
                      className="text-xs border border-[#E2E8F0] rounded-lg px-2 py-1.5">
                      {franchises.map((f) => <option key={f.slug} value={f.slug}>{f.name}</option>)}
                    </select>
                  </div>
                  <input value={r.hook} onChange={(e) => updateRow(i, { hook: e.target.value })} placeholder="Hook"
                    className="w-full text-xs border border-[#E2E8F0] rounded-lg px-2 py-1.5" />
                  <textarea value={r.caption} onChange={(e) => updateRow(i, { caption: e.target.value })} placeholder="Caption" rows={2}
                    className="w-full text-xs border border-[#E2E8F0] rounded-lg px-2 py-1.5" />
                  <div className="grid grid-cols-2 gap-2">
                    <input value={r.hashtags} onChange={(e) => updateRow(i, { hashtags: e.target.value })} placeholder="#tag1, #tag2"
                      className="text-xs border border-[#E2E8F0] rounded-lg px-2 py-1.5" />
                    <input type="datetime-local" value={r.scheduledAt} onChange={(e) => updateRow(i, { scheduledAt: e.target.value })}
                      className="text-xs border border-[#E2E8F0] rounded-lg px-2 py-1.5" />
                  </div>
                  <div className="flex items-center gap-3">
                    <label className={`text-xs text-al-primary flex items-center gap-1 cursor-pointer hover:underline ${r.uploading ? "opacity-40 pointer-events-none" : ""}`}>
                      <ImageIcon size={12} /> {r.uploading ? "Uploading…" : r.imageUrl ? "Replace image" : "Add image"}
                      <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleRowImage(i, f); e.target.value = ""; }} />
                    </label>
                    {r.imageUrl && <img src={r.imageUrl} alt="" className="w-8 h-8 rounded object-cover border border-[#E2E8F0]" />}
                    {rows.length > 1 && (
                      <button onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}
                        className="ml-auto text-rose-500 hover:text-rose-700"><Trash2 size={14} /></button>
                    )}
                  </div>
                </div>
              ))}
              <button onClick={() => setRows((rs) => [...rs, emptyBulkRow(defaultFranchise)])}
                className="flex items-center gap-1 text-xs font-semibold text-al-primary hover:underline">
                <Plus size={14} /> Add another post
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="text-xs text-[#475569] bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-3">
                <p className="font-semibold mb-1">CSV format</p>
                <p>Header row with columns: <code className="text-al-primary">platform, hook, caption, hashtags, scheduledAt, image</code></p>
                <p className="mt-1">platform ∈ tiktok/instagram/facebook/youtube/linkedin. <code>image</code> is the filename of an uploaded image (optional). <code>scheduledAt</code> is ISO or any parseable date (optional).</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="border-2 border-dashed border-[#E2E8F0] rounded-xl p-4 text-center cursor-pointer hover:border-al-primary">
                  <UploadCloud size={20} className="mx-auto text-slate-400 mb-1" />
                  <p className="text-xs font-semibold text-[#0F172A]">{csvRows.length > 0 ? `${csvRows.length} rows loaded` : "Upload CSV"}</p>
                  <input type="file" accept=".csv,text/csv" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleCsvFile(f); e.target.value = ""; }} />
                </label>
                <label className="border-2 border-dashed border-[#E2E8F0] rounded-xl p-4 text-center cursor-pointer hover:border-al-primary">
                  <ImageIcon size={20} className="mx-auto text-slate-400 mb-1" />
                  <p className="text-xs font-semibold text-[#0F172A]">{Object.keys(imageFiles).length > 0 ? `${Object.keys(imageFiles).length} images (${matchedImages} matched)` : "Upload images"}</p>
                  <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden"
                    onChange={(e) => { if (e.target.files) handleCsvImages(e.target.files); e.target.value = ""; }} />
                </label>
              </div>
              {csvError && <p className="text-xs text-rose-600 flex items-center gap-1"><AlertTriangle size={12} /> {csvError}</p>}
              {csvRows.length > 0 && (
                <div className="border border-[#E2E8F0] rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-[#F8FAFC] text-[#64748B]"><tr>
                      <th className="text-left px-2 py-1.5">Platform</th><th className="text-left px-2 py-1.5">Hook</th><th className="text-left px-2 py-1.5">Image</th>
                    </tr></thead>
                    <tbody>
                      {csvRows.slice(0, 6).map((r, i) => {
                        const n = r.image || r.imagefile || r.imagename || "";
                        return (
                          <tr key={i} className="border-t border-[#E2E8F0]">
                            <td className="px-2 py-1.5">{r.platform}</td>
                            <td className="px-2 py-1.5 truncate max-w-[260px]">{r.hook}</td>
                            <td className="px-2 py-1.5">{n ? (imageFiles[n] ? <span className="text-emerald-600">✓ {n}</span> : <span className="text-amber-600">missing {n}</span>) : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {csvRows.length > 6 && <p className="text-[10px] text-slate-400 px-2 py-1">+{csvRows.length - 6} more rows</p>}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-white border-t border-[#E2E8F0] px-5 py-3 flex items-center gap-2">
          {progress && <span className="text-xs text-[#64748B]">{progress}</span>}
          <button onClick={onClose} className="ml-auto text-xs font-semibold text-[#64748B] px-3 py-2">Cancel</button>
          {mode === "form" ? (
            <button disabled={submitting} onClick={() => void submitForm()}
              className="bg-al-primary text-white text-xs font-semibold px-4 py-2 rounded-lg hover:bg-[#0a54bc] disabled:opacity-50">
              {submitting ? "Creating…" : "Create posts"}
            </button>
          ) : (
            <button disabled={submitting || csvRows.length === 0} onClick={() => void submitCsv()}
              className="bg-al-primary text-white text-xs font-semibold px-4 py-2 rounded-lg hover:bg-[#0a54bc] disabled:opacity-50">
              {submitting ? "Importing…" : "Import & create"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Compose drawer ──────────────────────────────────────────────────────────

export default BulkUploadModal;
