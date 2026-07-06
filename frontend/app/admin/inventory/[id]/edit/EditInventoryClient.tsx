"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Upload, X, Loader2, Link as LinkIcon, Image as ImageIcon } from "lucide-react";

interface Initial {
  id: string;
  make: string;
  model: string;
  year: number;
  trim: string;
  vin: string;
  priceCents: number;
  mileage: number | null;
  condition: string;
  bodyType: string;
  exteriorColor: string;
  interiorColor: string;
  engine: string;
  transmission: string;
  drivetrain: string;
  fuelType: string;
  city: string;
  state: string;
  zip: string;
  description: string;
  lane: string;
  isActive: boolean;
  images: string[];
}

const LANES = [
  { value: "LANE_1", label: "Lane 1 — Featured" },
  { value: "LANE_2", label: "Lane 2 — Curated" },
  { value: "LANE_3", label: "Lane 3 — Standard" },
];

export default function EditInventoryClient({ initial }: { initial: Initial }) {
  const router = useRouter();
  const [form, setForm] = useState({
    make: initial.make,
    model: initial.model,
    year: String(initial.year),
    trim: initial.trim,
    vin: initial.vin,
    priceCents: String(initial.priceCents / 100),
    mileage: initial.mileage !== null ? String(initial.mileage) : "",
    condition: initial.condition,
    bodyType: initial.bodyType,
    exteriorColor: initial.exteriorColor,
    interiorColor: initial.interiorColor,
    engine: initial.engine,
    transmission: initial.transmission,
    drivetrain: initial.drivetrain,
    fuelType: initial.fuelType,
    city: initial.city,
    state: initial.state,
    zip: initial.zip,
    description: initial.description,
    lane: initial.lane,
    isActive: initial.isActive,
  });
  const [images, setImages] = useState<string[]>(initial.images);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [imageUrlInput, setImageUrlInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function update<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm(prev => ({ ...prev, [k]: v }));
  }

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    const remaining = 10 - images.length;
    const toUpload = Array.from(files).slice(0, remaining);
    setUploadingCount(toUpload.length);
    const uploaded: string[] = [];
    for (const file of toUpload) {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("vehicleId", initial.id);
      try {
        const res = await fetch("/api/admin/inventory/upload-image", { method: "POST", body: fd });
        const data = await res.json() as { success?: boolean; url?: string };
        if (data.success && data.url) uploaded.push(data.url);
      } catch { /* ignore */ }
    }
    setImages(prev => [...prev, ...uploaded].slice(0, 10));
    setUploadingCount(0);
    if (fileRef.current) fileRef.current.value = "";
  }

  function addImageUrl() {
    const url = imageUrlInput.trim();
    if (!url) return;
    if (images.length >= 10) { setError("Max 10 images"); return; }
    try { new URL(url); } catch { setError("Invalid URL"); return; }
    setImages(prev => [...prev, url]);
    setImageUrlInput("");
    setError(null);
  }

  function removeImage(idx: number) { setImages(prev => prev.filter((_, i) => i !== idx)); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        make: form.make.trim(),
        model: form.model.trim(),
        year: Number(form.year),
        priceCents: Math.round(Number(form.priceCents) * 100),
        lane: form.lane,
        images,
        isActive: form.isActive,
        trim: form.trim,
        vin: form.vin || "",
        mileage: form.mileage ? Number(form.mileage) : undefined,
        condition: form.condition,
        bodyType: form.bodyType,
        exteriorColor: form.exteriorColor,
        interiorColor: form.interiorColor,
        engine: form.engine,
        transmission: form.transmission,
        drivetrain: form.drivetrain,
        fuelType: form.fuelType,
        city: form.city,
        state: form.state,
        zip: form.zip,
        description: form.description,
      };
      const res = await fetch(`/api/admin/inventory/${initial.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json() as { success?: boolean; error?: { message?: string } };
      if (!res.ok || !data.success) {
        setError(data.error?.message ?? "Update failed");
        return;
      }
      router.push("/admin/inventory?updated=" + initial.id);
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  const labelCls = "text-xs font-semibold text-slate-700 mb-1 block";
  const inputCls = "w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-al-primary/30 focus:border-al-primary";

  return (
    <div className="p-6 md:p-8 max-w-5xl" data-testid="admin-inventory-edit-page">
      <div className="mb-6">
        <Link href="/admin/inventory" className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 mb-3" data-testid="back-to-inventory">
          <ArrowLeft size={14} /> Back to inventory
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">Edit Vehicle</h1>
        <p className="text-sm text-slate-500 mt-1">{initial.year} {initial.make} {initial.model} · ID: <code className="font-mono text-[10px]">{initial.id}</code></p>
      </div>

      {error && <div data-testid="form-error-banner" className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

      <form onSubmit={handleSubmit} className="space-y-5">
        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-bold text-slate-900 mb-4">Identity</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div><label className={labelCls}>Make *</label><input data-testid="field-make" className={inputCls} value={form.make} onChange={e => update("make", e.target.value)} /></div>
            <div><label className={labelCls}>Model *</label><input data-testid="field-model" className={inputCls} value={form.model} onChange={e => update("model", e.target.value)} /></div>
            <div><label className={labelCls}>Year *</label><input data-testid="field-year" type="number" className={inputCls} value={form.year} onChange={e => update("year", e.target.value)} /></div>
            <div><label className={labelCls}>Trim</label><input data-testid="field-trim" className={inputCls} value={form.trim} onChange={e => update("trim", e.target.value)} /></div>
            <div className="md:col-span-2"><label className={labelCls}>VIN</label><input data-testid="field-vin" maxLength={17} className={`${inputCls} font-mono uppercase`} value={form.vin} onChange={e => update("vin", e.target.value.toUpperCase())} /></div>
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-bold text-slate-900 mb-4">Pricing</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div><label className={labelCls}>Price (USD) *</label><input data-testid="field-price" type="number" className={inputCls} value={form.priceCents} onChange={e => update("priceCents", e.target.value)} /></div>
            <div><label className={labelCls}>Mileage</label><input data-testid="field-mileage" type="number" className={inputCls} value={form.mileage} onChange={e => update("mileage", e.target.value)} /></div>
            <div><label className={labelCls}>Condition</label>
              <select data-testid="field-condition" className={inputCls} value={form.condition} onChange={e => update("condition", e.target.value)}>
                <option value="used">Used</option>
                <option value="new">New</option>
              </select>
            </div>
            <div className="md:col-span-2"><label className={labelCls}>Lane</label>
              <select data-testid="field-lane" className={inputCls} value={form.lane} onChange={e => update("lane", e.target.value)}>
                {LANES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </div>
            <div className="flex items-end">
              <label className="inline-flex items-center gap-2 text-sm text-slate-700 select-none cursor-pointer">
                <input type="checkbox" data-testid="field-isActive" checked={form.isActive} onChange={e => update("isActive", e.target.checked)} />
                Active (visible to buyers)
              </label>
            </div>
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-bold text-slate-900 mb-4">Specs</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div><label className={labelCls}>Body Type</label><input data-testid="field-bodyType" className={inputCls} value={form.bodyType} onChange={e => update("bodyType", e.target.value)} /></div>
            <div><label className={labelCls}>Exterior</label><input data-testid="field-exteriorColor" className={inputCls} value={form.exteriorColor} onChange={e => update("exteriorColor", e.target.value)} /></div>
            <div><label className={labelCls}>Interior</label><input data-testid="field-interiorColor" className={inputCls} value={form.interiorColor} onChange={e => update("interiorColor", e.target.value)} /></div>
            <div><label className={labelCls}>Engine</label><input data-testid="field-engine" className={inputCls} value={form.engine} onChange={e => update("engine", e.target.value)} /></div>
            <div><label className={labelCls}>Transmission</label><input data-testid="field-transmission" className={inputCls} value={form.transmission} onChange={e => update("transmission", e.target.value)} /></div>
            <div><label className={labelCls}>Drivetrain</label><input data-testid="field-drivetrain" className={inputCls} value={form.drivetrain} onChange={e => update("drivetrain", e.target.value)} /></div>
            <div><label className={labelCls}>Fuel Type</label><input data-testid="field-fuelType" className={inputCls} value={form.fuelType} onChange={e => update("fuelType", e.target.value)} /></div>
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-bold text-slate-900 mb-4">Location</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div><label className={labelCls}>City</label><input data-testid="field-city" className={inputCls} value={form.city} onChange={e => update("city", e.target.value)} /></div>
            <div><label className={labelCls}>State</label><input data-testid="field-state" maxLength={2} className={inputCls} value={form.state} onChange={e => update("state", e.target.value.toUpperCase())} /></div>
            <div><label className={labelCls}>ZIP</label><input data-testid="field-zip" className={inputCls} value={form.zip} onChange={e => update("zip", e.target.value)} /></div>
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-bold text-slate-900 mb-3">Description</h2>
          <textarea data-testid="field-description" rows={4} className={inputCls} value={form.description} onChange={e => update("description", e.target.value)} />
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-bold text-slate-900 mb-1">Images <span className="font-normal text-slate-400">({images.length}/10)</span></h2>
          <div className="flex flex-wrap items-center gap-2 my-3">
            <button type="button" data-testid="upload-image-btn" onClick={() => fileRef.current?.click()} disabled={images.length >= 10 || uploadingCount > 0}
              className="inline-flex items-center gap-2 px-4 py-2 bg-al-primary hover:bg-al-primary-hover disabled:bg-slate-300 text-white rounded-lg text-xs font-semibold">
              {uploadingCount > 0 ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              {uploadingCount > 0 ? `Uploading ${uploadingCount}...` : "Upload"}
            </button>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e => handleFiles(e.target.files)} data-testid="file-input" />
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <LinkIcon size={14} className="text-slate-400" />
            <input data-testid="image-url-input" type="url" placeholder="https://example.com/photo.jpg" className={`${inputCls} max-w-md`}
              value={imageUrlInput} onChange={e => setImageUrlInput(e.target.value)} />
            <button type="button" data-testid="add-image-url-btn" onClick={addImageUrl} disabled={!imageUrlInput.trim() || images.length >= 10}
              className="px-3 py-2 border border-slate-300 hover:bg-slate-100 disabled:opacity-50 rounded-lg text-xs font-semibold">Add URL</button>
          </div>
          {images.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3" data-testid="image-grid">
              {images.map((url, idx) => (
                <div key={idx} className="relative aspect-video bg-slate-100 rounded-lg overflow-hidden border border-slate-200" data-testid={`image-thumb-${idx}`}>
                  <img src={url} alt="" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  <button type="button" data-testid={`remove-image-${idx}`} onClick={() => removeImage(idx)}
                    className="absolute top-1 right-1 w-6 h-6 bg-black/70 hover:bg-black text-white rounded-full flex items-center justify-center"><X size={12} /></button>
                  {idx === 0 && <span className="absolute bottom-1 left-1 bg-al-primary text-white text-[10px] px-1.5 py-0.5 rounded font-semibold">COVER</span>}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-xs text-slate-400 py-6 border-2 border-dashed border-slate-200 rounded-lg flex flex-col items-center gap-2">
              <ImageIcon size={20} /> No images
            </div>
          )}
        </section>

        <div className="flex items-center gap-3 pt-2">
          <button type="submit" data-testid="submit-edit-btn" disabled={submitting}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-al-primary hover:bg-al-primary-hover disabled:bg-slate-300 text-white rounded-lg text-sm font-semibold">
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {submitting ? "Saving..." : "Save Changes"}
          </button>
          <Link href="/admin/inventory" className="px-6 py-2.5 border border-slate-300 hover:bg-slate-100 rounded-lg text-sm font-semibold text-slate-700" data-testid="cancel-edit-btn">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
