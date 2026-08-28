"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, apiErrorMessage } from "@/lib/api/client";

// Must match the API enum exactly (z.enum(["NEW","USED","CPO"])). The previous
// list ("Excellent"/"Good"/...) could only ever produce a 422.
const CONDITIONS = [
  { value: "NEW", label: "New" },
  { value: "USED", label: "Used" },
  { value: "CPO", label: "Certified Pre-Owned" },
] as const;

const INPUT_CLASS =
  "w-full border border-slate-200 rounded-lg px-4 py-3 text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-al-primary/30";

export default function AddInventoryPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vinDecodeMsg, setVinDecodeMsg] = useState<string | null>(null);
  const [vinDecoding, setVinDecoding] = useState(false);

  const [vin, setVin] = useState("");
  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [trim, setTrim] = useState("");
  const [mileage, setMileage] = useState("");
  const [condition, setCondition] = useState<string>("USED");
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");

  async function handleVinDecode() {
    const v = vin.trim().toUpperCase();
    if (!v || v.length < 11) {
      setVinDecodeMsg("Enter a valid VIN (11–17 characters)");
      return;
    }
    setVinDecoding(true);
    setVinDecodeMsg("Decoding…");
    try {
      const { decoded } = await api.get<{ decoded: { year?: string | null; make?: string | null; model?: string | null; trim?: string | null } }>(
        `/api/dealer/inventory/vin-decode?vin=${encodeURIComponent(v)}`
      );
      if (decoded.year)  setYear(decoded.year);
      if (decoded.make)  setMake(decoded.make);
      if (decoded.model) setModel(decoded.model);
      if (decoded.trim)  setTrim(decoded.trim);
      setVinDecodeMsg(`Decoded: ${decoded.year ?? ""} ${decoded.make ?? ""} ${decoded.model ?? ""}`.trim());
    } catch (err) {
      setVinDecodeMsg(apiErrorMessage(err, "Network error — enter details manually"));
      return;
    } finally {
      setVinDecoding(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post("/api/dealer/inventory", {
        vin: vin || undefined,
        year: year ? parseInt(year, 10) : undefined,
        make,
        model,
        trim: trim || undefined,
        mileage: mileage ? parseInt(mileage, 10) : undefined,
        condition,
        priceCents: price ? Math.round(parseFloat(price) * 100) : undefined,
        description: description || undefined,
      });
      router.push("/dealer/inventory");
    } catch (err) {
      setError(apiErrorMessage(err, "Network error. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="add-inventory-page">
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/dealer/inventory"
          className="text-sm text-slate-400 hover:text-al-primary transition-colors"
        >
          ← Inventory
        </Link>
        <h1 className="text-xl font-bold text-slate-900">Add Vehicle</h1>
      </div>

      {error && (
        <div
          role="alert"
          className="bg-al-danger-subtle border border-al-danger/30 text-al-danger-fg rounded-lg px-4 py-3 mb-5 text-sm"
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5" data-testid="add-vehicle-form">
        {/* VIN + Decode */}
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">VIN</label>
          <div className="flex gap-2">
            <input
              value={vin}
              onChange={(e) => setVin(e.target.value)}
              placeholder="Vehicle Identification Number"
              className={INPUT_CLASS + " flex-1"}
              data-testid="vin-input"
            />
            <button
              type="button"
              onClick={handleVinDecode}
              disabled={vinDecoding}
              className="px-4 py-3 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
              data-testid="vin-decode-btn"
            >
              {vinDecoding ? "Decoding…" : "Decode"}
            </button>
          </div>
          {vinDecodeMsg && (
            <p className="text-xs text-al-primary mt-1" data-testid="vin-decode-msg">
              {vinDecodeMsg}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">
              Year <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="2022"
              required
              min={1900}
              max={new Date().getFullYear() + 2}
              className={INPUT_CLASS}
              data-testid="year-input"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">
              Make <span className="text-red-500">*</span>
            </label>
            <input
              value={make}
              onChange={(e) => setMake(e.target.value)}
              placeholder="Toyota"
              required
              className={INPUT_CLASS}
              data-testid="make-input"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">
              Model <span className="text-red-500">*</span>
            </label>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="Camry"
              required
              className={INPUT_CLASS}
              data-testid="model-input"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Trim</label>
            <input
              value={trim}
              onChange={(e) => setTrim(e.target.value)}
              placeholder="XSE (optional)"
              className={INPUT_CLASS}
              data-testid="trim-input"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Mileage</label>
            <input
              type="number"
              value={mileage}
              onChange={(e) => setMileage(e.target.value)}
              placeholder="35000"
              min={0}
              className={INPUT_CLASS}
              data-testid="mileage-input"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Condition</label>
            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              className={INPUT_CLASS}
              data-testid="condition-select"
            >
              {CONDITIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">
            OTD Price ($)
          </label>
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="25000"
            min={0}
            step="0.01"
            className={INPUT_CLASS}
            data-testid="price-input"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">
            Description / Notes
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Any additional details about the vehicle..."
            rows={3}
            className={INPUT_CLASS}
            data-testid="description-input"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-al-primary hover:bg-[#1A6FE0] disabled:opacity-50 text-white font-semibold py-3 rounded-lg transition-colors text-sm"
          data-testid="add-vehicle-submit"
        >
          {loading ? "Adding..." : "Add Vehicle"}
        </button>
      </form>
    </div>
  );
}
