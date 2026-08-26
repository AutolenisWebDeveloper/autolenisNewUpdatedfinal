"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, Flag, RotateCcw, AlertTriangle, Loader2, X } from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api/client";

type ReviewAction = "APPROVE" | "FLAG" | "REQUEST_REVISION";

const ACTION_META: Record<ReviewAction, { title: string; verb: string; intent: string; needsReason: boolean; needsIssues: boolean; description: string }> = {
  APPROVE: {
    title: "Approve Contract",
    verb: "Approve",
    intent: "bg-green-600 hover:bg-green-700",
    needsReason: false,
    needsIssues: false,
    description: "Marks the contract as passed, advances the deal to the signing stage, and sends the buyer their secure in-app signing link. The dealer is notified of approval.",
  },
  FLAG: {
    title: "Flag Contract",
    verb: "Flag",
    intent: "bg-amber-600 hover:bg-amber-700",
    needsReason: false,
    needsIssues: true,
    description: "Flags the contract with the specific issues below. Buyer and dealer are both notified. The deal stage is not changed.",
  },
  REQUEST_REVISION: {
    title: "Request Revision",
    verb: "Request Revision",
    intent: "bg-al-primary hover:bg-[#0a52b5]",
    needsReason: true,
    needsIssues: false,
    description: "Sends the contract back to the dealer for a corrected upload with the reason below. The dealer is asked to revise; the buyer is told a minor revision is in progress.",
  },
};

export default function ContractShieldReviewActions({ reviewId }: { reviewId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState<ReviewAction | null>(null);
  const [reason, setReason] = useState("");
  const [issuesText, setIssuesText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setOpen(null); setReason(""); setIssuesText(""); setError(null); setLoading(false);
  }

  async function submit() {
    if (!open) return;
    const meta = ACTION_META[open];
    const issues = issuesText.split("\n").map(s => s.trim()).filter(Boolean);
    if (meta.needsReason && !reason.trim()) { setError("A reason is required."); return; }
    if (meta.needsIssues && issues.length === 0) { setError("List at least one issue (one per line)."); return; }

    setLoading(true); setError(null);
    try {
      await api.post(`/api/admin/contract-shield/${reviewId}`, { action: open, reason: reason.trim() || undefined, issues });
      reset();
      router.refresh();
    } catch (err) {
      setError(apiErrorMessage(err, "Action failed.")); setLoading(false);
    }
  }

  const meta = open ? ACTION_META[open] : null;

  return (
    <>
      <div className="flex flex-wrap gap-2 mt-3" data-testid={`shield-review-actions-${reviewId}`}>
        <Button size="sm" variant="secondary" className="text-xs" data-testid={`shield-approve-${reviewId}`}
          onClick={() => setOpen("APPROVE")}>
          <CheckCircle2 size={13} className="text-green-600" /> Approve
        </Button>
        <Button size="sm" variant="secondary" className="text-xs" data-testid={`shield-flag-${reviewId}`}
          onClick={() => setOpen("FLAG")}>
          <Flag size={13} className="text-amber-600" /> Flag
        </Button>
        <Button size="sm" variant="secondary" className="text-xs" data-testid={`shield-revision-${reviewId}`}
          onClick={() => setOpen("REQUEST_REVISION")}>
          <RotateCcw size={13} className="text-al-primary" /> Request Revision
        </Button>
      </div>

      {open && meta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true"
          data-testid="shield-review-modal" onClick={e => { if (e.target === e.currentTarget && !loading) reset(); }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-start justify-between mb-3">
              <h3 className="font-bold text-slate-900">{meta.title}</h3>
              <button onClick={() => !loading && reset()} className="text-slate-400 hover:text-slate-600" aria-label="Close" data-testid="shield-modal-close">
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-slate-500 mb-4">{meta.description}</p>

            {meta.needsIssues && (
              <div className="mb-4">
                <label className="text-xs font-medium text-slate-600 mb-1.5 block">Issues (one per line)</label>
                <Textarea value={issuesText} onChange={e => setIssuesText(e.target.value)}
                  placeholder={"Missing odometer disclosure\nUndisclosed dealer fee\n…"}
                  className="text-sm min-h-[96px]" data-testid="shield-issues-input" />
              </div>
            )}
            {(meta.needsReason || open === "FLAG") && (
              <div className="mb-4">
                <label className="text-xs font-medium text-slate-600 mb-1.5 block">
                  {meta.needsReason ? "Reason (required)" : "Note (optional)"}
                </label>
                <Textarea value={reason} onChange={e => setReason(e.target.value)}
                  placeholder="Describe the reason for this decision…"
                  className="text-sm min-h-[72px]" data-testid="shield-reason-input" />
              </div>
            )}

            {error && (
              <div className="text-xs px-3 py-2 rounded-lg mb-3 flex items-center gap-2 bg-red-50 text-red-700" data-testid="shield-modal-error">
                <AlertTriangle size={13} /> {error}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" disabled={loading} onClick={reset} data-testid="shield-modal-cancel">
                Cancel
              </Button>
              <Button size="sm" disabled={loading} onClick={submit} data-testid="shield-modal-confirm"
                className={`text-white ${meta.intent}`}>
                {loading ? <><Loader2 size={13} className="animate-spin" /> Working…</> : meta.verb}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
