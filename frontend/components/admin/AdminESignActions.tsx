"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertTriangle } from "lucide-react";

interface Props {
  dealId: string;
  envelopeStatus: string | null;
}

export function AdminESignActions({ dealId, envelopeStatus }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [voidModal, setVoidModal] = useState(false);
  const [voidReason, setVoidReason] = useState("");

  function showToast(msg: string, type: "success" | "error") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }

  async function post(path: string, body?: Record<string, unknown>) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json() as { success?: boolean; error?: { message?: string } };
    if (!res.ok) throw new Error(data?.error?.message ?? "Request failed");
    return data;
  }

  async function handleCreate() {
    setLoading("create"); setError(null);
    try {
      await post(`/api/admin/deals/${dealId}/esign`);
      showToast("Envelope created", "success");
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed";
      setError(msg); showToast(msg, "error");
    } finally { setLoading(null); }
  }

  async function handleResend() {
    setLoading("resend"); setError(null);
    try {
      await post(`/api/admin/deals/${dealId}/esign/resend`);
      showToast("Signing email resent", "success");
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed";
      setError(msg); showToast(msg, "error");
    } finally { setLoading(null); }
  }

  async function handleVoidSubmit() {
    if (voidReason.trim().length < 10) {
      setError("Reason must be at least 10 characters"); return;
    }
    setLoading("void"); setError(null);
    try {
      await post(`/api/admin/deals/${dealId}/esign/void`, { reason: voidReason.trim() });
      setVoidModal(false); setVoidReason("");
      showToast("Envelope voided", "success");
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed";
      setError(msg); showToast(msg, "error");
    } finally { setLoading(null); }
  }

  return (
    <>
      {toast && (
        <div className={"fixed top-4 right-4 z-50 px-4 py-3 rounded-xl text-sm shadow-xl font-medium flex items-center gap-2 max-w-sm " + (toast.type === "success" ? "bg-green-600 text-white" : "bg-red-600 text-white")}>
          {toast.type === "success" ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
          <span>{toast.msg}</span>
        </div>
      )}

      {voidModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="font-bold text-slate-900 mb-1">Void Envelope</h2>
            <p className="text-sm text-slate-500 mb-4">Provide a reason for voiding this envelope (min 10 characters).</p>
            <textarea
              className="w-full border border-slate-300 rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]"
              rows={3}
              placeholder="e.g. Buyer requested changes to contract terms"
              value={voidReason}
              onChange={e => setVoidReason(e.target.value)}
            />
            {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
            <div className="flex gap-2 mt-4">
              <Button size="sm" variant="ghost" onClick={() => { setVoidModal(false); setVoidReason(""); setError(null); }}>Cancel</Button>
              <Button size="sm" variant="secondary" onClick={handleVoidSubmit} disabled={loading === "void"}>
                {loading === "void" ? "Voiding…" : "Void Envelope"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-2" data-testid="admin-esign-actions">
        {(!envelopeStatus || envelopeStatus === "VOIDED") && (
          <Button size="sm" data-testid="create-envelope-btn" onClick={handleCreate} disabled={loading === "create"}>
            {loading === "create" ? "Creating…" : envelopeStatus === "VOIDED" ? "Create New Envelope" : "Create Signing Envelope"}
          </Button>
        )}
        {(envelopeStatus === "SENT" || envelopeStatus === "DELIVERED" || envelopeStatus === "PENDING") && (
          <>
            <Button size="sm" variant="secondary" data-testid="resend-envelope-btn" onClick={handleResend} disabled={loading === "resend"}>
              {loading === "resend" ? "Resending…" : "Resend to Buyer"}
            </Button>
            <Button size="sm" variant="ghost" data-testid="void-envelope-btn" onClick={() => { setError(null); setVoidModal(true); }}>
              Void Envelope
            </Button>
          </>
        )}
        {envelopeStatus === "COMPLETED" && (
          <p className="text-sm text-slate-500 italic">No actions available — envelope is completed.</p>
        )}
        {error && !voidModal && <p className="text-xs text-red-600 self-center">{error}</p>}
      </div>
    </>
  );
}
