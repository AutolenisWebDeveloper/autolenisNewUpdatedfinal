"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Upload, X, Loader2, Image as ImageIcon, Link as LinkIcon } from "lucide-react";

interface FormState {
  make: string;
  model: string;
  year: string;
  trim: string;
  vin: string;
  priceCents: string;
  mileage: string;
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
}

const EMPTY: FormState = {
  make: "", model: "", year: "", trim: "", vin: "",
  priceCents: "", mileage: "", condition: "used",
  bodyType: "", exteriorColor: "", interiorColor: "",
  engine: "", transmission: "", drivetrain: "", fuelType: "",
  city: "", state: "", zip: "", description: "", lane: "LANE_3",
};

const LANES = [
  { value: "LANE_1", label: "Lane 1 — Featured (homepage carousel)" },
  { value: "LANE_2", label: "Lane 2 — Curated" },
  { value: "LANE_3", label: "Lane 3 — Standard" },
];

export default function NewInventoryClient() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [images, setImages] = useState<string[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [imageUrlInput, setImageUrlInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
    setFieldErrors(prev => ({ ...prev, [key]: "" }));
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const remaining = 10 - images.length;
    const toUpload = Array.from(files).slice(0, remaining);
    if (files.length > remaining) {
      setError(`Only ${remaining} more image${remaining === 1 ? "" : "s"} can be added (max 10).`);
    }

    setUploadingCount(toUpload.length);
    const uploaded: string[] = [];
    for (const file of toUpload) {
      const fd = new FormData();
      fd.append("file", file);
      try {
        const res = await fetch("/api/admin/inventory/upload-image", { method: "POST", body: fd });
        const data = await res.json() as { success?: boolean; url?: string; error?: { message?: string } };
        if (data.success && data.url) uploaded.push(data.url);
        else setError(data.error?.message ?? "Image upload failed");
      } catch {
        setError("Image upload failed (network)");
      }
    }
    setImages(prev => [...prev, ...uploaded].slice(0, 10));
    setUploadingCount(0);
    if (fileRef.current) fileRef.current.value = "";
  }

  function addImageUrl() {
    const url = imageUrlInput.trim();
    if (!url) return;
    if (images.length >= 10) { setError("Maximum 10 images reached"); return; }
    try { new URL(url); } catch { setError("Invalid image URL"); return; }
    setImages(prev => [...prev, url]);
    setImageUrlInput("");
    setError(null);
  }

  function removeImage(idx: number) {
    setImages(prev => prev.filter((_, i) => i !== idx));
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!form.make.trim()) errs.make = "Make is required";
    if (!form.model.trim()) errs.model = "Model is required";
    if (!form.year || isNaN(Number(form.year))) errs.year = "Year is required";
    else if (Number(form.year) < 2010 || Number(form.year) > 2026) errs.year = "Year must be 2010–2026";
    if (!form.priceCents || isNaN(Number(form.priceCents)) || Number(form.priceCents) <= 0) errs.priceCents = "Price is required";
    if (form.vin && !/^[A-HJ-NPR-Z0-9]{17}$/i.test(form.vin.trim())) errs.vin = "VIN must be 17 alphanumeric characters";
    if (form.mileage && isNaN(Number(form.mileage))) errs.mileage = "Mileage must be a number";
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!validate()) { setError("Please fix the highlighted fields"); return; }
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        make: form.make.trim(),
        model: form.model.trim(),
        year: Number(form.year),
        priceCents: Math.round(Number(form.priceCents) * 100),
        lane: form.lane,
        images,
      };
      if (form.trim) payload.trim = form.trim.trim();
      if (form.vin) payload.vin = form.vin.trim().toUpperCase();
      if (form.mileage) payload.mileage = Number(form.mileage);
      if (form.condition) payload.condition = form.condition;
      if (form.bodyType) payload.bodyType = form.bodyType.trim();
      if (form.exteriorColor) payload.exteriorColor = form.exteriorColor.trim();
      if (form.interiorColor) payload.interiorColor = form.interiorColor.trim();
      if (form.engine) payload.engine = form.engine.trim();
      if (form.transmission) payload.transmission = form.transmission.trim();
      if (form.drivetrain) payload.drivetrain = form.drivetrain.trim();
      if (form.fuelType) payload.fuelType = form.fuelType.trim();
      if (form.city) payload.city = form.city.trim();
      if (form.state) payload.state = form.state.trim().toUpperCase();
      if (form.zip) payload.zip = form.zip.trim();
      if (form.description) payload.description = form.description.trim();

      const res = await fetch("/api/admin/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json() as { success?: boolean; data?: { item?: { id: string } }; error?: { message?: string; code?: string } };
      if (!res.ok) {
        setError(data.error?.message ?? "Failed to create vehicle");
        return;
      }
      router.push("/admin/inventory?created=" + (data.data?.item?.id ?? ""));
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const labelCls = "text-xs font-semibold text-slate-700 mb-1 block";
  const inputCls = "w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-al-primary/30 focus:border-al-primary";
  const errorCls = "text-xs text-red-600 mt-1";

  return (
    <div className="p-6 md:p-8 max-w-5xl" data-testid="admin-inventory-new-page">
      <div className="mb-6">
        <Link href="/admin/inventory" data-testid="back-to-inventory" className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 mb-3">
          <ArrowLeft size={14} /> Back to inventory
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">Add Vehicle Manually</h1>
        <p className="text-sm text-slate-500 mt-1">Create a new inventory listing. Required fields are marked with *</p>
      </div>

      {error && (
        <div data-testid="form-error-banner" className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-bold text-slate-900 mb-4">Vehicle Identity</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Make *</label>
              <input data-testid="field-make" className={inputCls} value={form.make} onChange={e => update("make", e.target.value)} />
              {fieldErrors.make && <p className={errorCls}>{fieldErrors.make}</p>}
            </div>
            <div>
              <label className={labelCls}>Model *</label>
              <input data-testid="field-model" className={inputCls} value={form.model} onChange={e => update("model", e.target.value)} />
              {fieldErrors.model && <p className={errorCls}>{fieldErrors.model}</p>}
            </div>
            <div>
              <label className={labelCls}>Year *</label>
              <input data-testid="field-year" type="number" className={inputCls} value={form.year} onChange={e => update("year", e.target.value)} />
              {fieldErrors.year && <p className={errorCls}>{fieldErrors.year}</p>}
            </div>
            <div>
              <label className={labelCls}>Trim</label>
              <input data-testid="field-trim" className={inputCls} value={form.trim} onChange={e => update("trim", e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <label className={labelCls}>VIN (optional, 17 chars)</label>
              <input data-testid="field-vin" className={`${inputCls} font-mono uppercase`} value={form.vin} onChange={e => update("vin", e.target.value.toUpperCase())} maxLength={17} />
              {fieldErrors.vin && <p className={errorCls}>{fieldErrors.vin}</p>}
            </div>
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-bold text-slate-900 mb-4">Pricing & Condition</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Asking Price (USD) *</label>
              <input data-testid="field-price" type="number" min="0" step="100" className={inputCls} value={form.priceCents} onChange={e => update("priceCents", e.target.value)} placeholder="e.g. 35000" />
              {fieldErrors.priceCents && <p className={errorCls}>{fieldErrors.priceCents}</p>}
            </div>
            <div>
              <label className={labelCls}>Mileage</label>
              <input data-testid="field-mileage" type="number" className={inputCls} value={form.mileage} onChange={e => update("mileage", e.target.value)} />
              {fieldErrors.mileage && <p className={errorCls}>{fieldErrors.mileage}</p>}
            </div>
            <div>
              <label className={labelCls}>Condition</label>
              <select data-testid="field-condition" className={inputCls} value={form.condition} onChange={e => update("condition", e.target.value)}>
                <option value="used">Used</option>
                <option value="new">New</option>
              </select>
            </div>
            <div className="md:col-span-3">
              <label className={labelCls}>Lane Assignment</label>
              <select data-testid="field-lane" className={inputCls} value={form.lane} onChange={e => update("lane", e.target.value)}>
                {LANES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </div>
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-bold text-slate-900 mb-4">Specifications</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Body Type</label>
              <input data-testid="field-bodyType" className={inputCls} value={form.bodyType} onChange={e => update("bodyType", e.target.value)} placeholder="Sedan, SUV..." />
            </div>
            <div>
              <label className={labelCls}>Exterior Color</label>
              <input data-testid="field-exteriorColor" className={inputCls} value={form.exteriorColor} onChange={e => update("exteriorColor", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Interior Color</label>
              <input data-testid="field-interiorColor" className={inputCls} value={form.interiorColor} onChange={e => update("interiorColor", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Engine</label>
              <input data-testid="field-engine" className={inputCls} value={form.engine} onChange={e => update("engine", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Transmission</label>
              <input data-testid="field-transmission" className={inputCls} value={form.transmission} onChange={e => update("transmission", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Drivetrain</label>
              <input data-testid="field-drivetrain" className={inputCls} value={form.drivetrain} onChange={e => update("drivetrain", e.target.value)} placeholder="FWD/AWD/RWD/4WD" />
            </div>
            <div>
              <label className={labelCls}>Fuel Type</label>
              <input data-testid="field-fuelType" className={inputCls} value={form.fuelType} onChange={e => update("fuelType", e.target.value)} />
            </div>
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-bold text-slate-900 mb-4">Location</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>City</label>
              <input data-testid="field-city" className={inputCls} value={form.city} onChange={e => update("city", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>State</label>
              <input data-testid="field-state" className={inputCls} maxLength={2} value={form.state} onChange={e => update("state", e.target.value.toUpperCase())} placeholder="GA" />
            </div>
            <div>
              <label className={labelCls}>ZIP</label>
              <input data-testid="field-zip" className={inputCls} value={form.zip} onChange={e => update("zip", e.target.value)} />
            </div>
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-bold text-slate-900 mb-4">Description</h2>
          <textarea data-testid="field-description" rows={4} className={inputCls} value={form.description} onChange={e => update("description", e.target.value)} placeholder="Optional notes about the vehicle..." />
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-bold text-slate-900 mb-1">Images <span className="font-normal text-slate-400">({images.length}/10)</span></h2>
          <p className="text-xs text-slate-500 mb-4">Upload from your computer or paste an image URL. First image is used as the cover.</p>

          <div className="flex flex-wrap items-center gap-2 mb-4">
            <button
              type="button"
              data-testid="upload-image-btn"
              disabled={images.length >= 10 || uploadingCount > 0}
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-al-primary hover:bg-al-primary-hover disabled:bg-slate-300 text-white rounded-lg text-xs font-semibold transition"
            >
              {uploadingCount > 0 ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              {uploadingCount > 0 ? `Uploading ${uploadingCount}...` : "Upload Images"}
            </button>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e => handleFiles(e.target.files)} data-testid="file-input" />
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-4">
            <LinkIcon size={14} className="text-slate-400" />
            <input
              data-testid="image-url-input"
              type="url"
              placeholder="https://example.com/photo.jpg"
              className={`${inputCls} max-w-md`}
              value={imageUrlInput}
              onChange={e => setImageUrlInput(e.target.value)}
            />
            <button
              type="button"
              data-testid="add-image-url-btn"
              onClick={addImageUrl}
              disabled={!imageUrlInput.trim() || images.length >= 10}
              className="px-3 py-2 border border-slate-300 hover:bg-slate-100 disabled:opacity-50 rounded-lg text-xs font-semibold"
            >Add URL</button>
          </div>

          {images.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3" data-testid="image-grid">
              {images.map((url, idx) => (
                <div key={idx} className="relative aspect-video bg-slate-100 rounded-lg overflow-hidden border border-slate-200" data-testid={`image-thumb-${idx}`}>
                  <img src={url} alt={`Vehicle ${idx + 1}`} className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  <button
                    type="button"
                    data-testid={`remove-image-${idx}`}
                    onClick={() => removeImage(idx)}
                    className="absolute top-1 right-1 w-6 h-6 bg-black/70 hover:bg-black text-white rounded-full flex items-center justify-center"
                  ><X size={12} /></button>
                  {idx === 0 && (
                    <span className="absolute bottom-1 left-1 bg-al-primary text-white text-[10px] px-1.5 py-0.5 rounded font-semibold">COVER</span>
                  )}
                </div>
              ))}
            </div>
          )}
          {images.length === 0 && (
            <div className="text-center text-xs text-slate-400 py-6 border-2 border-dashed border-slate-200 rounded-lg flex flex-col items-center gap-2">
              <ImageIcon size={20} />
              No images yet
            </div>
          )}
        </section>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            data-testid="submit-vehicle-btn"
            disabled={submitting}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-al-primary hover:bg-al-primary-hover disabled:bg-slate-300 text-white rounded-lg text-sm font-semibold transition"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {submitting ? "Saving..." : "Save Vehicle"}
          </button>
          <Link href="/admin/inventory" data-testid="cancel-vehicle-btn" className="px-6 py-2.5 border border-slate-300 hover:bg-slate-100 rounded-lg text-sm font-semibold text-slate-700">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
