"use client";

import { toast } from "sonner";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api, apiErrorMessage } from "@/lib/api/client";

interface Submission {
  id: string;
  buyerId: string;
  lenderName: string | null;
  approvedAmountCents: number | null;
  aprRate: number | null;
  termMonths: number | null;
  hasDocument: boolean;
  status: string;
  createdAt: string;
}

function ReasonModal({
  title,
  confirmLabel,
  confirmVariant,
  requireOfacAttest,
  onConfirm,
  onClose,
  loading,
}: {
  title: string;
  confirmLabel: string;
  confirmVariant: "default" | "destructive" | "secondary";
  /** Approve requires an OFAC attestation (external path has no bureau screen). */
  requireOfacAttest: boolean;
  onConfirm: (reason: string, ofacAttested: boolean) => Promise<void>;
  onClose: () => void;
  loading: boolean;
}) {
  const [reason, setReason] = useState("");
  const [ofacAttested, setOfacAttested] = useState(false);
  const canConfirm = reason.trim().length >= 10 && (!requireOfacAttest || ofacAttested);
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
        <h2 className="text-base font-semibold text-slate-900 mb-4">{title}</h2>
        <label className="text-xs font-medium text-slate-600 block mb-1" htmlFor="ext-reason">
          Reason <span className="text-slate-400">(required, min 10 chars)</span>
        </label>
        <textarea
          id="ext-reason"
          value={reason}
          onChange={e => setReason(e.target.value)}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-al-primary/30 resize-none"
          rows={3}
          placeholder="Describe the reason for this action…"
        />
        {requireOfacAttest && (
          <label className="flex items-start gap-2 mt-3 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={ofacAttested}
              onChange={e => setOfacAttested(e.target.checked)}
              className="mt-0.5"
              data-testid="ext-ofac-attest"
            />
            <span>
              I confirm an OFAC / sanctions screening was completed for this buyer.
              External pre-approvals skip the automated bureau OFAC check, so this
              attestation is recorded to the compliance log.
            </span>
          </label>
        )}
        <div className="flex gap-2 mt-4 justify-end">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button
            variant={confirmVariant}
            size="sm"
            disabled={loading || !canConfirm}
            onClick={() => onConfirm(reason.trim(), ofacAttested)}
          >
            {loading ? <span className="flex items-center gap-1"><span className="animate-spin h-3 w-3 border-2 border-white/30 border-t-white rounded-full" />Processing…</span> : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function ExternalPreApprovalActionsClient({ submissions: initialSubmissions }: { submissions: Submission[] }) {
  const [submissions, setSubmissions] = useState(initialSubmissions);
  const [modal, setModal] = useState<{ id: string; action: "approve" | "reject" } | null>(null);
  const [loading, setLoading] = useState(false);

  function showToast(msg: string) {
    // sonner toast — global Toaster in app/layout.tsx
    toast.success(msg);
  }

  async function openDocument(id: string) {
    try {
      const d = await api.get<{ signedUrl: string }>(`/api/admin/external-preapprovals/${id}/document`);
      window.open(d.signedUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not open the lender letter"));
    }
  }

  async function handleAction(id: string, action: "approve" | "reject", reason: string, ofacAttested: boolean) {
    setLoading(true);
    try {
      await api.post(
        `/api/admin/external-preapprovals/${id}/${action}`,
        action === "approve" ? { reason, ofacAttested } : { reason },
      );
      // Derive new status from the action taken
      const newStatus = action === "approve" ? "APPROVED" : "REJECTED";
      setSubmissions(prev =>
        prev.map(s => s.id === id ? { ...s, status: newStatus } : s)
      );
      showToast(`Pre-approval ${action === "approve" ? "approved" : "rejected"} successfully`);
      setModal(null);
    } catch (err) {
      showToast(`Error: ${apiErrorMessage(err, "Action failed")}`);
    } finally {
      setLoading(false);
    }
  }

  if (submissions.length === 0) {
    return <p className="text-slate-500 text-sm">No external pre-approvals submitted.</p>;
  }

  return (
    <>
      {modal && (
        <ReasonModal
          title={modal.action === "approve" ? "Approve Pre-Approval" : "Reject Pre-Approval"}
          confirmLabel={modal.action === "approve" ? "Approve" : "Reject"}
          confirmVariant={modal.action === "approve" ? "default" : "destructive"}
          requireOfacAttest={modal.action === "approve"}
          loading={loading}
          onClose={() => setModal(null)}
          onConfirm={(reason, ofacAttested) => handleAction(modal.id, modal.action, reason, ofacAttested)}
        />
      )}

      <div className="space-y-2">
        {submissions.map(s => (
          <div key={s.id} data-testid={`ext-prequal-${s.id}`}
            className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-5 py-4">
            <div>
              <p className="font-medium text-slate-800 text-sm">{s.lenderName ?? "Unknown Lender"}</p>
              <p className="text-xs text-slate-400">
                {s.approvedAmountCents ? `$${(s.approvedAmountCents / 100).toLocaleString()}` : "—"}
                {s.aprRate != null ? ` · ${s.aprRate}% APR` : ""}
                {s.termMonths != null ? ` · ${s.termMonths} mo` : ""}
                {" · "}{new Date(s.createdAt).toLocaleDateString()}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {s.hasDocument ? (
                <button
                  type="button"
                  onClick={() => void openDocument(s.id)}
                  className="text-xs font-medium text-al-primary hover:underline"
                  data-testid={`view-letter-${s.id}`}
                >
                  View letter
                </button>
              ) : (
                <span className="text-xs text-slate-300" title="No lender letter uploaded">No letter</span>
              )}
              <Badge variant="secondary" className="text-xs">{s.status}</Badge>
              {s.status === "SUBMITTED" && (
                <>
                  <Button size="sm" variant="secondary"
                    data-testid={`approve-${s.id}`}
                    onClick={() => setModal({ id: s.id, action: "approve" })}>
                    Approve
                  </Button>
                  <Button size="sm" variant="ghost"
                    data-testid={`reject-${s.id}`}
                    onClick={() => setModal({ id: s.id, action: "reject" })}>
                    Reject
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
