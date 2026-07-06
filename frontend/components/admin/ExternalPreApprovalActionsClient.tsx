"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Submission {
  id: string;
  buyerId: string;
  lenderName: string | null;
  approvedAmountCents: number | null;
  status: string;
  createdAt: string;
}

function ReasonModal({
  title,
  confirmLabel,
  confirmVariant,
  onConfirm,
  onClose,
  loading,
}: {
  title: string;
  confirmLabel: string;
  confirmVariant: "default" | "destructive" | "secondary";
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
  loading: boolean;
}) {
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
        <h2 className="text-base font-semibold text-slate-900 mb-4">{title}</h2>
        <label className="text-xs font-medium text-slate-600 block mb-1">
          Reason <span className="text-slate-400">(required, min 10 chars)</span>
        </label>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-al-primary/30 resize-none"
          rows={3}
          placeholder="Describe the reason for this action…"
        />
        <div className="flex gap-2 mt-4 justify-end">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button
            variant={confirmVariant}
            size="sm"
            disabled={loading || reason.trim().length < 10}
            onClick={() => onConfirm(reason.trim())}
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
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }

  async function handleAction(id: string, action: "approve" | "reject", reason: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/external-preapprovals/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json() as { success?: boolean; error?: { message: string } };
      if (!res.ok || !data.success) {
        showToast(`Error: ${data.error?.message ?? "Action failed"}`);
      } else {
        // Derive new status from the action taken
        const newStatus = action === "approve" ? "APPROVED" : "REJECTED";
        setSubmissions(prev =>
          prev.map(s => s.id === id ? { ...s, status: newStatus } : s)
        );
        showToast(`Pre-approval ${action === "approve" ? "approved" : "rejected"} successfully`);
        setModal(null);
      }
    } catch {
      showToast("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  if (submissions.length === 0) {
    return <p className="text-slate-500 text-sm">No external pre-approvals submitted.</p>;
  }

  return (
    <>
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-slate-900 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg">
          {toast}
        </div>
      )}

      {modal && (
        <ReasonModal
          title={modal.action === "approve" ? "Approve Pre-Approval" : "Reject Pre-Approval"}
          confirmLabel={modal.action === "approve" ? "Approve" : "Reject"}
          confirmVariant={modal.action === "approve" ? "default" : "destructive"}
          loading={loading}
          onClose={() => setModal(null)}
          onConfirm={reason => handleAction(modal.id, modal.action, reason)}
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
                {" · "}{new Date(s.createdAt).toLocaleDateString()}
              </p>
            </div>
            <div className="flex items-center gap-2">
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
