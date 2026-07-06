"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar, Loader2 } from "lucide-react";

interface Props {
  dealId:      string;
  currentDate: string;
  location:    string;
}

export default function PickupRescheduleButton({ dealId, currentDate, location }: Props) {
  const router    = useRouter();
  const [open,    setOpen]    = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newLoc,  setNewLoc]  = useState(location);
  const [reason,  setReason]  = useState("");
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const currentLabel = currentDate
    ? new Date(currentDate).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : null;

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = tomorrow.toISOString().slice(0, 16);

  async function handleReschedule() {
    if (!newDate || !newLoc.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(`/api/buyer/pickup/${dealId}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ scheduledAt: newDate, location: newLoc.trim(), reason: reason.trim() || undefined }),
      });
      const data = await res.json() as { success: boolean; error?: { message: string } };
      if (!data.success) {
        setError(data.error?.message ?? "Reschedule failed. Please try again.");
      } else {
        setOpen(false);
        router.refresh();
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div data-testid="reschedule-pickup-container">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-al-primary hover:text-al-primary-hover transition-colors mt-3"
          data-testid="reschedule-pickup-btn"
        >
          <Calendar size={14} /> Reschedule pickup
        </button>
      ) : (
        <div className="mt-4 bg-white border border-[#E5E7EB] rounded-xl p-5 space-y-4">
          <p className="text-sm font-semibold text-[#111827]">Reschedule Pickup</p>
          {currentLabel && (
            <p className="text-xs text-[#6B7280]">Current: {currentLabel}</p>
          )}
          <div>
            <label className="block text-xs font-medium text-[#374151] mb-1.5">New date &amp; time</label>
            <input type="datetime-local" value={newDate} min={minDate}
              onChange={e => setNewDate(e.target.value)} required
              className="w-full border border-[#D1D5DB] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-al-primary"
              data-testid="reschedule-datetime" />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#374151] mb-1.5">Location</label>
            <input type="text" value={newLoc} onChange={e => setNewLoc(e.target.value)}
              required minLength={5}
              className="w-full border border-[#D1D5DB] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-al-primary"
              data-testid="reschedule-location" />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#374151] mb-1.5">Reason (optional)</label>
            <input type="text" value={reason} onChange={e => setReason(e.target.value)}
              maxLength={200} placeholder="e.g. Schedule conflict"
              className="w-full border border-[#D1D5DB] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-al-primary"
              data-testid="reschedule-reason" />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex items-center gap-3">
            <button onClick={handleReschedule} disabled={loading || !newDate || !newLoc.trim()}
              className="flex-1 flex items-center justify-center gap-2 py-3 bg-al-primary text-white font-semibold text-sm rounded-xl disabled:opacity-60 transition-colors hover:bg-al-primary-hover"
              data-testid="confirm-reschedule-btn">
              {loading ? <><Loader2 size={14} className="animate-spin" />Updating…</> : "Confirm New Time"}
            </button>
            <button onClick={() => { setOpen(false); setError(null); }} disabled={loading}
              className="px-4 py-3 text-sm text-[#6B7280] hover:text-[#374151] transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
