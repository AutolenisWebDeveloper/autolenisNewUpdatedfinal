"use client";

import { toast } from "sonner";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

interface Props {
  dealId: string;
  pickupStatus: string | null;
  scheduledAt: Date | string | null;
  location: string | null;
}

export function AdminPickupActions({ dealId, pickupStatus, scheduledAt, location }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scheduleModal, setScheduleModal] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{ action: string; label: string; requiresReason?: boolean } | null>(null);
  const [confirmReason, setConfirmReason] = useState("");
  const [scheduleForm, setScheduleForm] = useState({
    scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString().slice(0, 16) : "",
    location: location ?? "",
  });

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

  async function handleScheduleSubmit() {
    if (!scheduleForm.scheduledAt) { setError("Please select a date and time"); return; }
    if (scheduleForm.location.trim().length < 5) { setError("Location must be at least 5 characters"); return; }
    setLoading("schedule"); setError(null);
    try {
      await post(`/api/admin/deals/${dealId}/pickup/schedule`, {
        scheduledAt: new Date(scheduleForm.scheduledAt).toISOString(),
        location: scheduleForm.location.trim(),
      });
      setScheduleModal(false);
      showToast("Pickup scheduled", "success");
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed";
      setError(msg); showToast(msg, "error");
    } finally { setLoading(null); }
  }

  async function handleConfirmedAction(action: string) {
    if (action === "complete" && confirmModal?.requiresReason && confirmReason.trim().length < 5) {
      setError("Please provide a reason (min 5 characters)"); return;
    }
    setLoading(action); setError(null);
    try {
      if (action === "regenerate-qr") {
        await post(`/api/admin/deals/${dealId}/pickup/regenerate-qr`);
        showToast("QR code regenerated", "success");
      } else if (action === "complete") {
        // Calls the pre-existing route at app/api/admin/deals/[dealId]/pickup/complete/route.ts
        await post(`/api/admin/deals/${dealId}/pickup/complete`, { reason: confirmReason.trim() || "Marked complete by admin" });
        showToast("Pickup marked as complete", "success");
      }
      setConfirmModal(null);
      setConfirmReason("");
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed";
      setError(msg); showToast(msg, "error");
    } finally { setLoading(null); }
  }

  const isCompleted = pickupStatus === "COMPLETED";

  return (
    <>
      {scheduleModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="font-bold text-slate-900 mb-1">{pickupStatus ? "Reschedule Pickup" : "Schedule Pickup"}</h2>
            <div className="space-y-3 mt-3">
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Date &amp; Time</label>
                <input
                  type="datetime-local"
                  className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-al-primary"
                  value={scheduleForm.scheduledAt}
                  onChange={e => setScheduleForm(f => ({ ...f, scheduledAt: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Location (min 5 chars)</label>
                <input
                  type="text"
                  className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-al-primary"
                  placeholder="e.g. 123 Main St, Dallas TX"
                  value={scheduleForm.location}
                  onChange={e => setScheduleForm(f => ({ ...f, location: e.target.value }))}
                />
              </div>
            </div>
            {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
            <div className="flex gap-2 mt-4">
              <Button size="sm" variant="ghost" onClick={() => { setScheduleModal(false); setError(null); }}>Cancel</Button>
              <Button size="sm" onClick={handleScheduleSubmit} disabled={loading === "schedule"}>
                {loading === "schedule" ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {confirmModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="font-bold text-slate-900 mb-2">Confirm Action</h2>
            <p className="text-sm text-slate-500">Are you sure you want to {confirmModal.label.toLowerCase()}?</p>
            {confirmModal.requiresReason && (
              <div className="mt-3">
                <label className="text-xs font-medium text-slate-600 block mb-1">Reason (min 5 chars)</label>
                <input
                  type="text"
                  className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-al-primary"
                  placeholder="e.g. Vehicle delivered to buyer"
                  value={confirmReason}
                  onChange={e => setConfirmReason(e.target.value)}
                />
              </div>
            )}
            {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
            <div className="flex gap-2 mt-4">
              <Button size="sm" variant="ghost" onClick={() => { setConfirmModal(null); setConfirmReason(""); setError(null); }}>Cancel</Button>
              <Button size="sm" variant="secondary" onClick={() => handleConfirmedAction(confirmModal.action)} disabled={loading === confirmModal.action}>
                {loading === confirmModal.action ? "Processing…" : confirmModal.label}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-2 flex-wrap" data-testid="admin-pickup-actions">
        {isCompleted ? (
          <p className="text-sm text-slate-500 italic">No actions available — pickup is completed.</p>
        ) : (
          <>
            {!pickupStatus && (
              <Button size="sm" data-testid="schedule-pickup-btn" onClick={() => { setError(null); setScheduleModal(true); }}>
                Schedule Pickup
              </Button>
            )}
            {pickupStatus && pickupStatus !== "COMPLETED" && (
              <>
                <Button size="sm" variant="secondary" data-testid="regenerate-qr-admin-btn"
                  onClick={() => { setError(null); setConfirmReason(""); setConfirmModal({ action: "regenerate-qr", label: "Regenerate QR Code" }); }}>
                  Regenerate QR Code
                </Button>
                <Button size="sm" variant="ghost" data-testid="mark-completed-btn"
                  onClick={() => { setError(null); setConfirmReason(""); setConfirmModal({ action: "complete", label: "Mark Complete", requiresReason: true }); }}>
                  Mark Complete
                </Button>
                <Button size="sm" variant="ghost" data-testid="reschedule-pickup-btn"
                  onClick={() => { setError(null); setScheduleModal(true); }}>
                  Reschedule
                </Button>
              </>
            )}
          </>
        )}
        {error && !scheduleModal && !confirmModal && <p className="text-xs text-red-600 self-center">{error}</p>}
      </div>
    </>
  );
}
