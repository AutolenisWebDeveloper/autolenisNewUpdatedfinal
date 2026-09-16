"use client";

import { toast } from "sonner";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

interface Props {
  pickupId: string;
  pickupStatus: string;
}

export function AdminPickupListActions({ pickupId, pickupStatus }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ action: string; label: string } | null>(null);
  // Held in state only — see AdminPickupActions for why there is no column to read it back from.
  const [issuedCode, setIssuedCode] = useState<{ image: string; expiresAt: string } | null>(null);

  function showToast(msg: string, type: "success" | "error") {
    // sonner toast — global Toaster in app/layout.tsx
    if (type === "success") toast.success(msg);
    else toast.error(msg);
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
        const data = await post(`/api/admin/pickups/${pickupId}/regenerate-qr`) as {
          data?: { releaseCodeImage?: string; expiresAt?: string };
        };
        if (data?.data?.releaseCodeImage && data.data.expiresAt) {
          setIssuedCode({ image: data.data.releaseCodeImage, expiresAt: data.data.expiresAt });
        }
        showToast("New pickup code issued — the previous one no longer works", "success");
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

      {issuedCode && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4 text-center" data-testid={`issued-pickup-code-${pickupId}`}>
            <h2 className="font-bold text-slate-900 mb-1">New pickup code</h2>
            <p className="text-xs text-slate-500 mb-4">Issuing another code replaces this one.</p>
            <img src={issuedCode.image} alt="Pickup code" className="mx-auto w-40 h-40" />
            <p className="text-xs text-slate-500 mt-3">Valid until {new Date(issuedCode.expiresAt).toLocaleString()}</p>
            <div className="flex justify-center mt-4">
              <Button size="sm" variant="secondary" onClick={() => setIssuedCode(null)}>Done</Button>
            </div>
          </div>
        </div>
      )}

      <Button size="sm" variant="ghost" data-testid={`regenerate-qr-${pickupId}`}
        onClick={() => { setError(null); setConfirmModal({ action: "regenerate-qr", label: "Issue New Code" }); }}
        disabled={loading !== null}>
        {loading === "regenerate-qr" ? "…" : "New Code"}
      </Button>
      <Button size="sm" variant="ghost" data-testid={`mark-arrived-${pickupId}`}
        onClick={() => { setError(null); setConfirmModal({ action: "mark-arrived", label: "Mark Arrived" }); }}
        disabled={loading !== null || pickupStatus === "CHECKED_IN"}>
        {loading === "mark-arrived" ? "…" : "Mark Arrived"}
      </Button>
    </>
  );
}
