"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertTriangle } from "lucide-react";

interface Props {
  pickupId: string;
  pickupStatus: string;
}

export function AdminPickupListActions({ pickupId, pickupStatus }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ action: string; label: string } | null>(null);

  function showToast(msg: string, type: "success" | "error") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }

  async function post(path: string) {
    const res = await fetch(path, { method: "POST" });
    const data = await res.json() as { success?: boolean; error?: { message?: string } };
    if (!res.ok) throw new Error(data?.error?.message ?? "Request failed");
    return data;
  }

  async function handleConfirmedAction(action: string) {
    setLoading(action); setError(null);
    try {
      if (action === "regenerate-qr") {
        await post(`/api/admin/pickups/${pickupId}/regenerate-qr`);
        showToast("QR code regenerated", "success");
      } else if (action === "mark-arrived") {
        await post(`/api/admin/pickups/${pickupId}/mark-arrived`);
        showToast("Marked as arrived", "success");
      }
      setConfirmModal(null);
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed";
      setError(msg); showToast(msg, "error");
    } finally { setLoading(null); }
  }

  if (pickupStatus === "COMPLETED") return null;

  return (
    <>
      {toast && (
        <div className={"fixed top-4 right-4 z-50 px-4 py-3 rounded-xl text-sm shadow-xl font-medium flex items-center gap-2 max-w-sm " + (toast.type === "success" ? "bg-green-600 text-white" : "bg-red-600 text-white")}>
          {toast.type === "success" ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
          <span>{toast.msg}</span>
        </div>
      )}

      {confirmModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="font-bold text-slate-900 mb-2">Confirm Action</h2>
            <p className="text-sm text-slate-500">Are you sure you want to {confirmModal.label.toLowerCase()}?</p>
            {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
            <div className="flex gap-2 mt-4">
              <Button size="sm" variant="ghost" onClick={() => { setConfirmModal(null); setError(null); }}>Cancel</Button>
              <Button size="sm" variant="secondary" onClick={() => handleConfirmedAction(confirmModal.action)} disabled={loading === confirmModal.action}>
                {loading === confirmModal.action ? "Processing…" : confirmModal.label}
              </Button>
            </div>
          </div>
        </div>
      )}

      <Button size="sm" variant="ghost" data-testid={`regenerate-qr-${pickupId}`}
        onClick={() => { setError(null); setConfirmModal({ action: "regenerate-qr", label: "Regen QR" }); }}
        disabled={loading !== null}>
        {loading === "regenerate-qr" ? "…" : "Regen QR"}
      </Button>
      <Button size="sm" variant="ghost" data-testid={`mark-arrived-${pickupId}`}
        onClick={() => { setError(null); setConfirmModal({ action: "mark-arrived", label: "Mark Arrived" }); }}
        disabled={loading !== null || pickupStatus === "CHECKED_IN"}>
        {loading === "mark-arrived" ? "…" : "Mark Arrived"}
      </Button>
    </>
  );
}
