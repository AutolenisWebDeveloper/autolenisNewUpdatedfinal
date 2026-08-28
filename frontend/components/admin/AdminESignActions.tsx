"use client";

import { toast } from "sonner";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { canUse, deniedReason } from "@/lib/auth/admin-ui-roles";

interface Props {
  dealId: string;
  envelopeStatus: string | null;
  /** UX only — the void route re-checks the role server-side. */
  adminRole?: string;
}

export function AdminESignActions({ dealId, envelopeStatus, adminRole }: Props) {
  // Create and resend are auth-only routes and stay ungated; only void
  // hard-denies outside the mirrored allow-list.
  const mayVoid = canUse("deal.esign.void", adminRole);
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voidModal, setVoidModal] = useState(false);
  const [voidReason, setVoidReason] = useState("");

  function showToast(msg: string, type: "success" | "error") {
    // sonner toast — global Toaster in app/layout.tsx
    if (type === "success") toast.success(msg);
    else toast.error(msg);
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
      {voidModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="font-bold text-slate-900 mb-1">Void Envelope</h2>
            <p className="text-sm text-slate-500 mb-4">Provide a reason for voiding this envelope (min 10 characters).</p>
            <textarea
              className="w-full border border-slate-300 rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-al-primary"
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
            <Button size="sm" variant="ghost" data-testid="void-envelope-btn" disabled={!mayVoid}
              title={mayVoid ? undefined : deniedReason("deal.esign.void")}
              onClick={() => { setError(null); setVoidModal(true); }}>
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
