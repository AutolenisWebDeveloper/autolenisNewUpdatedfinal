"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Search, Loader2, ChevronLeft, ExternalLink, RefreshCw,
  CheckCircle2, Clock, Lock, Unlock, SkipForward, RotateCcw,
  AlertCircle, Sparkles, ShieldAlert,
} from "lucide-react";
import type {
  AdminBuyerJourney,
  JourneyStageView,
  StageStatus,
} from "@/lib/services/admin/buyer-journey-admin.service";

interface BuyerResult {
  id: string;
  name: string;
  email: string;
}

const STATUS_CFG: Record<StageStatus, {
  icon: React.ReactNode; badge: string; rowBg: string; label: string;
}> = {
  COMPLETE:  { icon: <CheckCircle2 size={15} className="text-green-600" />, badge: "bg-green-100 text-green-700 border-green-200",  rowBg: "bg-white",       label: "Complete"      },
  SKIPPED:   { icon: <CheckCircle2 size={15} className="text-slate-400" />, badge: "bg-slate-100 text-slate-500 border-slate-200",  rowBg: "bg-slate-50/60", label: "Skipped"       },
  ACTIVE:    { icon: <Clock size={15} className="text-al-primary" />,        badge: "bg-blue-100 text-al-primary border-blue-200",    rowBg: "bg-blue-50/30",  label: "Active"        },
  LOCKED:    { icon: <Lock size={15} className="text-slate-300" />,         badge: "bg-slate-100 text-slate-400 border-slate-200",  rowBg: "bg-white",       label: "Locked"        },
  UNLOCKED:  { icon: <Unlock size={15} className="text-amber-500" />,       badge: "bg-amber-100 text-amber-700 border-amber-200",  rowBg: "bg-amber-50/40", label: "Admin Unlocked" },
};

// Stages requiring buyer action that cannot be synthetically completed via /complete (they only get admin unlocks)
const UNLOCK_ONLY_STAGES = new Set(["shortlist", "auction", "select-deal"]);

export default function JourneyControlClient() {
  const [selectedBuyer, setSelectedBuyer] = useState<BuyerResult | null>(null);

  if (!selectedBuyer) {
    return <BuyerSearchView onSelect={setSelectedBuyer} />;
  }
  return <LiveJourneyView buyer={selectedBuyer} onChange={() => setSelectedBuyer(null)} />;
}

// ─── View 1 — Buyer Search ──────────────────────────────────────────────────

function BuyerSearchView({ onSelect }: { onSelect: (b: BuyerResult) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BuyerResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); setError(null); return; }
    let cancelled = false;
    setSearching(true); setError(null);
    const t = setTimeout(() => {
      fetch(`/api/admin/buyers?q=${encodeURIComponent(query.trim())}&limit=20`)
        .then(async r => {
          const json = await r.json() as {
            success?: boolean;
            data?: { buyers: Array<{ id: string; firstName: string | null; lastName: string | null; email: string }> };
            error?: { message: string };
          };
          if (cancelled) return;
          if (!json.success) { setError(json.error?.message ?? "Search failed"); setResults([]); return; }
          setResults((json.data?.buyers ?? []).map(b => ({
            id: b.id,
            name: `${b.firstName ?? ""} ${b.lastName ?? ""}`.trim() || "—",
            email: b.email,
          })));
        })
        .catch(err => { if (!cancelled) { setError(err instanceof Error ? err.message : "Network error"); setResults([]); } })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);

  return (
    <div className="p-6 md:p-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">Buyer Journey Control</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Search for a buyer to view and manage their live journey stages.
        </p>
      </div>

      <div className="relative mb-3">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          autoFocus
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search buyer name or email…"
          className="w-full pl-9 pr-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-al-primary/20"
        />
        {searching && (
          <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 animate-spin" />
        )}
      </div>

      {error && (
        <div className="mb-3 flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700">
          <AlertCircle size={12} /> {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {results.length === 0 && query.trim().length >= 2 && !searching && (
          <p className="text-xs text-slate-400 text-center py-6">No buyers found</p>
        )}
        {query.trim().length < 2 && (
          <p className="text-xs text-slate-400 text-center py-6">Type at least 2 characters to search</p>
        )}
        {results.map(b => (
          <button
            key={b.id}
            onClick={() => onSelect(b)}
            className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50"
          >
            <div>
              <p className="text-sm font-semibold text-slate-800">{b.name}</p>
              <p className="text-xs text-slate-400">{b.email}</p>
            </div>
            <ExternalLink size={13} className="text-slate-300 shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── View 2 — Live Journey Control ──────────────────────────────────────────

function LiveJourneyView({ buyer, onChange }: { buyer: BuyerResult; onChange: () => void }) {
  const [journey, setJourney] = useState<AdminBuyerJourney | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyStage, setBusyStage] = useState<string | null>(null);
  const [busyBulk, setBusyBulk] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/admin/buyers/${buyer.id}/journey`, { cache: "no-store" });
      const json = await res.json() as {
        success?: boolean;
        data?: { journey: AdminBuyerJourney };
        error?: { message: string };
      };
      if (!json.success) { setError(json.error?.message ?? "Failed to load"); return; }
      setJourney(json.data?.journey ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally { setLoading(false); }
  }, [buyer.id]);

  useEffect(() => { load(); }, [load]);

  async function callJourneyApi(path: string, payload: Record<string, unknown>, label: string, stageKey: string) {
    setBusyStage(stageKey);
    try {
      const res = await fetch(`/api/admin/buyers/${buyer.id}/journey/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json() as { success?: boolean; error?: { message: string } };
      if (!json.success) {
        showToast(json.error?.message ?? `${label} failed`, "error");
        return false;
      }
      showToast(`${label} succeeded`);
      await load();
      return true;
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Network error", "error");
      return false;
    } finally {
      setBusyStage(null);
    }
  }

  async function actUnlock(stage: JourneyStageView) {
    const note = window.prompt(`Reason for unlocking "${stage.label}"?`);
    if (note === null) return;
    if (!note.trim()) { showToast("Reason is required", "error"); return; }
    await callJourneyApi("unlock", { stageIds: [stage.id], note: note.trim() }, `Unlock ${stage.label}`, stage.id);
  }

  async function actComplete(stage: JourneyStageView) {
    const reason = window.prompt(`Reason for marking "${stage.label}" complete?`);
    if (reason === null) return;
    if (!reason.trim()) { showToast("Reason is required", "error"); return; }
    await callJourneyApi("complete", { stageId: stage.id, note: reason.trim() }, `Complete ${stage.label}`, stage.id);
  }

  async function actSkip(stage: JourneyStageView) {
    const reason = window.prompt(`Reason for skipping "${stage.label}"?`);
    if (reason === null) return;
    if (!reason.trim()) { showToast("Reason is required", "error"); return; }
    await callJourneyApi("skip", { stageId: stage.id, reason: reason.trim() }, `Skip ${stage.label}`, stage.id);
  }

  async function actReopen(stage: JourneyStageView) {
    const reason = window.prompt(`Reason for reopening "${stage.label}"?`);
    if (reason === null) return;
    if (!reason.trim()) { showToast("Reason is required", "error"); return; }
    await callJourneyApi("reopen", { stageId: stage.id, reason: reason.trim() }, `Reopen ${stage.label}`, stage.id);
  }

  async function actLock(stage: JourneyStageView) {
    const ok = window.confirm(`Remove admin override for "${stage.label}"?`);
    if (!ok) return;
    await callJourneyApi("lock", { stageIds: [stage.id] }, `Lock ${stage.label}`, stage.id);
  }

  async function bulkUnlockAll() {
    const note = window.prompt("Reason for unlocking all stages?");
    if (note === null) return;
    if (!note.trim()) { showToast("Reason is required", "error"); return; }
    setBusyBulk("unlock-all");
    try {
      const res = await fetch(`/api/admin/buyers/${buyer.id}/journey/unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unlockAll: true, note: note.trim() }),
      });
      const json = await res.json() as { success?: boolean; error?: { message: string } };
      if (!json.success) showToast(json.error?.message ?? "Unlock all failed", "error");
      else { showToast("All stages unlocked"); await load(); }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Network error", "error");
    } finally { setBusyBulk(null); }
  }

  async function bulkCompleteAll() {
    if (!window.confirm("Complete entire journey (recovery)? This advances all stages and writes real DB records.")) return;
    const note = window.prompt("Reason for completing the entire journey?");
    if (note === null) return;
    if (!note.trim()) { showToast("Reason is required", "error"); return; }
    setBusyBulk("complete-all");
    try {
      const res = await fetch(`/api/admin/buyers/${buyer.id}/journey/complete-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: note.trim() }),
      });
      const json = await res.json() as { success?: boolean; error?: { message: string } };
      if (!json.success) showToast(json.error?.message ?? "Complete all failed", "error");
      else { showToast("Journey completed"); await load(); }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Network error", "error");
    } finally { setBusyBulk(null); }
  }

  return (
    <div className="p-6 md:p-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-2">
        <button onClick={onChange} className="flex items-center gap-1 text-xs font-semibold text-al-primary hover:underline">
          <ChevronLeft size={13} /> Change buyer
        </button>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 border border-slate-200 bg-white px-3 py-1.5 rounded-lg hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw size={11} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h1 className="text-lg font-bold text-slate-900">{buyer.name}</h1>
            <p className="text-xs text-slate-400">{buyer.email}</p>
          </div>
          <Link
            href={`/admin/buyers/${buyer.id}`}
            className="flex items-center gap-1 text-xs font-semibold text-al-primary hover:underline whitespace-nowrap"
          >
            Full Profile <ExternalLink size={11} />
          </Link>
        </div>

        {journey && (
          <>
            <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
              <span className="font-semibold">
                {journey.completedCount} / {journey.totalCount} stages complete
              </span>
              <span>{journey.percentComplete}%</span>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-al-primary transition-all"
                style={{ width: `${journey.percentComplete}%` }}
              />
            </div>
          </>
        )}

        {/* Bulk actions */}
        <div className="flex flex-wrap gap-2 mt-4">
          <button
            onClick={bulkUnlockAll}
            disabled={!!busyBulk || loading}
            className="flex items-center gap-1.5 text-xs font-semibold bg-amber-100 text-amber-800 hover:bg-amber-200 px-3 py-1.5 rounded-lg disabled:opacity-50"
          >
            {busyBulk === "unlock-all" ? <Loader2 size={11} className="animate-spin" /> : <Unlock size={11} />} Unlock all
          </button>
          <button
            onClick={bulkCompleteAll}
            disabled={!!busyBulk || loading}
            className="flex items-center gap-1.5 text-xs font-semibold bg-purple-100 text-purple-800 hover:bg-purple-200 px-3 py-1.5 rounded-lg disabled:opacity-50"
          >
            {busyBulk === "complete-all" ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} Complete entire journey (Recovery)
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`mb-4 flex items-start gap-2 rounded-xl border p-3 text-xs ${
          toast.type === "success" ? "bg-green-50 border-green-200 text-green-700" : "bg-red-50 border-red-200 text-red-700"
        }`}>
          {toast.type === "success" ? <CheckCircle2 size={13} className="mt-0.5" /> : <ShieldAlert size={13} className="mt-0.5" />}
          {toast.msg}
        </div>
      )}

      {/* Error / loading */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 flex items-center gap-2">
          <AlertCircle size={14} /> {error}
        </div>
      )}
      {loading && !journey && (
        <div className="flex items-center justify-center py-10 text-slate-400">
          <Loader2 size={16} className="animate-spin mr-2" /> Loading journey…
        </div>
      )}

      {/* Stage list */}
      {journey && (
        <div className="space-y-2">
          {journey.stages.map((stage, idx) => {
            const cfg = STATUS_CFG[stage.status];
            const isBusy = busyStage === stage.id;
            const isUnlockOnly = UNLOCK_ONLY_STAGES.has(stage.id);
            const canComplete = stage.canAdminUnlock && !isUnlockOnly;
            return (
              <div
                key={stage.id}
                className={`border border-slate-200 rounded-2xl p-4 ${cfg.rowBg}`}
              >
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0 text-[11px] font-bold text-slate-500">
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
                      <div className="flex items-center gap-2 min-w-0">
                        {cfg.icon}
                        <span className="text-sm font-bold text-slate-900">{stage.label}</span>
                        <code className="text-[10px] font-mono text-slate-400">{stage.id}</code>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${cfg.badge}`}>
                        {cfg.label}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed mb-2">{stage.description}</p>
                    {stage.adminUnlockedBy && (
                      <p className="text-[10px] text-amber-600 mb-2">
                        Override by {stage.adminUnlockedBy}
                        {stage.adminUnlockedAt && ` · ${new Date(stage.adminUnlockedAt).toLocaleString()}`}
                        {stage.adminUnlockNote && ` — ${stage.adminUnlockNote}`}
                      </p>
                    )}

                    <div className="flex items-center gap-1.5 flex-wrap">
                      {stage.route && (
                        <Link
                          href={stage.route}
                          target="_blank"
                          className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 border border-slate-200 bg-white px-2.5 py-1 rounded-lg hover:bg-slate-50"
                        >
                          <ExternalLink size={10} /> View
                        </Link>
                      )}
                      {stage.canAdminUnlock && (
                        <button
                          onClick={() => actUnlock(stage)}
                          disabled={isBusy}
                          className="flex items-center gap-1 text-[11px] font-semibold text-amber-700 border border-amber-200 bg-amber-50 px-2.5 py-1 rounded-lg hover:bg-amber-100 disabled:opacity-50"
                        >
                          <Unlock size={10} /> Unlock
                        </button>
                      )}
                      {canComplete && (
                        <button
                          onClick={() => actComplete(stage)}
                          disabled={isBusy}
                          className="flex items-center gap-1 text-[11px] font-semibold text-green-700 border border-green-200 bg-green-50 px-2.5 py-1 rounded-lg hover:bg-green-100 disabled:opacity-50"
                        >
                          <CheckCircle2 size={10} /> Done
                        </button>
                      )}
                      {stage.canSkip && (
                        <button
                          onClick={() => actSkip(stage)}
                          disabled={isBusy}
                          className="flex items-center gap-1 text-[11px] font-semibold text-slate-700 border border-slate-200 bg-white px-2.5 py-1 rounded-lg hover:bg-slate-50 disabled:opacity-50"
                        >
                          <SkipForward size={10} /> Skip
                        </button>
                      )}
                      {stage.canReopen && (
                        <button
                          onClick={() => actReopen(stage)}
                          disabled={isBusy}
                          className="flex items-center gap-1 text-[11px] font-semibold text-orange-700 border border-orange-200 bg-orange-50 px-2.5 py-1 rounded-lg hover:bg-orange-100 disabled:opacity-50"
                        >
                          <RotateCcw size={10} /> Reopen
                        </button>
                      )}
                      {stage.adminUnlocked && (
                        <button
                          onClick={() => actLock(stage)}
                          disabled={isBusy}
                          className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 border border-slate-200 bg-white px-2.5 py-1 rounded-lg hover:bg-slate-50 disabled:opacity-50"
                        >
                          <Lock size={10} /> Lock
                        </button>
                      )}
                      {isBusy && <Loader2 size={12} className="animate-spin text-slate-400 ml-1" />}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
