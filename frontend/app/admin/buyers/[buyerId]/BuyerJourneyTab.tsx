"use client";

import { useState, useEffect, useCallback } from "react";
import {
  CheckCircle2, Clock, Lock, Unlock, AlertCircle,
  Loader2, RefreshCw, ExternalLink,
  SkipForward, RotateCcw, MessageSquare, Bell, StickyNote,
} from "lucide-react";
import type {
  AdminBuyerJourney,
  JourneyStageView,
  StageStatus,
} from "@/lib/services/admin/buyer-journey-admin.service";
import { openBuyerPageAsAdmin } from "@/lib/admin/preview";

interface Props { buyerId: string }

const STATUS_CFG: Record<StageStatus, {
  icon: React.ReactNode; badge: string; rowBg: string; label: string;
}> = {
  COMPLETE:  { icon: <CheckCircle2 size={15} className="text-green-600" />,  badge: "bg-green-100 text-green-700 border-green-200",   rowBg: "bg-white",        label: "Complete"      },
  SKIPPED:   { icon: <CheckCircle2 size={15} className="text-slate-400" />,  badge: "bg-slate-100 text-slate-500 border-slate-200",   rowBg: "bg-slate-50/60",  label: "Skipped"       },
  ACTIVE:    { icon: <Clock size={15} className="text-al-primary" />,         badge: "bg-blue-100 text-al-primary border-blue-200",     rowBg: "bg-blue-50/30",   label: "Active"        },
  LOCKED:    { icon: <Lock size={15} className="text-slate-300" />,           badge: "bg-slate-100 text-slate-400 border-slate-200",   rowBg: "bg-white",        label: "Locked"        },
  UNLOCKED:  { icon: <Unlock size={15} className="text-amber-500" />,         badge: "bg-amber-100 text-amber-700 border-amber-200",   rowBg: "bg-amber-50/40",  label: "Admin Unlocked" },
};

// Stages that need an active deal to be organically completed
const NEEDS_DEAL = new Set(["financing","fee","insurance","contract","sign","pickup"]);

export default function BuyerJourneyTab({ buyerId }: Props) {
  const [journey, setJourney] = useState<AdminBuyerJourney | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Unlock state
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [unlockNote, setUnlockNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [actionOk, setActionOk] = useState<string | null>(null);

  // Mark-complete modal
  const [completeModal, setCompleteModal] = useState<string | null>(null);

  // New override modals + notes expansion
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
  const [skipModal, setSkipModal] = useState<string | null>(null);
  const [reopenModal, setReopenModal] = useState<string | null>(null);
  const [notifyModal, setNotifyModal] = useState<string | null>(null);

  function toggleNotes(stageId: string) {
    setExpandedNotes(prev => {
      const n = new Set(prev);
      if (n.has(stageId)) n.delete(stageId); else n.add(stageId);
      return n;
    });
  }

  const load = useCallback(async () => {
    setLoading(true); setFetchError(null);
    try {
      const res = await fetch(`/api/admin/buyers/${buyerId}/journey`);
      const json = await res.json() as {
        success: boolean;
        data?: { journey: AdminBuyerJourney };
        error?: { message: string };
      };
      if (!json.success) { setFetchError(json.error?.message ?? "Failed to load"); return; }
      setJourney(json.data?.journey ?? null);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Network error");
    } finally { setLoading(false); }
  }, [buyerId]);

  useEffect(() => { load(); }, [load]);

  function toggleSelect(id: string, canUnlock: boolean) {
    if (!canUnlock) return;
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function selectAllRemaining() {
    if (!journey) return;
    setSelected(new Set(
      journey.stages.filter(s => s.canAdminUnlock && s.status !== "UNLOCKED").map(s => s.id)
    ));
  }

  async function callApi(url: string, body: object): Promise<boolean> {
    setBusy(true); setActionErr(null); setActionOk(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json() as { success: boolean; data?: { unlockedCount?: number; lockedCount?: number; succeeded?: number; total?: number }; error?: { message: string } };
      if (!json.success) { setActionErr(json.error?.message ?? "Failed"); return false; }
      const count = json.data?.unlockedCount ?? json.data?.lockedCount ?? json.data?.succeeded ?? 0;
      const total = json.data?.total;
      setActionOk(total ? `${count}/${total} stages updated.` : `${count} stage${count === 1 ? "" : "s"} updated.`);
      setSelected(new Set()); setUnlockNote("");
      await load(); return true;
    } catch (err) { setActionErr(err instanceof Error ? err.message : "Network error"); return false; }
    finally { setBusy(false); }
  }

  function unlock(unlockAll = false) {
    if (!unlockAll && selected.size === 0) return;
    callApi(`/api/admin/buyers/${buyerId}/journey/unlock`, {
      stageIds: unlockAll ? undefined : Array.from(selected),
      unlockAll, note: unlockNote || undefined,
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

  const remaining = journey.stages.filter(s => s.canAdminUnlock && s.status !== "UNLOCKED");
  const hasActiveDeal = journey.stages.some(s => s.id === "select-deal" && s.status === "COMPLETE");

  return (
    <div className="space-y-5">

      {/* Progress bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-semibold text-slate-800">Journey Progress</p>
            <p className="text-xs text-slate-400 mt-0.5">
              {journey.completedCount} of {journey.totalCount} stages complete
              {" · "}Current: <span className="font-medium text-slate-600">{journey.currentStageId}</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-black text-al-primary">{journey.percentComplete}%</p>
            <p className="text-xs text-slate-400">complete</p>
          </div>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-2 bg-al-primary rounded-full transition-all duration-500"
            style={{ width: `${journey.percentComplete}%` }} />
        </div>
      </div>

      {/* Admin controls */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
        <p className="text-sm font-bold text-amber-800 mb-3">Admin Controls</p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-amber-700 mb-1.5">
              Reason / Note <span className="font-normal opacity-70">(optional — saved to audit log)</span>
            </label>
            <textarea value={unlockNote} onChange={e => setUnlockNote(e.target.value)}
              placeholder="e.g. Buyer confirmed eligibility by phone. Unlocking prequal manually."
              rows={2}
              className="w-full px-3 py-2 text-sm border border-amber-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-amber-300/40 resize-none" />
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={selectAllRemaining} disabled={remaining.length === 0}
              className="text-xs font-semibold border border-amber-300 text-amber-700 px-3 py-1.5 rounded-lg hover:bg-amber-100 disabled:opacity-40">
              Select All Remaining ({remaining.length})
            </button>

            {selected.size > 0 && (
              <button onClick={() => unlock(false)} disabled={busy}
                className="text-xs font-bold bg-amber-500 text-white px-4 py-1.5 rounded-lg hover:bg-amber-600 flex items-center gap-1.5 disabled:opacity-50">
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Unlock size={12} />}
                Unlock {selected.size} Stage{selected.size > 1 ? "s" : ""}
              </button>
            )}

            <button onClick={() => { if (!confirm("Unlock entire journey for this buyer?")) return; unlock(true); }} disabled={busy}
              className="text-xs font-bold bg-red-500 text-white px-4 py-1.5 rounded-lg hover:bg-red-600 flex items-center gap-1.5 disabled:opacity-50">
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Unlock size={12} />}
              Unlock Entire Journey
            </button>

            <button onClick={async () => {
              if (!unlockNote.trim()) { setActionErr("Reason is required for complete-all"); return; }
              if (!confirm(
                "⚠️ RECOVERY TOOL — Complete ALL 14 stages?\n\nThis writes real DB records and is designed for edge-case recovery, not normal operations. Partial failures will not roll back.\n\nContinue?"
              )) return;
              setBusy(true); setActionErr(null); setActionOk(null);
              try {
                const res = await fetch(`/api/admin/buyers/${buyerId}/journey/complete-all`, {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ note: unlockNote }),
                });
                const json = await res.json() as { success: boolean; data?: { succeeded: number; total: number; results: Array<{ stageId: string; success: boolean; error?: string }> }; error?: { message: string } };
                if (!json.success) { setActionErr(json.error?.message ?? "Failed"); return; }
                const { succeeded, total, results } = json.data!;
                const failed = results.filter(r => !r.success);
                setActionOk(failed.length > 0
                  ? `${succeeded}/${total} completed. Failed: ${failed.map(f => f.stageId).join(", ")}`
                  : `All ${succeeded} stages completed successfully.`);
                await load();
              } catch (err) { setActionErr(err instanceof Error ? err.message : "Network error"); }
              finally { setBusy(false); }
            }} disabled={busy}
              className="text-xs font-bold bg-red-600 text-white px-4 py-1.5 rounded-lg hover:bg-red-700 flex items-center gap-1.5 disabled:opacity-40"
              title="Recovery tool — use only for edge-case manual interventions">
              {busy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
              ⚠ Complete Entire Journey (Recovery)
            </button>

            <button onClick={load} disabled={busy}
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

      {/* Stage list */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="hidden md:grid grid-cols-[24px_1fr_auto_auto] gap-3 px-4 py-2.5 bg-slate-50 border-b text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          <span /> <span>Stage</span> <span>Status</span> <span className="w-40 text-right">Actions</span>
        </div>

        <div className="divide-y divide-slate-50">
          {journey.stages.map((stage: JourneyStageView, idx: number) => {
            const cfg = STATUS_CFG[stage.status];
            const isSel = selected.has(stage.id);
            const notesOpen = expandedNotes.has(stage.id);
            return (
              <div key={stage.id} className={cfg.rowBg}>
              <div
                className={["grid grid-cols-[24px_1fr_auto_auto] gap-3 px-4 py-3 items-center",
                  isSel ? "ring-2 ring-inset ring-amber-400" : "",
                  stage.canAdminUnlock ? "cursor-pointer select-none" : "",
                ].filter(Boolean).join(" ")}
                onClick={stage.canAdminUnlock ? () => toggleSelect(stage.id, stage.canAdminUnlock) : undefined}
                data-testid={`journey-stage-${stage.id}`}>

                {/* Checkbox */}
                <div className={["w-5 h-5 rounded border-2 flex items-center justify-center shrink-0",
                  !stage.canAdminUnlock ? "border-transparent" :
                  isSel ? "border-amber-400 bg-amber-400" : "border-slate-200",
                ].join(" ")}>
                  {isSel && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>

                {/* Info */}
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {cfg.icon}
                    <span className="text-[10px] font-mono text-slate-300">{String(idx + 1).padStart(2, "0")}</span>
                    <span className="text-sm font-semibold text-slate-800">{stage.label}</span>
                    <code className="text-[10px] font-mono text-slate-300 hidden sm:inline">{stage.id}</code>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{stage.description}</p>
                  {stage.status === "UNLOCKED" && (
                    <p className="text-[10px] text-amber-600 mt-0.5">
                      Unlocked by {stage.adminUnlockedBy}
                      {stage.adminUnlockedAt ? ` · ${new Date(stage.adminUnlockedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}
                      {stage.adminUnlockNote ? ` · "${stage.adminUnlockNote}"` : ""}
                    </p>
                  )}
                </div>

                {/* Status badge */}
                <span className={["text-[10px] font-bold uppercase tracking-wide border px-2 py-0.5 rounded-full whitespace-nowrap", cfg.badge].join(" ")}>
                  {cfg.label}
                </span>

                {/* Action buttons */}
                <div className="w-40 flex items-center justify-end gap-1.5 shrink-0 flex-wrap">
                  {stage.route && (
                    <button
                      onClick={async e => {
                        e.stopPropagation();
                        await openBuyerPageAsAdmin({
                          buyerId,
                          stageRoute: stage.route!,
                        });
                      }}
                      className="text-xs font-medium text-slate-400 border border-slate-200 px-2 py-0.5 rounded-lg hover:text-al-primary hover:border-al-primary/30 flex items-center gap-1 whitespace-nowrap"
                      title={`Preview buyer's ${stage.label} page`}
                    >
                      <ExternalLink size={11} /> View
                    </button>
                  )}
                  {stage.canAdminUnlock && stage.status !== "COMPLETE" && stage.status !== "SKIPPED" && (() => {
                    // These stages cannot be synthetically completed — admin unlock gives access only
                    const UNLOCK_ONLY_STAGES = new Set(["auction", "select-deal", "shortlist"]);
                    const isUnlockOnly = UNLOCK_ONLY_STAGES.has(stage.id);
                    return isUnlockOnly ? (
                      <button
                        onClick={e => { e.stopPropagation(); callApi(`/api/admin/buyers/${buyerId}/journey/unlock`, { stageIds: [stage.id], note: unlockNote || undefined }); }}
                        disabled={busy}
                        className="text-xs font-semibold border border-amber-200 text-amber-700 px-2 py-0.5 rounded-lg hover:bg-amber-50 flex items-center gap-1 whitespace-nowrap disabled:opacity-40">
                        <Unlock size={11} /> Unlock
                      </button>
                    ) : (
                      <button onClick={e => { e.stopPropagation(); setCompleteModal(stage.id); }}
                        disabled={busy}
                        className="text-xs font-bold text-green-700 border border-green-200 px-2 py-0.5 rounded-lg hover:bg-green-50 flex items-center gap-1 whitespace-nowrap disabled:opacity-40">
                        <CheckCircle2 size={11} /> Done
                      </button>
                    );
                  })()}
                  {stage.status === "UNLOCKED" && (
                    <button onClick={e => { e.stopPropagation(); relock(stage.id); }}
                      disabled={busy}
                      className="text-xs font-semibold text-red-500 border border-red-200 px-2 py-0.5 rounded-lg hover:bg-red-50 whitespace-nowrap">
                      Lock
                    </button>
                  )}

                  {stage.canSkip && (
                    <button onClick={e => { e.stopPropagation(); setSkipModal(stage.id); }}
                      className="text-xs font-semibold border border-purple-200 text-purple-700 px-2 py-0.5 rounded-lg hover:bg-purple-50 flex items-center gap-1">
                      <SkipForward size={11} /> Skip
                    </button>
                  )}

                  {stage.canReopen && (
                    <button onClick={e => { e.stopPropagation(); setReopenModal(stage.id); }}
                      className="text-xs font-semibold border border-orange-200 text-orange-700 px-2 py-0.5 rounded-lg hover:bg-orange-50 flex items-center gap-1">
                      <RotateCcw size={11} /> Reopen
                    </button>
                  )}

                  <button onClick={e => { e.stopPropagation(); setNotifyModal(stage.id); }}
                    className="text-xs border border-slate-200 text-slate-500 px-2 py-0.5 rounded-lg hover:bg-slate-50 flex items-center gap-1"
                    title="Send reminder to buyer">
                    <Bell size={11} />
                  </button>

                  <button onClick={e => { e.stopPropagation(); toggleNotes(stage.id); }}
                    className="text-xs border border-slate-200 text-slate-500 px-2 py-0.5 rounded-lg hover:bg-slate-50 flex items-center gap-1"
                    title="Stage notes">
                    <StickyNote size={11} />
                    {stage.notes.length > 0 && (
                      <span className="text-[10px] font-bold text-al-primary">{stage.notes.length}</span>
                    )}
                  </button>
                </div>
              </div>

              {notesOpen && (
                <div className="px-12 pb-4 bg-slate-50/50 border-t border-slate-100">
                  {stage.notes.length > 0 && (
                    <div className="pt-3 space-y-2 mb-3">
                      {stage.notes.map(n => (
                        <div key={n.id} className="bg-white border border-slate-200 rounded-xl px-3 py-2">
                          <p className="text-xs text-slate-600 whitespace-pre-wrap">{n.content}</p>
                          <p className="text-[10px] text-slate-400 mt-1">
                            {n.adminEmail} · {new Date(n.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                  <NoteInline buyerId={buyerId} stageId={stage.id} onAdded={load} />
                </div>
              )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Mark Complete Modal */}
      {completeModal && journey && (() => {
        const stage = journey.stages.find(s => s.id === completeModal);
        if (!stage) return null;
        return (
          <MarkCompleteModal
            stageId={stage.id} stageLabel={stage.label}
            buyerId={buyerId} hasActiveDeal={hasActiveDeal}
            needsDeal={NEEDS_DEAL.has(stage.id)}
            onClose={() => setCompleteModal(null)}
            onSuccess={async (label) => {
              setCompleteModal(null);
              setActionOk(`Stage "${label}" marked as complete.`);
              await load();
            }}
          />
        );
      })()}

      {skipModal && (
        <SimpleModal
          title="Skip Stage"
          submitLabel="Skip Stage"
          subtitle="This stage will be bypassed and count as complete for journey progression."
          buyerId={buyerId} stageId={skipModal}
          apiPath="skip" requireReason
          onClose={() => setSkipModal(null)}
          onSuccess={async msg => { setSkipModal(null); setActionOk(msg); await load(); }}
        />
      )}

      {reopenModal && (
        <SimpleModal
          title="Reopen Stage"
          submitLabel="Reopen Stage"
          subtitle="This will reverse the DB state for this stage. The buyer must complete it again."
          buyerId={buyerId} stageId={reopenModal}
          apiPath="reopen" requireReason
          onClose={() => setReopenModal(null)}
          onSuccess={async msg => { setReopenModal(null); setActionOk(msg); await load(); }}
        />
      )}

      {notifyModal && (
        <SimpleModal
          title="Send Reminder"
          submitLabel="Send"
          subtitle="Send a notification to the buyer for this stage."
          buyerId={buyerId} stageId={notifyModal}
          apiPath="notify" requireReason showMessage
          onClose={() => setNotifyModal(null)}
          onSuccess={async msg => { setNotifyModal(null); setActionOk(msg); await load(); }}
        />
      )}
    </div>
  );
}

// ─── Mark Complete Modal ──────────────────────────────────────────────────────

function MarkCompleteModal({
  stageId, stageLabel, buyerId, hasActiveDeal, needsDeal, onClose, onSuccess,
}: {
  stageId: string; stageLabel: string; buyerId: string;
  hasActiveDeal: boolean; needsDeal: boolean;
  onClose: () => void; onSuccess: (label: string) => void;
}) {
  const [note, setNote] = useState("");
  const [maxOtd, setMaxOtd] = useState(50000);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/admin/buyers/${buyerId}/journey/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stageId, note: note || undefined,
          ...(stageId === "prequal" ? { maxOtdAmountCents: maxOtd * 100 } : {}),
        }),
      });
      const data = await res.json() as { success: boolean; error?: { message: string } };
      if (!data.success) { setError(data.error?.message ?? "Failed"); return; }
      onSuccess(stageLabel);
    } catch (err) { setError(err instanceof Error ? err.message : "Network error"); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <h3 className="font-bold text-lg text-slate-900 mb-1">
          Mark &ldquo;{stageLabel}&rdquo; as Complete
        </h3>
        <p className="text-xs text-slate-500 mb-4 leading-relaxed">
          Writes real DB records to advance the buyer. The buyer sees this stage
          as complete immediately after their next page load.
        </p>

        {needsDeal && !hasActiveDeal && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-700 mb-4">
            ⚠️ This stage requires an active deal. None found — the stage will be
            admin-unlocked but not organically completed in the DB.
          </div>
        )}

        {stageId === "prequal" && (
          <div className="mb-4">
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Approved Max OTD Budget (USD)
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
              <input type="number" value={maxOtd} onChange={e => setMaxOtd(Number(e.target.value))}
                className="w-full pl-7 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-al-primary/20"
                min={1000} step={5000} />
            </div>
            <p className="text-xs text-slate-400 mt-1">Default $50,000. Sets the buyer&apos;s approved purchase budget.</p>
          </div>
        )}

        <div className="mb-4">
          <label className="block text-xs font-medium text-slate-700 mb-1.5">
            Admin Note <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <textarea value={note} onChange={e => setNote(e.target.value)}
            placeholder="e.g. Completing on behalf of buyer per phone call 5/13/26"
            rows={2}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-al-primary/20 resize-none" />
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-700 mb-3">
            <AlertCircle size={12} /> {error}
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={onClose}
            className="flex-1 border border-slate-200 text-slate-600 font-medium py-2.5 rounded-xl hover:bg-slate-50 text-sm">
            Cancel
          </button>
          <button onClick={submit} disabled={loading}
            className="flex-[2] bg-al-primary text-white font-bold py-2.5 rounded-xl hover:bg-[#0944a8] text-sm flex items-center justify-center gap-2 disabled:opacity-40">
            {loading ? <><Loader2 size={14} className="animate-spin" /> Completing…</> : "✓ Mark as Complete"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Inline note input ───────────────────────────────────────────────────────

function NoteInline({
  buyerId, stageId, onAdded,
}: { buyerId: string; stageId: string; onAdded: () => void }) {
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!content.trim()) return;
    setSaving(true); setErr(null);
    try {
      const res = await fetch(`/api/admin/buyers/${buyerId}/journey/note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageId, content }),
      });
      const json = await res.json() as { success: boolean; error?: { message: string } };
      if (!json.success) { setErr(json.error?.message ?? "Failed"); return; }
      setContent("");
      onAdded();
    } catch { setErr("Network error"); }
    finally { setSaving(false); }
  }

  return (
    <div className="flex gap-2 pt-2">
      <input
        type="text"
        value={content}
        onChange={e => setContent(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); save(); } }}
        placeholder="Add internal note for this stage…"
        className="flex-1 px-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-al-primary/20 bg-white"
      />
      <button onClick={save} disabled={saving || !content.trim()}
        className="text-xs font-semibold bg-al-primary text-white px-3 py-1.5 rounded-lg hover:bg-[#0944a8] disabled:opacity-40 flex items-center gap-1">
        {saving ? <Loader2 size={10} className="animate-spin" /> : <MessageSquare size={10} />} Add
      </button>
      {err && <p className="text-xs text-red-500 self-center">{err}</p>}
    </div>
  );
}

// ─── Reusable modal for Skip / Reopen / Notify ──────────────────────────────

function SimpleModal({
  title, submitLabel, subtitle, buyerId, stageId, apiPath, requireReason,
  showMessage = false, onClose, onSuccess,
}: {
  title: string;
  submitLabel: string;
  subtitle?: string;
  buyerId: string;
  stageId: string;
  apiPath: "skip" | "reopen" | "notify";
  requireReason: boolean;
  showMessage?: boolean;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (requireReason && !reason.trim()) { setErr("Reason is required"); return; }
    setLoading(true); setErr(null);
    try {
      const body: Record<string, unknown> = { stageId };
      if (reason) body.reason = reason;
      if (showMessage && message) body.message = message;
      const res = await fetch(
        `/api/admin/buyers/${buyerId}/journey/${apiPath}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      );
      const json = await res.json() as { success: boolean; error?: { message: string } };
      if (!json.success) { setErr(json.error?.message ?? "Action failed"); return; }
      onSuccess(`Stage "${stageId}" ${title.toLowerCase()}d.`);
    } catch (e) { setErr(e instanceof Error ? e.message : "Network error"); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <h3 className="font-bold text-lg text-slate-900 mb-1">{title}</h3>
        {subtitle && <p className="text-xs text-slate-500 mb-4">{subtitle}</p>}

        {showMessage && (
          <div className="mb-4">
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Message to buyer <span className="font-normal text-slate-400">(leave blank for default)</span>
            </label>
            <textarea value={message} onChange={e => setMessage(e.target.value)} rows={2}
              placeholder="Leave blank to use the default message for this stage"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-al-primary/20 resize-none" />
          </div>
        )}

        {requireReason && (
          <div className="mb-4">
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Reason <span className="text-red-500">*</span>
            </label>
            <input type="text" value={reason} onChange={e => setReason(e.target.value)}
              placeholder="e.g. Buyer confirmed by phone"
              className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-al-primary/20" />
          </div>
        )}

        {err && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-700 mb-3">
            <AlertCircle size={12} /> {err}
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={onClose}
            className="flex-1 border border-slate-200 text-slate-600 font-medium py-2.5 rounded-xl hover:bg-slate-50 text-sm">
            Cancel
          </button>
          <button onClick={submit} disabled={loading}
            className="flex-[2] bg-al-primary text-white font-bold py-2.5 rounded-xl hover:bg-[#0944a8] text-sm flex items-center justify-center gap-2 disabled:opacity-40">
            {loading ? <><Loader2 size={14} className="animate-spin" /> Working…</> : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
