"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Gavel, Search, Loader2, CheckCircle2, AlertCircle, X, Clock, ExternalLink,
} from "lucide-react";

interface ActiveDealer {
  id: string;
  dealershipName: string;
  city: string | null;
  state: string | null;
  tier: string;
  currentAuctionLoad: number;
}

interface Props {
  buyerId: string;
  buyerName: string;
  onLaunched?: (auctionId: string) => void;
}

interface LaunchResult {
  auctionId: string;
  dealerCount: number;
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
        }),
      });
      const json = await res.json() as {
        success?: boolean;
        data?: { auctionId: string; dealerCount: number; endsAt: string | null };
        error?: { message: string };
      };
      if (!json.success || !json.data) {
        setSubmitError(json.error?.message ?? "Launch failed");
        return;
      }
      setResult({
        auctionId: json.data.auctionId,
        dealerCount: json.data.dealerCount,
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
