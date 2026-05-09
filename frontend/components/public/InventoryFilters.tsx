"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { useTransition, useCallback } from "react";

const MAKES = ["All Makes", "Toyota", "Honda", "Ford", "Chevrolet", "BMW", "Tesla", "Nissan", "Hyundai"];
const LANES = [{ value: "", label: "All Lanes" }, { value: "LANE_1", label: "Verified" }, { value: "LANE_2", label: "Partner" }, { value: "LANE_3", label: "Market" }];
const PRICE_RANGES = [{ value: "", label: "Any Price" }, { value: "20000", label: "Under $20k" }, { value: "30000", label: "Under $30k" }, { value: "40000", label: "Under $40k" }, { value: "50000", label: "Under $50k" }];

export function InventoryFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const update = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value); else params.delete(key);
      params.delete("page");
      startTransition(() => router.replace(`${pathname}?${params.toString()}`, { scroll: false }));
    },
    [router, pathname, searchParams]
  );

  const make = searchParams.get("make") ?? "";
  const lane = searchParams.get("lane") ?? "";
  const maxPrice = searchParams.get("maxPrice") ?? "";
  const q = searchParams.get("q") ?? "";

  const selectClass = "py-2.5 px-3 text-sm bg-white border border-[#E5E7EB] rounded-md text-[#4B5563] focus:outline-none focus:border-[#0B5FD1]/50 focus:ring-2 focus:ring-[#0B5FD1]/10 min-w-[120px]";

  return (
    <div className="flex flex-wrap items-center gap-2.5" data-testid="inventory-filters">
      <div className="relative flex-1 min-w-[180px]">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
        <input
          type="text" placeholder="Make, model, trim…" defaultValue={q}
          onChange={(e) => update("q", e.target.value)}
          data-testid="inventory-search-input"
          className="w-full pl-8 pr-3 py-2.5 text-sm bg-white border border-[#E5E7EB] rounded-md text-[#111827] placeholder-[#94A3B8] focus:outline-none focus:border-[#0B5FD1]/50 focus:ring-2 focus:ring-[#0B5FD1]/10"
        />
      </div>
      <select value={make} onChange={(e) => update("make", e.target.value === "All Makes" ? "" : e.target.value)} data-testid="inventory-make-filter" className={selectClass}>
        {MAKES.map((m) => <option key={m} value={m === "All Makes" ? "" : m}>{m}</option>)}
      </select>
      <select value={lane} onChange={(e) => update("lane", e.target.value)} data-testid="inventory-lane-filter" className={selectClass}>
        {LANES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
      </select>
      <select value={maxPrice} onChange={(e) => update("maxPrice", e.target.value)} data-testid="inventory-price-filter" className={selectClass}>
        {PRICE_RANGES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
      </select>
    </div>
  );
}
