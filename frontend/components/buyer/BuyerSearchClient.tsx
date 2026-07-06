"use client";

import { useState, useEffect, useCallback, useTransition, useMemo, useRef } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import Link from "next/link";
import {
  Search, MapPin, X, SlidersHorizontal, Loader2, Crosshair, Heart,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ALL_MAKES } from "@/components/public/InventorySearchClient";

const BODY_TYPES = ["SUV", "Sedan", "Truck", "Van", "Coupe", "Convertible", "Wagon", "Hatchback"];
const TRANSMISSIONS = ["Automatic", "Manual", "CVT"];
const DRIVETRAINS = ["FWD", "AWD", "RWD", "4WD"];
const FUEL_TYPES = ["Gasoline", "Hybrid", "Electric", "Diesel"];
const CONDITIONS = ["new", "used", "certified pre-owned"];
const DEFAULT_YEAR_MIN = "2010";
const DEFAULT_YEAR_MAX = "2025";
const MILEAGE_OPTIONS = [
  { value: "", label: "Any" },
  { value: "10000", label: "Under 10k" },
  { value: "25000", label: "Under 25k" },
  { value: "50000", label: "Under 50k" },
  { value: "75000", label: "Under 75k" },
  { value: "100000", label: "Under 100k" },
];
const RADIUS_OPTIONS = [10, 25, 50, 100, 200];
const FEATURE_OPTIONS = [
  "Sunroof", "Navigation", "Backup Camera", "Heated Seats",
  "Apple CarPlay", "Android Auto", "Blind Spot Monitor",
  "Lane Assist", "Remote Start", "Third Row", "AWD", "Leather Interior",
];
const SORT_OPTIONS = [
  { value: "newest",     label: "Newest" },
  { value: "price-asc",  label: "Price: Low to High" },
  { value: "price-desc", label: "Price: High to Low" },
  { value: "mileage",    label: "Mileage" },
  { value: "distance",   label: "Distance" },
];

const LANE_INFO: Record<string, { label: string; variant: "green" | "blue" | "gray" }> = {
  LANE_1: { label: "Verified", variant: "green" },
  LANE_2: { label: "Partner",  variant: "blue" },
  LANE_3: { label: "Market",   variant: "gray" },
};

interface Vehicle {
  id: string;
  year: number;
  make: string;
  model: string;
  trim?: string | null;
  mileage?: number | null;
  priceCents: number;
  lane: string;
  images: string[];
  distanceMiles?: number | null;
}

interface SearchResult {
  vehicles: Vehicle[];
  count: number;
  budgetGuarded: boolean;
  maxBudgetCents: number | null;
  activeZip: string | null;
  hasLocalDealerInventory?: boolean | null;
  radiusApplied?: number | null;
}

interface Toast {
  id: number;
  message: string;
  type: "success" | "error";
}

interface Props {
  maxBudgetCents: number | null;
  buyerZip: string | null;
  availableModelsByMake: Record<string, string[]>;
}

export default function BuyerSearchClient({ maxBudgetCents, buyerZip, availableModelsByMake }: Props) {
  const router   = useRouter();
  const pathname = usePathname();
  const sp       = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [drawerOpen, setDrawerOpen]  = useState(false);
  const [locating,   setLocating]    = useState(false);

  // ── filter state synced from URL params ──────────────────────────────────
  const [q,            setQ]           = useState(sp.get("q")            ?? "");
  const [make,         setMake]        = useState(sp.get("make")         ?? "");
  const [model,        setModel]       = useState(sp.get("model")        ?? "");
  const [yearMin,      setYearMin]     = useState(sp.get("yearMin")      ?? "");
  const [yearMax,      setYearMax]     = useState(sp.get("yearMax")      ?? "");
  const [priceMin,     setPriceMin]    = useState(sp.get("priceMin")     ?? "");
  const [priceMax,     setPriceMax]    = useState(sp.get("priceMax")     ?? "");
  const [mileageMax,   setMileageMax]  = useState(sp.get("mileageMax")   ?? "");
  const [condition,    setCondition]   = useState(sp.get("condition")    ?? "");
  const [bodyType,     setBodyType]    = useState(sp.get("bodyType")     ?? "");
  const [transmission, setTransmission] = useState(sp.get("transmission") ?? "");
  const [drivetrain,   setDrivetrain]  = useState(sp.get("drivetrain")   ?? "");
  const [fuelType,     setFuelType]    = useState(sp.get("fuelType")     ?? "");
  // Pre-fill with buyer's profile ZIP when no custom zip is set in URL
  const [zip,          setZip]         = useState(sp.get("zip")          ?? buyerZip ?? "");
  // Default to 50 mi only when we're falling back to the buyer's profile ZIP (not a URL-param zip)
  const [radiusMiles,  setRadiusMiles] = useState(
    sp.get("radiusMiles") ?? (buyerZip && !sp.get("zip") ? "50" : "")
  );
  const [sort,         setSort]        = useState(sp.get("sort")         ?? "newest");
  const [features,     setFeatures]    = useState<string[]>(() => {
    const f = sp.get("features"); return f ? f.split(",").filter(Boolean) : [];
  });

  // ── results & shortlist state ─────────────────────────────────────────────
  const [loading,       setLoading]       = useState(true);
  const [vehicles,      setVehicles]      = useState<Vehicle[]>([]);
  const [totalShown,    setTotalShown]    = useState(0);
  const [hasLocalDealerInventory, setHasLocalDealerInventory] = useState<boolean | null>(null);
  const [shortlisted,   setShortlisted]   = useState<Set<string>>(new Set());
  const [shortlistCount, setShortlistCount] = useState(0);
  const [toasts,        setToasts]        = useState<Toast[]>([]);
  const [searchError,   setSearchError]   = useState<string | null>(null);
  const toastCounter = useRef(0);

  // budget from server (may differ from prop if user has no prequal)
  const budgetDollars = maxBudgetCents !== null ? Math.round(maxBudgetCents / 100) : null;

  // max price the buyer can input in the filter (capped at prequal budget)
  const priceMaxCap = budgetDollars;

  // ── toast helper ──────────────────────────────────────────────────────────
  function showToast(message: string, type: "success" | "error" = "success") {
    const id = ++toastCounter.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }

  // ── URL helpers ──────────────────────────────────────────────────────────
  const buildParams = useCallback((overrides: Record<string, string> = {}) => {
    const next = new URLSearchParams();
    const fields: Record<string, string> = {
      q, make, model, yearMin, yearMax, priceMin, priceMax,
      mileageMax, condition, bodyType, transmission, drivetrain,
      fuelType, zip, radiusMiles, sort, features: features.join(","),
      ...overrides,
    };
    for (const [k, v] of Object.entries(fields)) {
      if (v && v !== "newest") next.set(k, v);
    }
    return next;
  }, [q, make, model, yearMin, yearMax, priceMin, priceMax, mileageMax, condition,
      bodyType, transmission, drivetrain, fuelType, zip, radiusMiles, sort, features]);

  const apply = useCallback((overrides: Record<string, string> = {}) => {
    startTransition(() =>
      router.push(`${pathname}?${buildParams(overrides).toString()}`, { scroll: false })
    );
  }, [buildParams, pathname, router]);

  function clearAll() {
    setQ(""); setMake(""); setModel(""); setYearMin(""); setYearMax("");
    setPriceMin(""); setPriceMax(""); setMileageMax(""); setCondition("");
    setBodyType(""); setTransmission(""); setDrivetrain(""); setFuelType("");
    setZip(""); setRadiusMiles(""); setFeatures([]); setSort("newest");
    startTransition(() => router.push(pathname, { scroll: false }));
  }

  // ── fetch results whenever URL search params change ───────────────────────
  const fetchResults = useCallback(async () => {
    setLoading(true);
    setSearchError(null);
    try {
      const params = new URLSearchParams(sp.toString());
      params.set("limit", "48");
      const res  = await fetch(`/api/buyer/search?${params.toString()}`);
      const data = await res.json() as { success: boolean; data: SearchResult; error?: { message?: string } };
      if (data.success) {
        setVehicles(data.data.vehicles);
        setTotalShown(data.data.count);
        setHasLocalDealerInventory(data.data.hasLocalDealerInventory ?? null);
      } else {
        setSearchError(data.error?.message ?? "We couldn't load search results. Please try again.");
      }
    } catch {
      setSearchError("We couldn't load search results. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [sp]);

  useEffect(() => { void fetchResults(); }, [fetchResults]);

  // ── load shortlist on mount ───────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/buyer/shortlist")
      .then(r => r.json())
      .then((d: { success: boolean; data: { items: { inventoryItemId: string }[]; count: number } }) => {
        if (d.success) {
          setShortlisted(new Set(d.data.items.map(i => i.inventoryItemId)));
          setShortlistCount(d.data.count);
        }
      })
      .catch(() => undefined);
  }, []);

  // ── shortlist handler ─────────────────────────────────────────────────────
  async function addToShortlist(e: React.MouseEvent, vehicleId: string) {
    e.preventDefault();
    e.stopPropagation();
    if (shortlistCount >= 5) { showToast("Your shortlist is full. Remove a vehicle to add this one.", "error"); return; }
    const res = await fetch("/api/buyer/shortlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inventoryItemId: vehicleId }),
    });
    if (res.ok) {
      const newCount = shortlistCount + 1;
      setShortlisted(prev => new Set([...prev, vehicleId]));
      setShortlistCount(newCount);
      showToast(`Added to your shortlist (${newCount}/5)`);
    } else {
      const d = await res.json() as { error?: { code?: string } };
      if (d.error?.code === "SHORTLIST_FULL") showToast("Your shortlist is full.", "error");
    }
  }

  // ── geolocation helper ────────────────────────────────────────────────────
  async function useMyLocation() {
    if (!navigator.geolocation) { alert("Geolocation is not supported by your browser."); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res  = await fetch(`/api/public/geocode/reverse?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`);
          const data = await res.json() as { zip?: string };
          if (data.zip) { setZip(data.zip); apply({ zip: data.zip }); }
          else alert("Could not determine ZIP from your location.");
        } finally { setLocating(false); }
      },
      () => { setLocating(false); alert("Location access denied. Enter ZIP manually."); }
    );
  }

  function toggleFeature(f: string) {
    setFeatures(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]);
  }

  // ── active filter chips ───────────────────────────────────────────────────
  type Chip = { key: string; label: string; clear: () => void };
  const chips: Chip[] = [];
  if (q)           chips.push({ key: "q",           label: `"${q}"`, clear: () => { setQ("");           apply({ q: ""           }); } });
  if (make)        chips.push({ key: "make",        label: make,     clear: () => { setMake("");  setModel(""); apply({ make: "", model: "" }); } });
  if (model)       chips.push({ key: "model",       label: model,    clear: () => { setModel(""); apply({ model: ""       }); } });
  if (yearMin || yearMax) chips.push({ key: "year", label: `Year ${yearMin || DEFAULT_YEAR_MIN}–${yearMax || DEFAULT_YEAR_MAX}`, clear: () => { setYearMin(""); setYearMax(""); apply({ yearMin: "", yearMax: "" }); } });
  if (priceMin || priceMax) chips.push({ key: "price", label: `$${priceMin || "0"}–$${priceMax ? priceMax : "max"}`, clear: () => { setPriceMin(""); setPriceMax(""); apply({ priceMin: "", priceMax: "" }); } });
  if (mileageMax)  chips.push({ key: "mileage",     label: `Under ${parseInt(mileageMax).toLocaleString()} mi`, clear: () => { setMileageMax(""); apply({ mileageMax: "" }); } });
  if (condition)   chips.push({ key: "condition",   label: condition,   clear: () => { setCondition("");   apply({ condition:   "" }); } });
  if (bodyType)    chips.push({ key: "bodyType",    label: bodyType,    clear: () => { setBodyType("");    apply({ bodyType:    "" }); } });
  if (transmission) chips.push({ key: "transmission", label: transmission, clear: () => { setTransmission(""); apply({ transmission: "" }); } });
  if (drivetrain)  chips.push({ key: "drivetrain",  label: drivetrain,  clear: () => { setDrivetrain("");  apply({ drivetrain:  "" }); } });
  if (fuelType)    chips.push({ key: "fuelType",    label: fuelType,    clear: () => { setFuelType("");    apply({ fuelType:    "" }); } });
  if (zip)         chips.push({ key: "zip",         label: `${zip}${radiusMiles ? ` · ${radiusMiles}mi` : ""}`, clear: () => { setZip(""); setRadiusMiles(""); apply({ zip: "", radiusMiles: "" }); } });
  if (features.length > 0) chips.push({ key: "features", label: `${features.length} feature${features.length === 1 ? "" : "s"}`, clear: () => { setFeatures([]); apply({ features: "" }); } });

  const activeCount = chips.length;

  const availableModels = useMemo(() => {
    if (!make) return [];
    return availableModelsByMake[make] ?? availableModelsByMake[make.toLowerCase()] ?? [];
  }, [make, availableModelsByMake]);

  const allMakes = useMemo(() => {
    const set = new Set<string>(ALL_MAKES);
    return Array.from(set).sort();
  }, []);

  const inputCls  = "w-full px-3 py-2 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-al-primary/20 focus:border-al-primary bg-white";
  const labelCls  = "text-[10px] font-bold uppercase tracking-wider text-[#94A3B8] mb-1.5 block";

  return (
    <div className="p-4 md:p-6" data-testid="buyer-search-page">
      {/* Toast notifications */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div key={t.id} className={`px-4 py-3 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2 pointer-events-auto animate-in slide-in-from-right-4 duration-200 ${
            t.type === "error"
              ? "bg-red-50 border border-red-200 text-red-800"
              : "bg-al-primary/10 border border-al-primary/20 text-al-primary"
          }`}>
            {t.message}
            <button onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))} className="ml-2 opacity-60 hover:opacity-100"><X size={12} /></button>
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-slate-900">Search Vehicles</h1>
        <Link href="/buyer/shortlist" data-testid="view-shortlist-link" className="text-sm text-al-primary font-semibold hover:underline">
          My Shortlist ({shortlistCount}/5)
        </Link>
      </div>

      {/* Budget badge — always visible when prequal exists */}
      {budgetDollars !== null && (
        <div
          data-testid="budget-badge"
          className="flex items-center gap-2 px-4 py-3 mb-4 rounded-xl bg-al-primary/10 border border-al-primary/20 text-al-primary text-sm font-medium"
        >
          <span className="text-al-primary">💜</span>
          Showing vehicles within your <strong>${budgetDollars.toLocaleString()}</strong> pre-qualified budget
        </div>
      )}

      {/* Search bar row */}
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-0">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
          <input
            data-testid="vehicle-search-input"
            type="text"
            placeholder="Make, model, trim, keyword..."
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") apply(); }}
            className="w-full pl-9 pr-3 py-2.5 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-al-primary/20 focus:border-al-primary bg-white"
          />
        </div>
        <button
          data-testid="vehicle-search-btn"
          type="button"
          onClick={() => apply()}
          disabled={isPending}
          className="px-4 py-2.5 bg-al-primary hover:bg-al-primary-hover text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-60"
        >
          {isPending ? <Loader2 size={14} className="animate-spin" /> : "Search"}
        </button>
        <button
          data-testid="toggle-filters-btn"
          type="button"
          onClick={() => setDrawerOpen(o => !o)}
          aria-expanded={drawerOpen}
          className="inline-flex items-center gap-1.5 px-3 py-2.5 border border-[#E5E7EB] rounded-lg text-sm relative bg-white hover:bg-[#F8F9FB] hover:text-al-primary transition-colors"
        >
          <SlidersHorizontal size={14} />
          <span className="hidden sm:inline">Filters</span>
          {activeCount > 0 && (
            <span data-testid="active-filter-count" className="bg-al-primary text-white text-[10px] px-1.5 rounded-full">{activeCount}</span>
          )}
        </button>
        <select
          data-testid="sort-select"
          value={sort}
          onChange={e => { setSort(e.target.value); apply({ sort: e.target.value }); }}
          className="hidden md:block px-3 py-2.5 border border-[#E5E7EB] rounded-lg text-xs bg-white"
        >
          {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* Active chips */}
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3" data-testid="active-chips">
          {chips.map(c => (
            <button key={c.key} onClick={c.clear} data-testid={`chip-${c.key}`} type="button"
              className="inline-flex items-center gap-1 bg-[#F0F9FF] hover:bg-[#DBEAFE] text-al-primary text-xs px-2.5 py-1 rounded-full transition-colors">
              {c.label}<X size={11} className="opacity-70" />
            </button>
          ))}
          <button onClick={clearAll} data-testid="clear-all-filters" className="text-xs text-al-primary hover:underline font-semibold ml-1">Clear all</button>
        </div>
      )}

      {/* Desktop inline filter panel */}
      {drawerOpen && (
        <div className="hidden lg:block mb-4" data-testid="filter-panel-desktop">
          <FilterPanel
            allMakes={allMakes} availableModels={availableModels}
            make={make} setMake={setMake} model={model} setModel={setModel}
            yearMin={yearMin} setYearMin={setYearMin} yearMax={yearMax} setYearMax={setYearMax}
            priceMin={priceMin} setPriceMin={setPriceMin} priceMax={priceMax} setPriceMax={setPriceMax}
            priceMaxCap={priceMaxCap}
            mileageMax={mileageMax} setMileageMax={setMileageMax}
            condition={condition} setCondition={setCondition}
            bodyType={bodyType} setBodyType={setBodyType}
            transmission={transmission} setTransmission={setTransmission}
            drivetrain={drivetrain} setDrivetrain={setDrivetrain}
            fuelType={fuelType} setFuelType={setFuelType}
            features={features} toggleFeature={toggleFeature}
            zip={zip} setZip={setZip} radiusMiles={radiusMiles} setRadiusMiles={setRadiusMiles}
            locating={locating} useMyLocation={useMyLocation}
            sort={sort} setSort={setSort}
            inputCls={inputCls} labelCls={labelCls} isPending={isPending}
            onApply={() => apply()} onClear={clearAll} onClose={() => setDrawerOpen(false)}
            variant="inline"
          />
        </div>
      )}

      {/* Mobile slide-up drawer */}
      {drawerOpen && (
        <div className="lg:hidden" data-testid="filter-panel-mobile-wrapper">
          <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
          <div className="fixed left-0 right-0 bottom-0 z-50 bg-white rounded-t-2xl shadow-2xl max-h-[88vh] flex flex-col" role="dialog" aria-label="Filters" data-testid="filter-panel-mobile">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E7EB]">
              <h2 className="text-base font-bold text-[#111827]">Filters{activeCount > 0 && <span className="ml-2 text-al-primary">({activeCount})</span>}</h2>
              <button type="button" onClick={() => setDrawerOpen(false)} aria-label="Close filters" data-testid="filter-drawer-close" className="p-2 rounded-md text-slate-500 hover:bg-slate-100">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-5">
              <FilterPanel
                allMakes={allMakes} availableModels={availableModels}
                make={make} setMake={setMake} model={model} setModel={setModel}
                yearMin={yearMin} setYearMin={setYearMin} yearMax={yearMax} setYearMax={setYearMax}
                priceMin={priceMin} setPriceMin={setPriceMin} priceMax={priceMax} setPriceMax={setPriceMax}
                priceMaxCap={priceMaxCap}
                mileageMax={mileageMax} setMileageMax={setMileageMax}
                condition={condition} setCondition={setCondition}
                bodyType={bodyType} setBodyType={setBodyType}
                transmission={transmission} setTransmission={setTransmission}
                drivetrain={drivetrain} setDrivetrain={setDrivetrain}
                fuelType={fuelType} setFuelType={setFuelType}
                features={features} toggleFeature={toggleFeature}
                zip={zip} setZip={setZip} radiusMiles={radiusMiles} setRadiusMiles={setRadiusMiles}
                locating={locating} useMyLocation={useMyLocation}
                sort={sort} setSort={setSort}
                inputCls={inputCls} labelCls={labelCls}
                variant="drawer"
              />
            </div>
            <div className="flex items-center gap-2 px-5 py-4 border-t border-[#E5E7EB] bg-white">
              <button type="button" data-testid="clear-filters-btn-drawer" onClick={clearAll}
                className="px-4 h-11 rounded-lg border border-[#E5E7EB] text-sm font-semibold text-al-primary hover:bg-[#F8F9FB]">
                Clear
              </button>
              <button type="button" data-testid="show-results-btn"
                onClick={() => { apply(); setDrawerOpen(false); }} disabled={isPending}
                className="flex-1 h-11 rounded-lg bg-al-primary hover:bg-al-primary-hover text-white text-sm font-semibold disabled:opacity-60">
                {isPending ? <Loader2 size={14} className="animate-spin inline" /> : `Show ${totalShown} Results`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search error */}
      {!loading && searchError && (
        <div
          role="alert"
          data-testid="search-error"
          className="bg-red-50 border border-red-200 rounded-xl px-4 py-6 mb-6 text-center"
        >
          <p className="text-sm font-medium text-red-700 mb-3">{searchError}</p>
          <button
            onClick={() => { void fetchResults(); }}
            className="text-sm font-semibold text-white bg-al-primary hover:bg-al-primary-hover px-4 py-2 rounded-lg transition-colors"
            data-testid="search-retry-btn"
          >
            Try again
          </button>
        </div>
      )}

      {/* Results count */}
      {!loading && !searchError && (
        <p className="text-sm text-slate-500 mb-4" data-testid="results-count">
          Showing {vehicles.length} vehicle{vehicles.length !== 1 ? "s" : ""}
          {budgetDollars !== null ? " within your budget" : ""}
        </p>
      )}

      {/* Vehicle grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white border border-slate-200 rounded-xl h-56 animate-pulse" />
          ))}
        </div>
      ) : searchError ? null : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {vehicles.map((v, i) => {
            const laneInfo = LANE_INFO[v.lane] ?? LANE_INFO.LANE_3;
            const added    = shortlisted.has(v.id);
            return (
              <Link key={v.id} href={`/buyer/inventory/${v.id}`} data-testid={`vehicle-card-${i}`} className="block">
                <Card className="overflow-hidden hover:shadow-lg hover:-translate-y-1 transition-all duration-300 h-full">
                  <div className="relative aspect-[16/9] bg-slate-100">
                    {v.images[0] && (
                      <img src={v.images[0]} alt={`${v.year} ${v.make} ${v.model}`} className="w-full h-full object-cover" loading="lazy" />
                    )}
                    <div className="absolute top-2 left-2">
                      <Badge variant={laneInfo.variant}>{laneInfo.label}</Badge>
                    </div>
                    {v.distanceMiles !== null && v.distanceMiles !== undefined && (
                      <div className="absolute bottom-2 right-2 flex items-center gap-1 bg-black/60 text-white text-[10px] font-medium px-2 py-0.5 rounded-full">
                        <MapPin size={10} /> {v.distanceMiles} mi
                      </div>
                    )}
                  </div>
                  <div className="p-4">
                    <h3 className="font-semibold text-slate-900 text-sm">{v.year} {v.make} {v.model}</h3>
                    {v.trim && <p className="text-xs text-slate-500 mt-0.5">{v.trim}</p>}
                    {v.mileage !== null && v.mileage !== undefined && <p className="text-xs text-slate-400 mt-0.5">{v.mileage.toLocaleString()} miles</p>}
                    <div className="flex items-center justify-between mt-3">
                      <p className="text-lg font-bold text-al-primary">${(v.priceCents / 100).toLocaleString()}</p>
                      <button
                        onClick={(e) => { void addToShortlist(e, v.id); }}
                        disabled={added || shortlistCount >= 5}
                        data-testid={`shortlist-add-btn-${i}`}
                        className={`flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${
                          added              ? "bg-green-100 text-green-700" :
                          shortlistCount >= 5 ? "bg-slate-100 text-slate-400 cursor-not-allowed" :
                                               "bg-al-primary/10 text-al-primary hover:bg-al-primary hover:text-white"
                        }`}
                      >
                        <Heart size={12} fill={added ? "currentColor" : "none"} />
                        {added ? "Added" : "Shortlist"}
                      </button>
                    </div>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {!loading && !searchError && vehicles.length === 0 && (
        <NoInventoryState
          hasLocalDealerInventory={hasLocalDealerInventory}
          buyerZip={zip || buyerZip || null}
          radiusMiles={radiusMiles ? parseInt(radiusMiles) : null}
        />
      )}
    </div>
  );
}

// ─── Filter Panel ──────────────────────────────────────────────────────────────

interface FilterPanelProps {
  allMakes: string[]; availableModels: string[];
  make: string; setMake: (v: string) => void;
  model: string; setModel: (v: string) => void;
  yearMin: string; setYearMin: (v: string) => void;
  yearMax: string; setYearMax: (v: string) => void;
  priceMin: string; setPriceMin: (v: string) => void;
  priceMax: string; setPriceMax: (v: string) => void;
  priceMaxCap: number | null;
  mileageMax: string; setMileageMax: (v: string) => void;
  condition: string; setCondition: (v: string) => void;
  bodyType: string; setBodyType: (v: string) => void;
  transmission: string; setTransmission: (v: string) => void;
  drivetrain: string; setDrivetrain: (v: string) => void;
  fuelType: string; setFuelType: (v: string) => void;
  features: string[]; toggleFeature: (f: string) => void;
  zip: string; setZip: (v: string) => void;
  radiusMiles: string; setRadiusMiles: (v: string) => void;
  locating: boolean; useMyLocation: () => void;
  sort: string; setSort: (v: string) => void;
  inputCls: string; labelCls: string;
  isPending?: boolean;
  onApply?: () => void; onClear?: () => void; onClose?: () => void;
  variant: "inline" | "drawer";
}

function FilterPanel(p: FilterPanelProps) {
  const isInline = p.variant === "inline";
  return (
    <>
      <div className={`bg-white border ${isInline ? "border-[#E5E7EB] rounded-xl p-4" : "border-transparent"} grid grid-cols-2 ${isInline ? "lg:grid-cols-4 xl:grid-cols-6" : ""} gap-3`}>
        {/* Make */}
        <div>
          <label className={p.labelCls}>Make</label>
          <select data-testid="filter-make" className={p.inputCls} value={p.make} onChange={e => { p.setMake(e.target.value); p.setModel(""); }}>
            <option value="">All Makes</option>
            {p.allMakes.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        {/* Model */}
        <div>
          <label className={p.labelCls}>Model</label>
          <select data-testid="filter-model" className={p.inputCls} value={p.model} onChange={e => p.setModel(e.target.value)} disabled={!p.make}>
            <option value="">All Models</option>
            {p.availableModels.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        {/* Year Min */}
        <div>
          <label className={p.labelCls}>Year Min</label>
          <input data-testid="filter-year-min" type="number" min={parseInt(DEFAULT_YEAR_MIN)} max={parseInt(DEFAULT_YEAR_MAX)} placeholder={DEFAULT_YEAR_MIN} className={p.inputCls} value={p.yearMin} onChange={e => p.setYearMin(e.target.value)} />
        </div>
        {/* Year Max */}
        <div>
          <label className={p.labelCls}>Year Max</label>
          <input data-testid="filter-year-max" type="number" min={parseInt(DEFAULT_YEAR_MIN)} max={parseInt(DEFAULT_YEAR_MAX)} placeholder={DEFAULT_YEAR_MAX} className={p.inputCls} value={p.yearMax} onChange={e => p.setYearMax(e.target.value)} />
        </div>
        {/* Price Min */}
        <div>
          <label className={p.labelCls}>Price Min ($)</label>
          <input data-testid="filter-price-min" type="number" min={0} placeholder="0" className={p.inputCls} value={p.priceMin} onChange={e => p.setPriceMin(e.target.value)} />
        </div>
        {/* Price Max — capped at prequal budget */}
        <div>
          <label className={p.labelCls}>
            Price Max ($)
            {p.priceMaxCap !== null && (
              <span className="ml-1 text-al-primary normal-case font-semibold">
                · Your max: ${p.priceMaxCap.toLocaleString()}
              </span>
            )}
          </label>
          <input
            data-testid="filter-price-max"
            type="number"
            min={0}
            max={p.priceMaxCap ?? undefined}
            placeholder={p.priceMaxCap !== null ? p.priceMaxCap.toLocaleString() : "No limit"}
            className={p.inputCls}
            value={p.priceMax}
            onChange={e => {
              const v = e.target.value;
              if (p.priceMaxCap !== null && v && parseInt(v) > p.priceMaxCap) {
                p.setPriceMax(String(p.priceMaxCap));
              } else {
                p.setPriceMax(v);
              }
            }}
          />
        </div>
        {/* Mileage */}
        <div>
          <label className={p.labelCls}>Mileage</label>
          <select data-testid="filter-mileage" className={p.inputCls} value={p.mileageMax} onChange={e => p.setMileageMax(e.target.value)}>
            {MILEAGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        {/* Condition */}
        <div>
          <label className={p.labelCls}>Condition</label>
          <select data-testid="filter-condition" className={p.inputCls} value={p.condition} onChange={e => p.setCondition(e.target.value)}>
            <option value="">All</option>
            {CONDITIONS.map(c => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
          </select>
        </div>
        {/* Body Type */}
        <div>
          <label className={p.labelCls}>Body Type</label>
          <select data-testid="filter-body" className={p.inputCls} value={p.bodyType} onChange={e => p.setBodyType(e.target.value)}>
            <option value="">Any</option>
            {BODY_TYPES.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        {/* Transmission */}
        <div>
          <label className={p.labelCls}>Transmission</label>
          <select data-testid="filter-transmission" className={p.inputCls} value={p.transmission} onChange={e => p.setTransmission(e.target.value)}>
            <option value="">All</option>
            {TRANSMISSIONS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        {/* Drivetrain */}
        <div>
          <label className={p.labelCls}>Drivetrain</label>
          <select data-testid="filter-drivetrain" className={p.inputCls} value={p.drivetrain} onChange={e => p.setDrivetrain(e.target.value)}>
            <option value="">All</option>
            {DRIVETRAINS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        {/* Fuel Type */}
        <div>
          <label className={p.labelCls}>Fuel</label>
          <select data-testid="filter-fuel" className={p.inputCls} value={p.fuelType} onChange={e => p.setFuelType(e.target.value)}>
            <option value="">All</option>
            {FUEL_TYPES.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        {/* Location */}
        <div className={`col-span-2 ${isInline ? "lg:col-span-2" : ""}`}>
          <label className={p.labelCls}>ZIP Code</label>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <MapPin size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
              <input data-testid="filter-zip" type="text" placeholder="Enter ZIP code"
                maxLength={5} pattern="[0-9]{5}"
                className="w-full pl-8 pr-2 py-2 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-al-primary/20 focus:border-al-primary"
                value={p.zip} onChange={e => p.setZip(e.target.value.replace(/\D/g, ""))} />
            </div>
            <button type="button" data-testid="use-my-location-btn"
              onClick={p.useMyLocation} disabled={p.locating}
              className="inline-flex items-center gap-1 px-2.5 py-2 border border-[#E5E7EB] rounded-lg text-xs hover:bg-[#F8F9FB] hover:text-al-primary transition-colors"
              title="Use my location">
              {p.locating ? <Loader2 size={13} className="animate-spin" /> : <Crosshair size={13} />}
            </button>
          </div>
          {p.zip.length === 5 && (
            <select data-testid="filter-radius" className="w-full mt-2 px-3 py-2 border border-[#E5E7EB] rounded-lg text-xs"
              value={p.radiusMiles} onChange={e => p.setRadiusMiles(e.target.value)}>
              <option value="">Default (50 mi)</option>
              {RADIUS_OPTIONS.map(r => <option key={r} value={r}>{r} miles</option>)}
            </select>
          )}
        </div>
        {/* Sort (drawer only) */}
        {!isInline && (
          <div className="col-span-2">
            <label className={p.labelCls}>Sort By</label>
            <select className={p.inputCls} value={p.sort} onChange={e => p.setSort(e.target.value)}>
              {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        )}
        {/* Features */}
        <div className={`col-span-2 ${isInline ? "lg:col-span-4 xl:col-span-6" : ""}`}>
          <label className={p.labelCls}>
            Features {p.features.length > 0 && <span className="text-al-primary">({p.features.length} selected)</span>}
          </label>
          <div className="flex flex-wrap gap-1.5" data-testid="filter-features">
            {FEATURE_OPTIONS.map(f => {
              const on = p.features.includes(f);
              return (
                <button key={f} type="button"
                  data-testid={`filter-feature-${f.toLowerCase().replace(/\s+/g, "-")}`}
                  onClick={() => p.toggleFeature(f)}
                  className={`text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors ${
                    on ? "bg-al-primary border-al-primary text-white" : "bg-white border-[#E5E7EB] text-[#4B5563] hover:border-[#93C5FD] hover:text-al-primary"
                  }`}>{f}</button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Inline panel footer */}
        {isInline && (
          <div className="flex items-center gap-2 mt-3">
            <button type="button" data-testid="apply-filters-btn" onClick={p.onApply} disabled={p.isPending}
              className="px-5 py-2 bg-al-primary hover:bg-al-primary-hover text-white rounded-lg text-xs font-semibold disabled:opacity-60">
              {p.isPending ? <Loader2 size={13} className="animate-spin inline" /> : "Apply Filters"}
            </button>
            <button type="button" data-testid="clear-filters-btn" onClick={p.onClear}
              className="px-5 py-2 border border-[#E5E7EB] hover:bg-[#F8F9FB] rounded-lg text-xs font-semibold">
              Clear
            </button>
            {p.onClose && (
              <button type="button" onClick={p.onClose} data-testid="close-filters-btn"
                className="ml-auto px-3 py-2 text-xs font-semibold text-slate-500 hover:text-al-primary">
                Close
              </button>
            )}
          </div>
        )}
    </>
  );
}

// ─── NoInventoryState ──────────────────────────────────────────────────────────

function NoInventoryState({
  hasLocalDealerInventory,
  buyerZip,
  radiusMiles,
}: {
  hasLocalDealerInventory: boolean | null;
  buyerZip: string | null;
  radiusMiles: number | null;
}) {
  const isGeoSearch = !!buyerZip && !!radiusMiles;
  const noDealersInArea = isGeoSearch && hasLocalDealerInventory === false;

  if (noDealersInArea) {
    return (
      <div
        className="max-w-lg mx-auto text-center py-16 px-6"
        data-testid="no-dealers-in-area"
      >
        <div className="w-16 h-16 rounded-full bg-al-primary-subtle flex items-center justify-center mx-auto mb-6">
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"
            viewBox="0 0 24 24" fill="none" stroke="#0B5FD1" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="10" r="3"/>
            <path d="M12 2a8 8 0 0 0-8 8c0 5.4 7.4 12.5 7.7 12.8a.5.5 0 0 0 .6 0C12.6 22.5 20 15.4 20 10a8 8 0 0 0-8-8z"/>
          </svg>
        </div>

        <h2 className="text-xl font-bold text-[#111827] mb-3">
          No AutoLenis dealers in your area yet
        </h2>
        <p className="text-[#4B5563] text-sm leading-relaxed mb-2">
          We don&apos;t currently have any onboarded dealers within{" "}
          <strong>{radiusMiles} miles</strong> of{" "}
          <strong>{buyerZip}</strong>.
        </p>
        <p className="text-[#4B5563] text-sm leading-relaxed mb-8">
          Submit a Vehicle Request and our team will actively search for the
          vehicle you want in your area — including from our growing dealer
          network.
        </p>

        <a
          href="/buyer/requests/new"
          data-testid="submit-vehicle-request-cta"
          className="inline-flex items-center gap-2 px-8 py-4 bg-al-primary text-white font-semibold text-sm rounded-xl hover:bg-al-primary-hover transition-colors"
        >
          Submit a Vehicle Request
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        </a>

        <p className="text-xs text-[#6B7280] mt-6">
          Or try expanding your search radius in the filters above
        </p>
      </div>
    );
  }

  return (
    <div
      className="text-center py-20 text-slate-400"
      data-testid="no-results"
    >
      <p className="text-lg font-medium text-slate-600 mb-2">No vehicles found</p>
      <p className="text-sm">Try adjusting your filters or expanding your search radius</p>
      <a
        href="/buyer/requests/new"
        className="inline-flex items-center gap-1.5 mt-6 text-sm font-semibold text-al-primary hover:text-al-primary-hover transition-colors"
        data-testid="no-results-request-cta"
      >
        Can&apos;t find what you&apos;re looking for? Submit a request →
      </a>
    </div>
  );
}
