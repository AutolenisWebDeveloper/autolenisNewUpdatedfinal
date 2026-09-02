"use client";

import { useState } from "react";
import { Search, Plus, CheckCircle, Car, DollarSign, Gauge } from "lucide-react";

interface SearchResult {
  vin: string; make: string; model: string; year: number; trim?: string;
  price: number; mileage: number; imageUrl?: string; condition?: string;
  exteriorColor?: string; source: string; alreadyInInventory: boolean;
}

const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];

// Why the admin is looking at these rows. "Internal DB (fallback)" used to cover three very
// different situations — and a fourth, worse one: `source` was set to "marketcheck" BEFORE
// the request, so a failed provider call returned an empty list still labelled MarketCheck.
// An empty market and a broken integration must not look identical.
const SOURCE_LABELS: Record<string, string> = {
  marketcheck: "MarketCheck API",
  db: "Internal DB",
  db_provider_error: "Internal DB — MarketCheck call failed",
  db_budget_exhausted: "Internal DB — monthly MarketCheck budget spent",
};

export default function AdminInventorySearchTool() {
  const [form, setForm] = useState({
    make: "", model: "", yearMin: "", yearMax: "", zip: "", maxPrice: "", condition: "all",
  });
  const [results, setResults] = useState<SearchResult[]>([]);
  const [source, setSource] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingVin, setAddingVin] = useState<string | null>(null);
  const [addedVins, setAddedVins] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  function showToast(msg: string, type: "success" | "error" = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null); setSearched(false);
    try {
      const payload: Record<string, unknown> = { condition: form.condition };
      if (form.make) payload.make = form.make;
      if (form.model) payload.model = form.model;
      if (form.yearMin) payload.yearMin = Number(form.yearMin);
      if (form.yearMax) payload.yearMax = Number(form.yearMax);
      if (form.zip) payload.zip = form.zip;
      if (form.maxPrice) payload.maxPrice = Number(form.maxPrice);

      const res = await fetch("/api/admin/inventory/search-tool/run", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const data = await res.json() as { success?: boolean; data?: SearchResult[]; source?: string; error?: string };
      if (!res.ok) { setError(data.error ?? "Search failed"); } else {
        setResults(data.data ?? []);
        setSource(data.source ?? "");
        setSearched(true);
      }
    } catch { setError("Network error. Please try again."); } finally { setLoading(false); }
  }

  async function addToInventory(vehicle: SearchResult) {
    setAddingVin(vehicle.vin);
    try {
      const res = await fetch("/api/admin/inventory/search-tool/add", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vehicle),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (res.ok) {
        setAddedVins(prev => new Set([...prev, vehicle.vin]));
        setResults(prev => prev.map(r => r.vin === vehicle.vin ? { ...r, alreadyInInventory: true } : r));
        showToast(`${vehicle.year} ${vehicle.make} ${vehicle.model} added to inventory`);
      } else {
        showToast(data.error ?? "Failed to add vehicle", "error");
      }
    } catch { showToast("Network error", "error"); } finally { setAddingVin(null); }
  }

  return (
    <div className="p-6 md:p-8 max-w-6xl">
      {toast && (
        <div data-testid="search-toast" className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg text-sm font-medium shadow-lg ${toast.type === "success" ? "bg-green-600 text-white" : "bg-red-600 text-white"}`}>
          {toast.msg}
        </div>
      )}

      <div className="flex items-center gap-3 mb-6">
        <Search size={22} className="text-al-primary" />
        <div>
          <h1 className="text-xl font-bold text-slate-900">Inventory Search Tool</h1>
          <p className="text-sm text-slate-400">Search MarketCheck or local inventory and add vehicles directly</p>
        </div>
      </div>

      {/* Search Form */}
      <form onSubmit={runSearch} data-testid="inventory-search-form" className="bg-white border border-slate-200 rounded-xl p-6 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-xs text-slate-500 font-medium mb-1">Make</label>
            <input data-testid="search-make" placeholder="e.g. Toyota" value={form.make} onChange={e => setForm(f => ({...f, make: e.target.value}))} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 font-medium mb-1">Model</label>
            <input data-testid="search-model" placeholder="e.g. Camry" value={form.model} onChange={e => setForm(f => ({...f, model: e.target.value}))} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 font-medium mb-1">Condition</label>
            <select data-testid="search-condition" value={form.condition} onChange={e => setForm(f => ({...f, condition: e.target.value}))} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
              <option value="all">All</option>
              <option value="used">Used</option>
              <option value="new">New</option>
              <option value="certified">Certified Pre-Owned</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 font-medium mb-1">Year Min</label>
            <input data-testid="search-year-min" type="number" placeholder="2015" min="1990" max="2030" value={form.yearMin} onChange={e => setForm(f => ({...f, yearMin: e.target.value}))} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 font-medium mb-1">Year Max</label>
            <input data-testid="search-year-max" type="number" placeholder="2025" min="1990" max="2030" value={form.yearMax} onChange={e => setForm(f => ({...f, yearMax: e.target.value}))} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 font-medium mb-1">ZIP Code</label>
            <input data-testid="search-zip" placeholder="e.g. 90210" value={form.zip} onChange={e => setForm(f => ({...f, zip: e.target.value}))} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 font-medium mb-1">Max Price ($)</label>
            <input data-testid="search-max-price" type="number" placeholder="50000" min="0" value={form.maxPrice} onChange={e => setForm(f => ({...f, maxPrice: e.target.value}))} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
          </div>
        </div>
        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
        <button data-testid="search-submit" type="submit" disabled={loading} className="flex items-center gap-2 bg-al-primary hover:bg-purple-800 disabled:opacity-50 text-white px-6 py-2.5 rounded-lg text-sm font-semibold transition-colors">
          <Search size={15} /> {loading ? "Searching..." : "Search"}
        </button>
      </form>

      {/* Results */}
      {searched && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-slate-500">
              {results.length} result{results.length !== 1 ? "s" : ""} found
              {source && <span className="ml-2 text-xs bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">{SOURCE_LABELS[source] ?? "Internal DB (fallback)"}</span>}
            </p>
          </div>
          {results.length === 0 ? (
            <div className="text-center py-16 bg-white border border-slate-200 rounded-xl">
              <Car className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 text-sm">No vehicles found matching your criteria.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {results.map((vehicle) => (
                <div key={vehicle.vin} data-testid={`result-${vehicle.vin}`} className="bg-white border border-slate-200 rounded-xl overflow-hidden hover:border-al-primary/30 transition-colors">
                  {vehicle.imageUrl ? (
                    <img src={vehicle.imageUrl} alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`} className="w-full h-40 object-cover" />
                  ) : (
                    <div className="w-full h-40 bg-slate-100 flex items-center justify-center">
                      <Car className="w-12 h-12 text-slate-300" />
                    </div>
                  )}
                  <div className="p-4">
                    <p className="font-semibold text-slate-900 text-sm">{vehicle.year} {vehicle.make} {vehicle.model}</p>
                    {vehicle.trim && <p className="text-xs text-slate-400 mt-0.5">{vehicle.trim}</p>}
                    <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                      <span className="flex items-center gap-1"><DollarSign size={11} />{vehicle.price.toLocaleString()}</span>
                      <span className="flex items-center gap-1"><Gauge size={11} />{vehicle.mileage.toLocaleString()} mi</span>
                    </div>
                    {vehicle.exteriorColor && <p className="text-xs text-slate-400 mt-1 capitalize">{vehicle.exteriorColor}</p>}
                    <p className="text-xs text-slate-300 font-mono mt-2 truncate">{vehicle.vin}</p>
                    <div className="mt-3">
                      {vehicle.alreadyInInventory || addedVins.has(vehicle.vin) ? (
                        <div data-testid={`already-in-inv-${vehicle.vin}`} className="flex items-center gap-1.5 text-green-600 text-xs font-medium">
                          <CheckCircle size={13} /> Already in inventory
                        </div>
                      ) : (
                        <button
                          data-testid={`add-to-inv-${vehicle.vin}`}
                          onClick={() => addToInventory(vehicle)}
                          disabled={addingVin === vehicle.vin}
                          className="flex items-center gap-1.5 bg-al-primary hover:bg-purple-800 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-medium w-full justify-center transition-colors"
                        >
                          <Plus size={12} /> {addingVin === vehicle.vin ? "Adding..." : "Add to Inventory"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
