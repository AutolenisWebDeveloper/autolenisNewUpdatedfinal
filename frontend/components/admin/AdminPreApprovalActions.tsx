"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertTriangle } from "lucide-react";

interface Props {
  submissionId: string;
  status: string;
}

export function AdminPreApprovalActions({ submissionId, status }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [modal, setModal] = useState<{ action: "approve" | "reject" } | null>(null);
  const [reason, setReason] = useState("");

  function showToast(msg: string, type: "success" | "error") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }

  async function handleSubmit() {
    if (reason.trim().length < 10) { setError("Reason must be at least 10 characters"); return; }
    if (!modal) return;
    setLoading(modal.action); setError(null);
    try {
      const res = await fetch(`/api/admin/external-preapprovals/${submissionId}/${modal.action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const data = await res.json() as { success?: boolean; error?: { message?: string } };
      if (!res.ok) throw new Error(data?.error?.message ?? "Request failed");
      setModal(null); setReason("");
      showToast(modal.action === "approve" ? "Pre-approval approved" : "Pre-approval rejected", "success");
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed";
      setError(msg); showToast(msg, "error");
    } finally { setLoading(null); }
  }

  if (status !== "SUBMITTED" && status !== "REVIEWING") return null;

  return (
    <>
      {toast && (
        <div className={"fixed top-4 right-4 z-50 px-4 py-3 rounded-xl text-sm shadow-xl font-medium flex items-center gap-2 max-w-sm " + (toast.type === "success" ? "bg-green-600 text-white" : "bg-red-600 text-white")}>
          {toast.type === "success" ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
          <span>{toast.msg}</span>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="font-bold text-slate-900 mb-1">{modal.action === "approve" ? "Approve" : "Reject"} Pre-Approval</h2>
            <p className="text-sm text-slate-500 mb-4">Provide a reason (min 10 characters).</p>
            <textarea
              className="w-full border border-slate-300 rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-al-primary"
              rows={3}
              placeholder={modal.action === "approve" ? "e.g. Pre-approval documents verified and valid" : "e.g. Documentation does not meet requirements"}
              value={reason}
              onChange={e => setReason(e.target.value)}
            />
            {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
            <div className="flex gap-2 mt-4">
              <Button size="sm" variant="ghost" onClick={() => { setModal(null); setReason(""); setError(null); }}>Cancel</Button>
              <Button size="sm" variant="secondary" onClick={handleSubmit} disabled={loading !== null}>
                {loading ? "Saving…" : modal.action === "approve" ? "Approve" : "Reject"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <Button size="sm" variant="secondary" data-testid={`approve-${submissionId}`}
        onClick={() => { setError(null); setReason(""); setModal({ action: "approve" }); }}
        disabled={loading !== null}>
        Approve
      </Button>
      <Button size="sm" variant="ghost" data-testid={`reject-${submissionId}`}
        onClick={() => { setError(null); setReason(""); setModal({ action: "reject" }); }}
        disabled={loading !== null}>
        Reject
      </Button>
    </>
  );
}
