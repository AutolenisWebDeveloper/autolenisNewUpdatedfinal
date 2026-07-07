"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ShieldCheck, AlertTriangle, Loader2, X } from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api/client";

type OfacAction = "CLEAR" | "ESCALATE";

const META: Record<OfacAction, { title: string; verb: string; intent: string; description: string }> = {
  CLEAR: {
    title: "Clear OFAC Flag",
    verb: "Clear Flag",
    intent: "bg-green-600 hover:bg-green-700",
    description: "Marks the buyer as approved and resumes their progress automatically. The buyer is notified they are pre-qualified. This is recorded in the audit log with your reason.",
  },
  ESCALATE: {
    title: "Escalate to Legal",
    verb: "Escalate",
    intent: "bg-red-600 hover:bg-red-700",
    description: "Routes this OFAC hit to the legal team. The buyer's progress stays frozen and they are not notified. Recorded in the audit log with your reason.",
  },
};

export default function OfacReviewActions({ prequalId, decision }: { prequalId: string; decision: string }) {
  const router = useRouter();
  const [open, setOpen] = useState<OfacAction | null>(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() { setOpen(null); setReason(""); setError(null); setLoading(false); }

  async function submit() {
    if (!open) return;
    if (!reason.trim()) { setError("A reason is required."); return; }
    setLoading(true); setError(null);
    try {
      await api.post(`/api/admin/compliance/ofac/${prequalId}`, { action: open, reason: reason.trim() });
      reset();
      router.refresh();
    } catch (err) {
      setError(apiErrorMessage(err, "Action failed.")); setLoading(false);
    }
  }

  const meta = open ? META[open] : null;
  const alreadyEscalated = decision === "OFAC_ESCALATED";

  return (
    <>
      <div className="flex flex-wrap gap-2" data-testid={`ofac-actions-${prequalId}`}>
        <Button size="sm" variant="secondary" className="text-xs" data-testid={`ofac-clear-${prequalId}`}
          onClick={() => setOpen("CLEAR")}>
          <ShieldCheck size={13} className="text-green-600" /> Clear Flag
        </Button>
        <Button size="sm" variant="secondary" className="text-xs" data-testid={`ofac-escalate-${prequalId}`}
          disabled={alreadyEscalated} title={alreadyEscalated ? "Already escalated to legal" : undefined}
          onClick={() => setOpen("ESCALATE")}>
          <AlertTriangle size={13} className="text-red-600" /> {alreadyEscalated ? "Escalated" : "Escalate"}
        </Button>
      </div>

      {open && meta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true"
          data-testid="ofac-modal" onClick={e => { if (e.target === e.currentTarget && !loading) reset(); }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-start justify-between mb-3">
              <h3 className="font-bold text-slate-900">{meta.title}</h3>
              <button onClick={() => !loading && reset()} className="text-slate-400 hover:text-slate-600" aria-label="Close" data-testid="ofac-modal-close">
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-slate-500 mb-4">{meta.description}</p>
            <div className="mb-4">
              <label className="text-xs font-medium text-slate-600 mb-1.5 block">Reason (required)</label>
              <Textarea value={reason} onChange={e => setReason(e.target.value)}
                placeholder="Document the basis for this decision…"
                className="text-sm min-h-[80px]" data-testid="ofac-reason-input" />
            </div>
            {error && (
              <div className="text-xs px-3 py-2 rounded-lg mb-3 flex items-center gap-2 bg-red-50 text-red-700" data-testid="ofac-modal-error">
                <AlertTriangle size={13} /> {error}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" disabled={loading} onClick={reset} data-testid="ofac-modal-cancel">Cancel</Button>
              <Button size="sm" disabled={loading} onClick={submit} data-testid="ofac-modal-confirm" className={`text-white ${meta.intent}`}>
                {loading ? <><Loader2 size={13} className="animate-spin" /> Working…</> : meta.verb}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
