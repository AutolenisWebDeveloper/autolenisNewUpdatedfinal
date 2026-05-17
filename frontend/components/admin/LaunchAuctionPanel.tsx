"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Gavel, Search, Loader2, CheckCircle2, AlertCircle, X, Clock, ExternalLink,
  ChevronDown, ChevronRight, Plus, Trash2, Car,
} from "lucide-react";

interface ActiveDealer {
  id: string;
  dealershipName: string;
  city: string | null;
  state: string | null;
  tier: string;
  currentAuctionLoad: number;
}

interface OutsideDealerInput {
  dealershipName: string;
  contactName: string;
  email: string;
  phone: string;
}

interface ManualVehicleInput {
  year: string;
  make: string;
  model: string;
  trim: string;
  mileage: string;
  notes: string;
}

interface ShortlistVehicle {
  inventoryItemId: string;
  year: number;
  make: string;
  model: string;
  trim: string | null;
  mileage: number | null;
}

type VehicleMode = "shortlist" | "manual" | "skip";

function emptyOutsideDealer(): OutsideDealerInput {
  return { dealershipName: "", contactName: "", email: "", phone: "" };
}

function emptyVehicle(): ManualVehicleInput {
  return { year: "", make: "", model: "", trim: "", mileage: "", notes: "" };
}

interface Props {
  buyerId: string;
  buyerName: string;
  onLaunched?: (auctionId: string) => void;
}

interface LaunchResult {
  auctionId: string;
  dealerCount: number;
  outsideDealerCount: number;
  vehicleCount: number;
  endsAt: string | null;
}

const PRESET_HOURS = [24, 48, 72] as const;

export default function LaunchAuctionPanel({ buyerId, buyerName, onLaunched }: Props) {
  const [query, setQuery] = useState("");
  const [dealers, setDealers] = useState<ActiveDealer[]>([]);
  const [loadingDealers, setLoadingDealers] = useState(true);
  const [dealerError, setDealerError] = useState<string | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [hours, setHours] = useState<number>(48);
  const [customHours, setCustomHours] = useState<string>("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<LaunchResult | null>(null);

  // Outside dealers
  const [outsideOpen, setOutsideOpen] = useState(false);
  const [outsideDealers, setOutsideDealers] = useState<OutsideDealerInput[]>([]);

  // Vehicles section
  const [vehicleMode, setVehicleMode] = useState<VehicleMode>("skip");
  const [manualVehicles, setManualVehicles] = useState<ManualVehicleInput[]>([emptyVehicle()]);
  const [shortlist, setShortlist] = useState<ShortlistVehicle[]>([]);
  const [shortlistLoading, setShortlistLoading] = useState(false);
  const [shortlistError, setShortlistError] = useState<string | null>(null);
  const [selectedShortlistIds, setSelectedShortlistIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (vehicleMode !== "shortlist") return;
    let cancelled = false;
    setShortlistLoading(true);
    setShortlistError(null);
    fetch(`/api/admin/buyers/${buyerId}/shortlist`)
      .then(async r => {
        const json = await r.json() as {
          success?: boolean;
          data?: {
            shortlist?: {
              items: Array<{
                inventoryItemId: string;
                inventoryItem: {
                  id: string;
                  year: number;
                  make: string;
                  model: string;
                  trim: string | null;
                  mileage: number | null;
                } | null;
              }>;
            } | null;
          };
          error?: { message: string };
        };
        if (cancelled) return;
        if (!json.success) {
          setShortlistError(json.error?.message ?? "Failed to load shortlist");
          setShortlist([]);
          return;
        }
        const items = json.data?.shortlist?.items ?? [];
        setShortlist(items.map(i => ({
          inventoryItemId: i.inventoryItemId,
          year:    i.inventoryItem?.year    ?? 0,
          make:    i.inventoryItem?.make    ?? "",
          model:   i.inventoryItem?.model   ?? "",
          trim:    i.inventoryItem?.trim    ?? null,
          mileage: i.inventoryItem?.mileage ?? null,
        })));
      })
      .catch(err => {
        if (cancelled) return;
        setShortlistError(err instanceof Error ? err.message : "Network error");
        setShortlist([]);
      })
      .finally(() => { if (!cancelled) setShortlistLoading(false); });
    return () => { cancelled = true; };
  }, [vehicleMode, buyerId]);

  function updateOutsideDealer(idx: number, patch: Partial<OutsideDealerInput>) {
    setOutsideDealers(prev => prev.map((d, i) => i === idx ? { ...d, ...patch } : d));
  }
  function removeOutsideDealer(idx: number) {
    setOutsideDealers(prev => prev.filter((_, i) => i !== idx));
  }
  function addOutsideDealer() {
    if (outsideDealers.length >= 8) return;
    setOutsideDealers(prev => [...prev, emptyOutsideDealer()]);
  }

  function updateManualVehicle(idx: number, patch: Partial<ManualVehicleInput>) {
    setManualVehicles(prev => prev.map((v, i) => i === idx ? { ...v, ...patch } : v));
  }
  function removeManualVehicle(idx: number) {
    setManualVehicles(prev => prev.filter((_, i) => i !== idx));
  }
  function addManualVehicle() {
    if (manualVehicles.length >= 10) return;
    setManualVehicles(prev => [...prev, emptyVehicle()]);
  }
  function toggleShortlistVehicle(id: string) {
    setSelectedShortlistIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  useEffect(() => {
    let cancelled = false;
    setLoadingDealers(true);
    setDealerError(null);
    const url = `/api/admin/dealers/active${query ? `?q=${encodeURIComponent(query)}` : ""}`;
    fetch(url)
      .then(async r => {
        const json = await r.json() as {
          success?: boolean;
          data?: { dealers: ActiveDealer[] };
          error?: { message: string };
        };
        if (cancelled) return;
        if (!json.success) {
          setDealerError(json.error?.message ?? "Failed to load dealers");
          setDealers([]);
        } else {
          setDealers(json.data?.dealers ?? []);
        }
      })
      .catch(err => {
        if (cancelled) return;
        setDealerError(err instanceof Error ? err.message : "Network error");
        setDealers([]);
      })
      .finally(() => { if (!cancelled) setLoadingDealers(false); });
    return () => { cancelled = true; };
  }, [query]);

  const groupedByTier = useMemo(() => {
    const order = ["PLATINUM", "GOLD", "STANDARD", "PROBATION"];
    const groups = new Map<string, ActiveDealer[]>();
    for (const d of dealers) {
      const t = d.tier || "STANDARD";
      if (!groups.has(t)) groups.set(t, []);
      groups.get(t)!.push(d);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => {
      const ai = order.indexOf(a); const bi = order.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  }, [dealers]);

  function toggleDealer(id: string) {
    setSelectedIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  const effectiveHours = customHours.trim()
    ? Math.max(1, Math.min(168, parseInt(customHours, 10) || 0))
    : hours;

  const canSubmit = selectedIds.size > 0 && reason.trim().length > 0 && effectiveHours > 0;

  async function launch() {
    if (!canSubmit) return;

    // Build outside dealers payload (only fully filled entries)
    const outsidePayload = outsideDealers
      .map(d => ({
        dealershipName: d.dealershipName.trim(),
        contactName:    d.contactName.trim(),
        email:          d.email.trim(),
        phone:          d.phone.trim() || undefined,
      }))
      .filter(d => d.dealershipName && d.contactName && d.email);
    for (const d of outsidePayload) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) {
        setSubmitError(`Invalid outside dealer email: ${d.email}`);
        return;
      }
    }
    if (outsidePayload.length > 8) {
      setSubmitError("Maximum 8 outside dealers per auction");
      return;
    }

    // Build vehicles payload based on mode
    let vehiclesPayload: Array<{
      inventoryItemId?: string;
      year?: number;
      make?: string;
      model?: string;
      trim?: string;
      mileage?: number;
      notes?: string;
    }> = [];
    if (vehicleMode === "shortlist") {
      vehiclesPayload = Array.from(selectedShortlistIds).map(id => ({ inventoryItemId: id }));
    } else if (vehicleMode === "manual") {
      for (const v of manualVehicles) {
        const year = parseInt(v.year, 10);
        if (!year || !v.make.trim() || !v.model.trim()) continue;
        vehiclesPayload.push({
          year,
          make:    v.make.trim(),
          model:   v.model.trim(),
          trim:    v.trim.trim()    || undefined,
          mileage: v.mileage ? parseInt(v.mileage, 10) : undefined,
          notes:   v.notes.trim()   || undefined,
        });
      }
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/admin/buyers/${buyerId}/launch-auction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealerIds: Array.from(selectedIds),
          reason: reason.trim(),
          hours: effectiveHours,
          notes: notes.trim() || undefined,
          outsideDealers: outsidePayload.length > 0 ? outsidePayload : undefined,
          vehicles:       vehiclesPayload.length > 0 ? vehiclesPayload : undefined,
        }),
      });
      const json = await res.json() as {
        success?: boolean;
        data?: { auctionId: string; dealerCount: number; outsideDealerCount?: number; vehicleCount?: number; endsAt: string | null };
        error?: { message: string };
      };
      if (!json.success || !json.data) {
        setSubmitError(json.error?.message ?? "Launch failed");
        return;
      }
      setResult({
        auctionId: json.data.auctionId,
        dealerCount: json.data.dealerCount,
        outsideDealerCount: json.data.outsideDealerCount ?? 0,
        vehicleCount: json.data.vehicleCount ?? 0,
        endsAt: json.data.endsAt,
      });
      onLaunched?.(json.data.auctionId);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="bg-white border border-green-200 rounded-2xl p-6">
        <div className="flex items-start gap-3 mb-4">
          <CheckCircle2 size={20} className="text-green-600 mt-0.5" />
          <div>
            <h3 className="text-sm font-bold text-slate-900">Auction launched</h3>
            <p className="text-xs text-slate-500 mt-1">
              {result.dealerCount} dealer{result.dealerCount !== 1 ? "s" : ""} invited
              {result.outsideDealerCount > 0 && ` · ${result.outsideDealerCount} outside dealer${result.outsideDealerCount !== 1 ? "s" : ""}`}
              {result.vehicleCount > 0 && ` · ${result.vehicleCount} vehicle${result.vehicleCount !== 1 ? "s" : ""}`}
              {result.endsAt && ` · Closes ${new Date(result.endsAt).toLocaleString()}`}
            </p>
          </div>
        </div>
        <a
          href={`/admin/auctions/${result.auctionId}`}
          className="inline-flex items-center gap-1.5 bg-[#0B5FD1] text-white text-xs font-semibold px-4 py-2 rounded-xl hover:bg-[#0944a8]"
        >
          <ExternalLink size={12} /> Open auction
        </a>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-1">
        <Gavel size={16} className="text-[#0B5FD1]" />
        <h3 className="text-sm font-bold text-slate-900">Launch auction for {buyerName}</h3>
      </div>
      <p className="text-xs text-slate-500 mb-5">
        Select dealers, set duration, and provide a reason. The auction will be created against
        this buyer and visible on their dashboard immediately.
      </p>

      {/* Dealer search */}
      <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide block mb-1.5">
        Invite dealers {selectedIds.size > 0 && <span className="text-[#0B5FD1] normal-case">· {selectedIds.size} selected</span>}
      </label>
      <div className="relative mb-2">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search dealership name, city, or state…"
          className="w-full pl-8 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/20"
        />
        {loadingDealers && (
          <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 animate-spin" />
        )}
      </div>

      <div className="border border-slate-200 rounded-xl max-h-64 overflow-y-auto divide-y divide-slate-100 mb-4">
        {dealerError && (
          <div className="p-3 text-xs text-red-600 flex items-center gap-1.5">
            <AlertCircle size={12} /> {dealerError}
          </div>
        )}
        {!dealerError && !loadingDealers && dealers.length === 0 && (
          <div className="p-4 text-center text-xs text-slate-400">
            No active dealers found. Add or activate dealers before launching.
          </div>
        )}
        {groupedByTier.map(([tier, list]) => (
          <div key={tier}>
            <div className="px-3 py-1.5 bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-wide sticky top-0">
              {tier} <span className="font-normal normal-case text-slate-400">· {list.length}</span>
            </div>
            {list.map(d => {
              const checked = selectedIds.has(d.id);
              return (
                <button
                  type="button"
                  key={d.id}
                  onClick={() => toggleDealer(d.id)}
                  className={`w-full flex items-center justify-between text-left px-3 py-2.5 hover:bg-slate-50 ${checked ? "bg-blue-50/40" : ""}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <input
                      type="checkbox"
                      readOnly
                      checked={checked}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-[#0B5FD1] focus:ring-0 pointer-events-none"
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-800 truncate">{d.dealershipName}</p>
                      <p className="text-[10px] text-slate-400 truncate">
                        {d.city ?? "—"}{d.state ? `, ${d.state}` : ""} · load {d.currentAuctionLoad}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Outside Dealers (optional) */}
      <div className="border border-slate-200 rounded-xl p-3 mb-4" data-testid="outside-dealers-section">
        <button
          type="button"
          onClick={() => setOutsideOpen(o => !o)}
          className="w-full flex items-center justify-between text-left"
        >
          <div className="flex items-center gap-2">
            {outsideOpen ? <ChevronDown size={13} className="text-slate-400" /> : <ChevronRight size={13} className="text-slate-400" />}
            <span className="text-xs font-semibold text-slate-700">
              Invite Outside Dealers <span className="text-slate-400 font-normal">(optional)</span>
              {outsideDealers.length > 0 && <span className="text-[#0B5FD1]"> · {outsideDealers.length}</span>}
            </span>
          </div>
        </button>
        {outsideOpen && (
          <div className="mt-3 space-y-3">
            {outsideDealers.length === 0 && (
              <p className="text-[11px] text-slate-400">
                Add up to 8 outside (non-platform) dealers. They&apos;ll receive an email with a token link to submit an offer — no AutoLenis account required.
              </p>
            )}
            {outsideDealers.map((d, idx) => (
              <div key={idx} className="border border-slate-200 rounded-lg p-3 space-y-2" data-testid={`outside-dealer-row-${idx}`}>
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Outside dealer {idx + 1}</p>
                  <button type="button" onClick={() => removeOutsideDealer(idx)} className="text-slate-400 hover:text-red-500" aria-label="Remove">
                    <Trash2 size={12} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={d.dealershipName}
                    onChange={e => updateOutsideDealer(idx, { dealershipName: e.target.value })}
                    placeholder="Dealership name *"
                    data-testid={`outside-dealer-${idx}-dealership`}
                    className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/20"
                  />
                  <input
                    type="text"
                    value={d.contactName}
                    onChange={e => updateOutsideDealer(idx, { contactName: e.target.value })}
                    placeholder="Contact name *"
                    data-testid={`outside-dealer-${idx}-contact`}
                    className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/20"
                  />
                  <input
                    type="email"
                    value={d.email}
                    onChange={e => updateOutsideDealer(idx, { email: e.target.value })}
                    placeholder="Email *"
                    data-testid={`outside-dealer-${idx}-email`}
                    className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/20"
                  />
                  <input
                    type="tel"
                    value={d.phone}
                    onChange={e => updateOutsideDealer(idx, { phone: e.target.value })}
                    placeholder="Phone"
                    data-testid={`outside-dealer-${idx}-phone`}
                    className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/20"
                  />
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={addOutsideDealer}
              disabled={outsideDealers.length >= 8}
              data-testid="outside-dealer-add-btn"
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#0B5FD1] hover:text-[#0944a8] disabled:text-slate-300"
            >
              <Plus size={12} /> Add outside dealer{outsideDealers.length >= 8 ? " (max 8)" : ""}
            </button>
          </div>
        )}
      </div>

      {/* Vehicles section */}
      <div className="border border-slate-200 rounded-xl p-3 mb-4" data-testid="vehicles-section">
        <div className="flex items-center gap-2 mb-3">
          <Car size={13} className="text-slate-500" />
          <span className="text-xs font-semibold text-slate-700">Vehicles <span className="text-slate-400 font-normal">(optional)</span></span>
        </div>
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {([
            { id: "shortlist", label: "From shortlist" },
            { id: "manual",    label: "Manual entry"  },
            { id: "skip",      label: "Skip"          },
          ] as const).map(opt => (
            <button
              type="button"
              key={opt.id}
              onClick={() => setVehicleMode(opt.id)}
              data-testid={`vehicle-mode-${opt.id}`}
              className={`px-3 py-1.5 rounded-full text-[11px] font-semibold border ${
                vehicleMode === opt.id
                  ? "bg-[#0B5FD1] text-white border-[#0B5FD1]"
                  : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {vehicleMode === "shortlist" && (
          <div data-testid="vehicle-shortlist">
            {shortlistLoading && <p className="text-[11px] text-slate-400">Loading shortlist…</p>}
            {shortlistError && <p className="text-[11px] text-red-600">{shortlistError}</p>}
            {!shortlistLoading && !shortlistError && shortlist.length === 0 && (
              <p className="text-[11px] text-slate-400">No shortlisted vehicles yet. Use Manual entry or Skip.</p>
            )}
            <div className="space-y-1.5">
              {shortlist.map(v => {
                const checked = selectedShortlistIds.has(v.inventoryItemId);
                return (
                  <label
                    key={v.inventoryItemId}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer ${checked ? "bg-blue-50/40 border border-blue-200" : "border border-slate-200"}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleShortlistVehicle(v.inventoryItemId)}
                      data-testid={`shortlist-vehicle-${v.inventoryItemId}`}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-[#0B5FD1] focus:ring-0"
                    />
                    <span className="text-xs text-slate-700 truncate">
                      {v.year || "—"} {v.make} {v.model}{v.trim ? ` ${v.trim}` : ""}
                      {v.mileage ? ` · ${v.mileage.toLocaleString()} mi` : ""}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {vehicleMode === "manual" && (
          <div className="space-y-3" data-testid="vehicle-manual">
            {manualVehicles.map((v, idx) => (
              <div key={idx} className="border border-slate-200 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Vehicle {idx + 1}</p>
                  {manualVehicles.length > 1 && (
                    <button type="button" onClick={() => removeManualVehicle(idx)} className="text-slate-400 hover:text-red-500" aria-label="Remove">
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <input
                    type="number"
                    value={v.year}
                    onChange={e => updateManualVehicle(idx, { year: e.target.value })}
                    placeholder="Year *"
                    data-testid={`manual-vehicle-${idx}-year`}
                    className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/20"
                  />
                  <input
                    type="text"
                    value={v.make}
                    onChange={e => updateManualVehicle(idx, { make: e.target.value })}
                    placeholder="Make *"
                    data-testid={`manual-vehicle-${idx}-make`}
                    className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/20"
                  />
                  <input
                    type="text"
                    value={v.model}
                    onChange={e => updateManualVehicle(idx, { model: e.target.value })}
                    placeholder="Model *"
                    data-testid={`manual-vehicle-${idx}-model`}
                    className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/20"
                  />
                  <input
                    type="text"
                    value={v.trim}
                    onChange={e => updateManualVehicle(idx, { trim: e.target.value })}
                    placeholder="Trim"
                    data-testid={`manual-vehicle-${idx}-trim`}
                    className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/20"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    value={v.mileage}
                    onChange={e => updateManualVehicle(idx, { mileage: e.target.value })}
                    placeholder="Mileage"
                    data-testid={`manual-vehicle-${idx}-mileage`}
                    className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/20"
                  />
                  <input
                    type="text"
                    value={v.notes}
                    onChange={e => updateManualVehicle(idx, { notes: e.target.value })}
                    placeholder="Notes"
                    data-testid={`manual-vehicle-${idx}-notes`}
                    className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/20"
                  />
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={addManualVehicle}
              disabled={manualVehicles.length >= 10}
              data-testid="manual-vehicle-add-btn"
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#0B5FD1] hover:text-[#0944a8] disabled:text-slate-300"
            >
              <Plus size={12} /> Add vehicle{manualVehicles.length >= 10 ? " (max 10)" : ""}
            </button>
          </div>
        )}

        {vehicleMode === "skip" && (
          <p className="text-[11px] text-slate-400">Launch without attaching specific vehicles. You can add them later.</p>
        )}
      </div>

      {/* Duration */}
      <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide block mb-1.5">
        Duration
      </label>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {PRESET_HOURS.map(h => (
          <button
            type="button"
            key={h}
            onClick={() => { setHours(h); setCustomHours(""); }}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${
              !customHours && hours === h
                ? "bg-[#0B5FD1] text-white border-[#0B5FD1]"
                : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
            }`}
          >
            {h}h
          </button>
        ))}
        <div className="flex items-center gap-1">
          <Clock size={12} className="text-slate-400" />
          <input
            type="number"
            min={1}
            max={168}
            placeholder="Custom"
            value={customHours}
            onChange={e => setCustomHours(e.target.value)}
            className="w-20 px-2 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/20"
          />
          <span className="text-[11px] text-slate-400">hours</span>
        </div>
      </div>

      {/* Reason */}
      <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide block mb-1.5">
        Reason <span className="text-red-500">*</span>
      </label>
      <input
        type="text"
        value={reason}
        onChange={e => setReason(e.target.value)}
        placeholder="Why is the admin launching this auction?"
        className="w-full px-3 py-2 mb-4 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/20"
      />

      {/* Notes */}
      <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide block mb-1.5">
        Notes <span className="text-slate-400 font-normal normal-case">(optional)</span>
      </label>
      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        rows={2}
        placeholder="Internal notes captured in the audit log"
        className="w-full px-3 py-2 mb-4 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/20"
      />

      {submitError && (
        <div className="mb-3 flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3">
          <AlertCircle size={13} className="text-red-600 mt-0.5" />
          <p className="text-xs text-red-700">{submitError}</p>
          <button onClick={() => setSubmitError(null)} className="ml-auto text-red-400 hover:text-red-600">
            <X size={12} />
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={launch}
        disabled={!canSubmit || submitting}
        className="w-full bg-[#0B5FD1] text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-[#0944a8] disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {submitting ? <Loader2 size={13} className="animate-spin" /> : <Gavel size={13} />}
        {submitting ? "Launching…" : `Launch auction${selectedIds.size > 0 ? ` (${selectedIds.size} dealer${selectedIds.size !== 1 ? "s" : ""})` : ""}`}
      </button>
    </div>
  );
}
