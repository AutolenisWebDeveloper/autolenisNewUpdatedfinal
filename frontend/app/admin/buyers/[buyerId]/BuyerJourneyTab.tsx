"use client";

import { useState, useEffect, useCallback } from "react";
import {
  CheckCircle2, Clock, Lock, Unlock, AlertCircle,
  Loader2, RefreshCw, ExternalLink,
} from "lucide-react";
import type {
  AdminBuyerJourney,
  JourneyStageView,
  StageStatus,
} from "@/lib/services/admin/buyer-journey-admin.service";

interface Props { buyerId: string }

const STATUS_CFG: Record<StageStatus, {
  icon: React.ReactNode;
  badge: string;
  rowBg: string;
  label: string;
}> = {
  COMPLETE: {
    icon: <CheckCircle2 size={15} className="text-green-600" />,
    badge: "bg-green-100 text-green-700 border-green-200",
    rowBg: "bg-white",
    label: "Complete",
  },
  ACTIVE: {
    icon: <Clock size={15} className="text-[#0B5FD1]" />,
    badge: "bg-blue-100 text-[#0B5FD1] border-blue-200",
    rowBg: "bg-blue-50/30",
    label: "Active",
  },
  LOCKED: {
    icon: <Lock size={15} className="text-slate-300" />,
    badge: "bg-slate-100 text-slate-400 border-slate-200",
    rowBg: "bg-white",
    label: "Locked",
  },
  ADMIN_UNLOCKED: {
    icon: <Unlock size={15} className="text-amber-500" />,
    badge: "bg-amber-100 text-amber-700 border-amber-200",
    rowBg: "bg-amber-50/40",
    label: "Admin Unlocked",
  },
};

export default function BuyerJourneyTab({ buyerId }: Props) {
  const [journey, setJourney] = useState<AdminBuyerJourney | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [actionOk, setActionOk] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch(`/api/admin/buyers/${buyerId}/journey`);
      const json = await res.json() as {
        success: boolean;
        data?: { journey: AdminBuyerJourney };
        error?: { message: string };
      };
      if (!json.success) { setFetchError(json.error?.message ?? "Failed to load"); return; }
      setJourney(json.data?.journey ?? null);
    } catch (err) { setFetchError(err instanceof Error ? err.message : "Network error"); }
    finally { setLoading(false); }
  }, [buyerId]);

  useEffect(() => { load(); }, [load]);

  function toggleSelect(id: string, canUnlock: boolean) {
    if (!canUnlock) return;
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function selectAllRemaining() {
    if (!journey) return;
    setSelected(new Set(
      journey.stages.filter(s => s.canAdminUnlock && s.status !== "ADMIN_UNLOCKED").map(s => s.id)
    ));
  }

  async function callApi(url: string, body: object): Promise<boolean> {
    setBusy(true); setActionErr(null); setActionOk(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json() as {
        success: boolean;
        data?: { unlockedCount?: number; lockedCount?: number };
        error?: { message: string };
      };
      if (!json.success) { setActionErr(json.error?.message ?? "Failed"); return false; }
      const n = json.data?.unlockedCount ?? json.data?.lockedCount ?? 0;
      setActionOk(`${n} stage${n === 1 ? "" : "s"} updated.`);
      setSelected(new Set());
      setNote("");
      await load();
      return true;
    } catch { setActionErr("Network error"); return false; }
    finally { setBusy(false); }
  }

  function unlock(unlockAll = false) {
    if (!unlockAll && selected.size === 0) return;
    callApi(`/api/admin/buyers/${buyerId}/journey/unlock`, {
      stageIds: unlockAll ? undefined : Array.from(selected),
      unlockAll,
      note: note || undefined,
    });
  }

  function relock(stageId: string) {
    callApi(`/api/admin/buyers/${buyerId}/journey/lock`, { stageIds: [stageId] });
  }

  if (loading) return (
    <div className="flex items-center justify-center py-16 gap-2 text-slate-400 text-sm">
      <Loader2 size={16} className="animate-spin" /> Loading journey…
    </div>
  );

  if (fetchError || !journey) return (
    <div className="flex items-center justify-center py-16 gap-2 text-red-500 text-sm">
      <AlertCircle size={15} /> {fetchError ?? "Journey not found"}
    </div>
  );

  const remaining = journey.stages.filter(s => s.canAdminUnlock && s.status !== "ADMIN_UNLOCKED");

  return (
    <div className="space-y-5">

      {/* Progress */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-semibold text-slate-800">Journey Progress</p>
            <p className="text-xs text-slate-400 mt-0.5">
              {journey.completedCount} of {journey.totalCount} stages complete
              {" · "}Current stage:{" "}
              <span className="font-medium text-slate-600">{journey.currentStageId}</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-black text-[#0B5FD1]">{journey.percentComplete}%</p>
            <p className="text-xs text-slate-400">complete</p>
          </div>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-2 bg-[#0B5FD1] rounded-full transition-all duration-500"
            style={{ width: `${journey.percentComplete}%` }}
          />
        </div>
      </div>

      {/* Admin controls */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
        <p className="text-sm font-bold text-amber-800 mb-3">Admin Unlock Controls</p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-amber-700 mb-1.5">
              Reason / Note <span className="font-normal opacity-70">(optional — written to audit log)</span>
            </label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="e.g. Buyer confirmed eligibility by phone. Unlocking prequal manually."
              rows={2}
              className="w-full px-3 py-2 text-sm border border-amber-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-amber-300/40 resize-none"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={selectAllRemaining}
              disabled={remaining.length === 0}
              className="text-xs font-semibold border border-amber-300 text-amber-700 px-3 py-1.5 rounded-lg hover:bg-amber-100 disabled:opacity-40 disabled:cursor-not-allowed">
              Select All Remaining ({remaining.length})
            </button>

            {selected.size > 0 && (
              <button
                onClick={() => unlock(false)}
                disabled={busy}
                className="text-xs font-bold bg-amber-500 text-white px-4 py-1.5 rounded-lg hover:bg-amber-600 flex items-center gap-1.5 disabled:opacity-50">
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Unlock size={12} />}
                Unlock {selected.size} Stage{selected.size > 1 ? "s" : ""}
              </button>
            )}

            <button
              onClick={() => {
                if (!confirm("Unlock the entire buyer journey? This will be logged.")) return;
                unlock(true);
              }}
              disabled={busy}
              className="text-xs font-bold bg-red-500 text-white px-4 py-1.5 rounded-lg hover:bg-red-600 flex items-center gap-1.5 disabled:opacity-50">
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Unlock size={12} />}
              Unlock Entire Journey
            </button>

            <button
              onClick={load}
              disabled={busy}
              className="text-xs border border-slate-200 text-slate-600 px-3 py-1.5 rounded-lg hover:bg-slate-50 flex items-center gap-1.5">
              <RefreshCw size={12} /> Refresh
            </button>
          </div>

          {actionErr && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-700">
              <AlertCircle size={12} /> {actionErr}
            </div>
          )}
          {actionOk && (
            <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2 text-xs text-green-700">
              <CheckCircle2 size={12} /> {actionOk}
            </div>
          )}
        </div>
      </div>

      {/* Stage table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="hidden md:grid grid-cols-[24px_1fr_auto_auto] gap-3 px-4 py-2.5 bg-slate-50 border-b text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          <span />
          <span>Stage</span>
          <span>Status</span>
          <span className="w-16 text-right">Actions</span>
        </div>

        <div className="divide-y divide-slate-50">
          {journey.stages.map((stage: JourneyStageView, idx: number) => {
            const cfg = STATUS_CFG[stage.status];
            const isSel = selected.has(stage.id);
            const clickable = stage.canAdminUnlock;

            return (
              <div
                key={stage.id}
                className={[
                  "grid grid-cols-[24px_1fr_auto_auto] gap-3 px-4 py-3 items-center",
                  cfg.rowBg,
                  isSel ? "ring-2 ring-inset ring-amber-400" : "",
                  clickable ? "cursor-pointer select-none" : "",
                ].filter(Boolean).join(" ")}
                onClick={clickable ? () => toggleSelect(stage.id, clickable) : undefined}
                data-testid={`journey-stage-${stage.id}`}
              >
                {/* Checkbox */}
                <div className={[
                  "w-5 h-5 rounded border-2 flex items-center justify-center shrink-0",
                  !clickable ? "border-transparent" :
                  isSel ? "border-amber-400 bg-amber-400" : "border-slate-200",
                ].join(" ")}>
                  {isSel && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24"
                      stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>

                {/* Stage info */}
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {cfg.icon}
                    <span className="text-[10px] font-mono text-slate-300">
                      {String(idx + 1).padStart(2, "0")}
                    </span>
                    <span className="text-sm font-semibold text-slate-800">
                      {stage.label}
                    </span>
                    <code className="text-[10px] font-mono text-slate-300 hidden sm:inline">
                      {stage.id}
                    </code>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                    {stage.description}
                  </p>
                  {stage.status === "ADMIN_UNLOCKED" && (
                    <p className="text-[10px] text-amber-600 mt-0.5">
                      Unlocked by {stage.adminUnlockedBy}
                      {stage.adminUnlockedAt
                        ? ` · ${new Date(stage.adminUnlockedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                        : ""}
                      {stage.adminUnlockNote ? ` · "${stage.adminUnlockNote}"` : ""}
                    </p>
                  )}
                </div>

                {/* Status badge */}
                <span className={[
                  "text-[10px] font-bold uppercase tracking-wide border px-2 py-0.5 rounded-full whitespace-nowrap",
                  cfg.badge,
                ].join(" ")}>
                  {cfg.label}
                </span>

                {/* Action buttons */}
                <div className="w-16 flex items-center justify-end gap-1.5">
                  {stage.route && (
                    <a
                      href={stage.route}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="text-slate-300 hover:text-[#0B5FD1] transition-colors"
                      title={`Open ${stage.label} buyer page`}>
                      <ExternalLink size={13} />
                    </a>
                  )}
                  {stage.status === "ADMIN_UNLOCKED" && (
                    <button
                      onClick={e => { e.stopPropagation(); relock(stage.id); }}
                      disabled={busy}
                      className="text-[10px] font-semibold text-red-500 border border-red-200 px-1.5 py-0.5 rounded-lg hover:bg-red-50 whitespace-nowrap disabled:opacity-40"
                      data-testid={`relock-${stage.id}`}>
                      Re-lock
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
