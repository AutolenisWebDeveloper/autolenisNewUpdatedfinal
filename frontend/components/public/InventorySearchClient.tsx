"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useEffect, useTransition, useMemo, useCallback } from "react";
import { Search, MapPin, X, SlidersHorizontal, Loader2, Crosshair } from "lucide-react";

export const ALL_MAKES = [
  "Toyota", "Honda", "Ford", "Chevrolet", "BMW", "Tesla", "Mercedes-Benz", "Audi",
  "Lexus", "Acura", "Nissan", "Hyundai", "Kia", "Subaru", "Jeep", "Ram", "GMC",
  "Cadillac", "Volvo", "Mazda", "Volkswagen", "Porsche", "Infiniti", "Dodge",
  "Chrysler", "Buick", "Lincoln", "Genesis", "Rivian", "Lucid",
];

const BODY_TYPES = ["SUV", "Sedan", "Truck", "Van", "Coupe", "Convertible", "Wagon", "Hatchback"];
const TRANSMISSIONS = ["Automatic", "Manual", "CVT"];
const DRIVETRAINS = ["FWD", "AWD", "RWD", "4WD"];
const FUEL_TYPES = ["Gasoline", "Hybrid", "Electric", "Diesel"];
const CONDITIONS = ["new", "used"];
const COLORS = [
  { name: "Black", hex: "#1A1A1A" }, { name: "White", hex: "#F5F5F5" }, { name: "Silver", hex: "#C8C8C8" },
  { name: "Gray", hex: "#7A7A7A" }, { name: "Red", hex: "#C42E2E" }, { name: "Blue", hex: "#1D4ED8" },
  { name: "Green", hex: "#2E8B57" }, { name: "Brown", hex: "#5C3D2E" },
];
const MILEAGE_OPTIONS = [
  { value: "", label: "Any" }, { value: "10000", label: "Under 10k" },
  { value: "25000", label: "Under 25k" }, { value: "50000", label: "Under 50k" },
  { value: "75000", label: "Under 75k" }, { value: "100000", label: "Under 100k" },
];
const RADIUS_OPTIONS = [10, 25, 50, 100, 200];
const FEATURE_OPTIONS = [
  "Sunroof", "Navigation", "Backup Camera", "Heated Seats",
  "Apple CarPlay", "Android Auto", "Blind Spot Monitor",
  "Lane Assist", "Remote Start", "Third Row",
];
const SORT_OPTIONS = [
  { value: "relevance", label: "Most Relevant" },
  { value: "price-asc", label: "Price: Low to High" },
  { value: "price-desc", label: "Price: High to Low" },
  { value: "newest", label: "Newest" },
  { value: "mileage", label: "Mileage" },
  { value: "distance", label: "Distance" },
];

interface Props { availableMakes: string[]; availableModelsByMake: Record<string, string[]> }

export default function InventorySearchClient({ availableMakes, availableModelsByMake }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [locating, setLocating] = useState(false);

  // Combined make set: known + present in inventory
  const allMakes = useMemo(() => {
    const set = new Set<string>([...ALL_MAKES, ...availableMakes]);
    return Array.from(set).sort();
  }, [availableMakes]);

  // Local form state synced with URL
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [make, setMake] = useState(sp.get("make") ?? "");
  const [model, setModel] = useState(sp.get("model") ?? "");
  const [yearMin, setYearMin] = useState(sp.get("yearMin") ?? "");
  const [yearMax, setYearMax] = useState(sp.get("yearMax") ?? "");
  const [priceMin, setPriceMin] = useState(sp.get("priceMin") ?? "");
  const [priceMax, setPriceMax] = useState(sp.get("priceMax") ?? "");
  const [mileageMax, setMileageMax] = useState(sp.get("mileageMax") ?? "");
  const [condition, setCondition] = useState(sp.get("condition") ?? "");
  const [bodyType, setBodyType] = useState(sp.get("bodyType") ?? "");
  const [transmission, setTransmission] = useState(sp.get("transmission") ?? "");
  const [drivetrain, setDrivetrain] = useState(sp.get("drivetrain") ?? "");
  const [fuelType, setFuelType] = useState(sp.get("fuelType") ?? "");
  const [color, setColor] = useState(sp.get("color") ?? "");
  const [zip, setZip] = useState(sp.get("zip") ?? "");
  const [radiusMiles, setRadiusMiles] = useState(sp.get("radiusMiles") ?? "");
  const [features, setFeatures] = useState<string[]>(() => {
    const f = sp.get("features");
    return f ? f.split(",").filter(Boolean) : [];
  });
  const [sort, setSort] = useState(sp.get("sort") ?? "relevance");

  const availableModels = useMemo(() => {
    if (!make) return [];
    return availableModelsByMake[make] ?? availableModelsByMake[make.toLowerCase()] ?? [];
  }, [make, availableModelsByMake]);

  const apply = useCallback((overrides: Record<string, string> = {}) => {
    const next = new URLSearchParams();
    const fields: Record<string, string> = {
      q, make, model, yearMin, yearMax, priceMin, priceMax, mileageMax, condition,
      bodyType, transmission, drivetrain, fuelType, color, zip, radiusMiles, sort,
      features: features.join(","),
      ...overrides,
    };
    for (const [k, v] of Object.entries(fields)) {
      if (v && v !== "relevance") next.set(k, v);
    }
    startTransition(() => router.push(`${pathname}?${next.toString()}`));
  }, [q, make, model, yearMin, yearMax, priceMin, priceMax, mileageMax, condition, bodyType, transmission, drivetrain, fuelType, color, zip, radiusMiles, features, sort, pathname, router]);

  // Sync sort changes immediately
  useEffect(() => {
    const cur = sp.get("sort") ?? "relevance";
    if (cur !== sort) apply();
  }, [sort, sp, apply]);

  function clearAll() {
    setQ(""); setMake(""); setModel(""); setYearMin(""); setYearMax("");
    setPriceMin(""); setPriceMax(""); setMileageMax(""); setCondition("");
    setBodyType(""); setTransmission(""); setDrivetrain(""); setFuelType("");
    setColor(""); setZip(""); setRadiusMiles(""); setFeatures([]); setSort("relevance");
    startTransition(() => router.push(pathname));
  }

  function toggleFeature(f: string) {
    setFeatures(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]);
  }

  async function useMyLocation() {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await fetch(`/api/public/geocode/reverse?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`);
          const data = await res.json() as { zip?: string };
          if (data.zip) { setZip(data.zip); apply({ zip: data.zip }); }
          else alert("Could not determine ZIP from your location.");
        } finally { setLocating(false); }
      },
      () => { setLocating(false); alert("Location access denied. Enter ZIP manually."); }
    );
  }

  // Active filter chips list
  type Chip = { key: string; label: string; clear: () => void };
  const chips: Chip[] = [];
  if (q) chips.push({ key: "q", label: `"${q}"`, clear: () => { setQ(""); apply({ q: "" }); } });
  if (make) chips.push({ key: "make", label: make, clear: () => { setMake(""); setModel(""); apply({ make: "", model: "" }); } });
  if (model) chips.push({ key: "model", label: model, clear: () => { setModel(""); apply({ model: "" }); } });
  if (yearMin || yearMax) chips.push({ key: "year", label: `Year ${yearMin || "2010"}–${yearMax || "2025"}`, clear: () => { setYearMin(""); setYearMax(""); apply({ yearMin: "", yearMax: "" }); } });
  if (priceMin || priceMax) chips.push({ key: "price", label: `$${priceMin || "0"}–$${priceMax || "∞"}`, clear: () => { setPriceMin(""); setPriceMax(""); apply({ priceMin: "", priceMax: "" }); } });
  if (mileageMax) chips.push({ key: "mileage", label: `Under ${parseInt(mileageMax).toLocaleString()} mi`, clear: () => { setMileageMax(""); apply({ mileageMax: "" }); } });
  if (condition) chips.push({ key: "condition", label: condition, clear: () => { setCondition(""); apply({ condition: "" }); } });
  if (bodyType) chips.push({ key: "bodyType", label: bodyType, clear: () => { setBodyType(""); apply({ bodyType: "" }); } });
  if (transmission) chips.push({ key: "transmission", label: transmission, clear: () => { setTransmission(""); apply({ transmission: "" }); } });
  if (drivetrain) chips.push({ key: "drivetrain", label: drivetrain, clear: () => { setDrivetrain(""); apply({ drivetrain: "" }); } });
  if (fuelType) chips.push({ key: "fuelType", label: fuelType, clear: () => { setFuelType(""); apply({ fuelType: "" }); } });
  if (color) chips.push({ key: "color", label: color, clear: () => { setColor(""); apply({ color: "" }); } });
  if (zip) chips.push({ key: "zip", label: `${zip}${radiusMiles ? ` · ${radiusMiles}mi` : ""}`, clear: () => { setZip(""); setRadiusMiles(""); apply({ zip: "", radiusMiles: "" }); } });
  if (features.length > 0) chips.push({ key: "features", label: `${features.length} feature${features.length === 1 ? "" : "s"}`, clear: () => { setFeatures([]); apply({ features: "" }); } });

  const activeCount = chips.length;
  const inputCls = "w-full px-3 py-2 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/20 focus:border-[#0B5FD1] bg-white";
  const labelCls = "text-[10px] font-bold uppercase tracking-wider text-[#94A3B8] mb-1.5 block";

  return (
    <div className="w-full">
      {/* Search bar */}
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-0">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
          <input
            data-testid="search-input"
            type="text"
            placeholder="Make, model, trim, keyword..."
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") apply(); }}
            className="w-full pl-9 pr-3 py-2.5 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/20 focus:border-[#0B5FD1] bg-white"
          />
        </div>
        <button
          type="button"
          data-testid="apply-search-btn"
          onClick={() => apply()}
          disabled={isPending}
          className="px-4 py-2.5 bg-[#0B5FD1] hover:bg-[#0A4DB8] text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-60"
        >
          {isPending ? <Loader2 size={14} className="animate-spin" /> : "Search"}
        </button>
        <button
          type="button"
          data-testid="toggle-filters-btn"
          onClick={() => setDrawerOpen(o => !o)}
          aria-expanded={drawerOpen}
          className="inline-flex items-center gap-1.5 px-3 py-2.5 border border-[#E5E7EB] rounded-lg text-sm relative bg-white hover:bg-[#F8F9FB] hover:text-[#0B5FD1] transition-colors"
        >
          <SlidersHorizontal size={14} />
          <span className="hidden sm:inline">Filters</span>
          {activeCount > 0 && (
            <span data-testid="active-filter-count"
              className="bg-[#0B5FD1] text-white text-[10px] px-1.5 rounded-full">{activeCount}</span>
          )}
        </button>
        <select
          data-testid="sort-select"
          value={sort}
          onChange={e => setSort(e.target.value)}
          className="hidden md:block px-3 py-2.5 border border-[#E5E7EB] rounded-lg text-xs bg-white"
        >
          {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* Active chips — always visible below the search bar */}
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3" data-testid="active-chips">
          {chips.map(c => (
            <button key={c.key} onClick={c.clear} data-testid={`chip-${c.key}`} type="button"
              className="inline-flex items-center gap-1 bg-[#F0F9FF] hover:bg-[#DBEAFE] text-[#0B5FD1] text-xs px-2.5 py-1 rounded-full transition-colors">
              {c.label}
              <X size={11} className="opacity-70" />
            </button>
          ))}
          <button onClick={clearAll} data-testid="clear-all-filters" className="text-xs text-[#0B5FD1] hover:underline font-semibold ml-1">Clear all</button>
        </div>
      )}

      {/* Desktop (lg+) — inline collapsible panel below search.
          When closed, no panel is rendered so results sit immediately under chips and never overlap. */}
      {drawerOpen && (
        <div className="hidden lg:block mb-4" data-testid="filter-panel-desktop">
          <FilterFields
            allMakes={allMakes} availableModels={availableModels} make={make} setMake={setMake}
            model={model} setModel={setModel} yearMin={yearMin} setYearMin={setYearMin}
            yearMax={yearMax} setYearMax={setYearMax} priceMin={priceMin} setPriceMin={setPriceMin}
            priceMax={priceMax} setPriceMax={setPriceMax} mileageMax={mileageMax} setMileageMax={setMileageMax}
            condition={condition} setCondition={setCondition} bodyType={bodyType} setBodyType={setBodyType}
            transmission={transmission} setTransmission={setTransmission} drivetrain={drivetrain} setDrivetrain={setDrivetrain}
            fuelType={fuelType} setFuelType={setFuelType} color={color} setColor={setColor}
            features={features} toggleFeature={toggleFeature}
            zip={zip} setZip={setZip} radiusMiles={radiusMiles} setRadiusMiles={setRadiusMiles}
            locating={locating} useMyLocation={useMyLocation}
            onApply={() => apply()} onClear={clearAll} isPending={isPending}
            inputCls={inputCls} labelCls={labelCls}
            sort={sort} setSort={setSort} mobileSort
            onClose={() => setDrawerOpen(false)}
            variant="inline"
          />
        </div>
      )}

      {/* Mobile + Tablet (<lg) — slide-up bottom drawer with backdrop. Never overlaps results
          when closed; when open it floats over the page with a 'Show Results' footer that closes it. */}
      {drawerOpen && (
        <div className="lg:hidden" data-testid="filter-panel-mobile-wrapper">
          <div
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => setDrawerOpen(false)}
            data-testid="filter-drawer-backdrop"
            aria-hidden="true"
          />
          <div
            className="fixed left-0 right-0 bottom-0 z-50 bg-white rounded-t-2xl shadow-2xl max-h-[88vh] flex flex-col animate-fadein"
            data-testid="filter-panel-mobile"
            role="dialog"
            aria-label="Filters"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E7EB]">
              <h2 className="text-base font-bold text-[#111827]">Filters{activeCount > 0 && <span className="ml-2 text-[#0B5FD1]">({activeCount})</span>}</h2>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close filters"
                data-testid="filter-drawer-close"
                className="p-2 rounded-md text-slate-500 hover:bg-slate-100"
              >
                <X size={18} />
              </button>
            </div>
            {/* Body — scrolls */}
            <div className="flex-1 overflow-y-auto px-5 py-5">
              <FilterFields
                allMakes={allMakes} availableModels={availableModels} make={make} setMake={setMake}
                model={model} setModel={setModel} yearMin={yearMin} setYearMin={setYearMin}
                yearMax={yearMax} setYearMax={setYearMax} priceMin={priceMin} setPriceMin={setPriceMin}
                priceMax={priceMax} setPriceMax={setPriceMax} mileageMax={mileageMax} setMileageMax={setMileageMax}
                condition={condition} setCondition={setCondition} bodyType={bodyType} setBodyType={setBodyType}
                transmission={transmission} setTransmission={setTransmission} drivetrain={drivetrain} setDrivetrain={setDrivetrain}
                fuelType={fuelType} setFuelType={setFuelType} color={color} setColor={setColor}
                features={features} toggleFeature={toggleFeature}
                zip={zip} setZip={setZip} radiusMiles={radiusMiles} setRadiusMiles={setRadiusMiles}
                locating={locating} useMyLocation={useMyLocation}
                inputCls={inputCls} labelCls={labelCls}
                sort={sort} setSort={setSort} mobileSort
                variant="drawer"
              />
            </div>
            {/* Footer */}
            <div className="flex items-center gap-2 px-5 py-4 border-t border-[#E5E7EB] bg-white">
              <button
                type="button"
                data-testid="clear-filters-btn-drawer"
                onClick={clearAll}
                className="px-4 h-11 rounded-lg border border-[#E5E7EB] text-sm font-semibold text-[#0B5FD1] hover:bg-[#F8F9FB]"
              >
                Clear
              </button>
              <button
                type="button"
                data-testid="show-results-btn"
                onClick={() => { apply(); setDrawerOpen(false); }}
                disabled={isPending}
                className="flex-1 h-11 rounded-lg bg-[#0B5FD1] hover:bg-[#0A4DB8] text-white text-sm font-semibold disabled:opacity-60"
              >
                {isPending ? <Loader2 size={14} className="animate-spin inline" /> : "Show Results"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Filter fields — shared between desktop inline and mobile drawer variants ───
interface FilterFieldsProps {
  allMakes: string[]; availableModels: string[];
  make: string; setMake: (v: string) => void;
  model: string; setModel: (v: string) => void;
  yearMin: string; setYearMin: (v: string) => void;
  yearMax: string; setYearMax: (v: string) => void;
  priceMin: string; setPriceMin: (v: string) => void;
  priceMax: string; setPriceMax: (v: string) => void;
  mileageMax: string; setMileageMax: (v: string) => void;
  condition: string; setCondition: (v: string) => void;
  bodyType: string; setBodyType: (v: string) => void;
  transmission: string; setTransmission: (v: string) => void;
  drivetrain: string; setDrivetrain: (v: string) => void;
  fuelType: string; setFuelType: (v: string) => void;
  color: string; setColor: (v: string) => void;
  features: string[]; toggleFeature: (f: string) => void;
  zip: string; setZip: (v: string) => void;
  radiusMiles: string; setRadiusMiles: (v: string) => void;
  locating: boolean; useMyLocation: () => void;
  inputCls: string; labelCls: string;
  sort: string; setSort: (v: string) => void;
  mobileSort?: boolean;
  isPending?: boolean;
  onApply?: () => void; onClear?: () => void; onClose?: () => void;
  variant: "inline" | "drawer";
}

function FilterFields(p: FilterFieldsProps) {
  const isInline = p.variant === "inline";
  return (
    <>
      <div className={`bg-white border ${isInline ? "border-[#E5E7EB] rounded-xl p-4" : "border-transparent"} grid grid-cols-2 ${isInline ? "lg:grid-cols-6" : ""} gap-3`}>
        <div>
          <label className={p.labelCls}>Make</label>
          <select data-testid="filter-make" className={p.inputCls} value={p.make} onChange={e => { p.setMake(e.target.value); p.setModel(""); }}>
            <option value="">All Makes</option>
            {p.allMakes.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className={p.labelCls}>Model</label>
          <select data-testid="filter-model" className={p.inputCls} value={p.model} onChange={e => p.setModel(e.target.value)} disabled={!p.make}>
            <option value="">All Models</option>
            {p.availableModels.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className={p.labelCls}>Year Min</label>
          <input data-testid="filter-year-min" type="number" min="2010" max="2025" placeholder="2010" className={p.inputCls} value={p.yearMin} onChange={e => p.setYearMin(e.target.value)} />
        </div>
        <div>
          <label className={p.labelCls}>Year Max</label>
          <input data-testid="filter-year-max" type="number" min="2010" max="2025" placeholder="2025" className={p.inputCls} value={p.yearMax} onChange={e => p.setYearMax(e.target.value)} />
        </div>
        <div>
          <label className={p.labelCls}>Price Min ($)</label>
          <input data-testid="filter-price-min" type="number" min="0" placeholder="0" className={p.inputCls} value={p.priceMin} onChange={e => p.setPriceMin(e.target.value)} />
        </div>
        <div>
          <label className={p.labelCls}>Price Max ($)</label>
          <input data-testid="filter-price-max" type="number" min="0" placeholder="No Limit" className={p.inputCls} value={p.priceMax} onChange={e => p.setPriceMax(e.target.value)} />
        </div>
        <div>
          <label className={p.labelCls}>Mileage</label>
          <select data-testid="filter-mileage" className={p.inputCls} value={p.mileageMax} onChange={e => p.setMileageMax(e.target.value)}>
            {MILEAGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className={p.labelCls}>Condition</label>
          <select data-testid="filter-condition" className={p.inputCls} value={p.condition} onChange={e => p.setCondition(e.target.value)}>
            <option value="">All</option>
            {CONDITIONS.map(c => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
          </select>
        </div>
        <div>
          <label className={p.labelCls}>Body Type</label>
          <select data-testid="filter-body" className={p.inputCls} value={p.bodyType} onChange={e => p.setBodyType(e.target.value)}>
            <option value="">Any</option>
            {BODY_TYPES.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div>
          <label className={p.labelCls}>Transmission</label>
          <select data-testid="filter-transmission" className={p.inputCls} value={p.transmission} onChange={e => p.setTransmission(e.target.value)}>
            <option value="">All</option>
            {TRANSMISSIONS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className={p.labelCls}>Drivetrain</label>
          <select data-testid="filter-drivetrain" className={p.inputCls} value={p.drivetrain} onChange={e => p.setDrivetrain(e.target.value)}>
            <option value="">All</option>
            {DRIVETRAINS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className={p.labelCls}>Fuel</label>
          <select data-testid="filter-fuel" className={p.inputCls} value={p.fuelType} onChange={e => p.setFuelType(e.target.value)}>
            <option value="">All</option>
            {FUEL_TYPES.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div className={`col-span-2 ${isInline ? "lg:col-span-3" : ""}`}>
          <label className={p.labelCls}>Color</label>
          <div className="flex flex-wrap gap-1.5">
            {COLORS.map(c => (
              <button key={c.name} type="button" data-testid={`filter-color-${c.name.toLowerCase()}`}
                onClick={() => p.setColor(p.color === c.name ? "" : c.name)}
                className={`w-7 h-7 rounded-full border-2 transition-all ${p.color === c.name ? "border-[#0B5FD1] scale-110" : "border-[#E5E7EB] hover:border-[#94A3B8]"}`}
                style={{ background: c.hex }} title={c.name} />
            ))}
          </div>
        </div>
        <div className={`col-span-2 ${isInline ? "lg:col-span-6" : ""}`}>
          <label className={p.labelCls}>Features {p.features.length > 0 && <span className="text-[#0B5FD1]">({p.features.length} selected)</span>}</label>
          <div className="flex flex-wrap gap-1.5" data-testid="filter-features">
            {FEATURE_OPTIONS.map(f => {
              const on = p.features.includes(f);
              return (
                <button key={f} type="button"
                  data-testid={`filter-feature-${f.toLowerCase().replace(/\s+/g, "-")}`}
                  onClick={() => p.toggleFeature(f)}
                  className={`text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors ${
                    on ? "bg-[#0B5FD1] border-[#0B5FD1] text-white" : "bg-white border-[#E5E7EB] text-[#4B5563] hover:border-[#BFDBFE] hover:text-[#0B5FD1]"
                  }`}>{f}</button>
              );
            })}
          </div>
        </div>
        <div className={`col-span-2 ${isInline ? "lg:col-span-3" : ""}`}>
          <label className={p.labelCls}>Location</label>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <MapPin size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
              <input data-testid="filter-zip" type="text" placeholder="Enter ZIP code"
                maxLength={5} pattern="[0-9]{5}"
                className="w-full pl-8 pr-2 py-2 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/20 focus:border-[#0B5FD1]"
                value={p.zip} onChange={e => p.setZip(e.target.value.replace(/\D/g, ""))} />
            </div>
            <button type="button" data-testid="use-my-location-btn"
              onClick={p.useMyLocation} disabled={p.locating}
              className="inline-flex items-center gap-1 px-2.5 py-2 border border-[#E5E7EB] rounded-lg text-xs hover:bg-[#F8F9FB] hover:text-[#0B5FD1] transition-colors"
              title="Use my location">
              {p.locating ? <Loader2 size={13} className="animate-spin" /> : <Crosshair size={13} />}
            </button>
          </div>
          {p.zip.length === 5 && (
            <select data-testid="filter-radius"
              className="w-full mt-2 px-3 py-2 border border-[#E5E7EB] rounded-lg text-xs"
              value={p.radiusMiles} onChange={e => p.setRadiusMiles(e.target.value)}>
              <option value="">Any Distance</option>
              {RADIUS_OPTIONS.map(r => <option key={r} value={r}>{r} miles</option>)}
            </select>
          )}
        </div>
      </div>
      {/* Inline-only footer with Apply / Clear */}
      {isInline && (
        <div className="flex items-center gap-2 mt-3">
          <button type="button" data-testid="apply-filters-btn"
            onClick={p.onApply} disabled={p.isPending}
            className="px-5 py-2 bg-[#0B5FD1] hover:bg-[#0A4DB8] text-white rounded-lg text-xs font-semibold disabled:opacity-60">
            {p.isPending ? <Loader2 size={13} className="animate-spin inline" /> : "Apply Filters"}
          </button>
          <button type="button" data-testid="clear-filters-btn"
            onClick={p.onClear}
            className="px-5 py-2 border border-[#E5E7EB] hover:bg-[#F8F9FB] rounded-lg text-xs font-semibold">
            Clear
          </button>
          {p.onClose && (
            <button type="button" onClick={p.onClose} data-testid="close-filters-btn"
              className="ml-auto px-3 py-2 text-xs font-semibold text-slate-500 hover:text-[#0B5FD1]">
              Close
            </button>
          )}
          {p.mobileSort && (
            <select data-testid="sort-select-mobile"
              value={p.sort} onChange={e => p.setSort(e.target.value)}
              className="md:hidden px-3 py-2 border border-[#E5E7EB] rounded-lg text-xs ml-auto">
              {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
        </div>
      )}
    </>
  );
}
