"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar, MapPin, Loader2 } from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api/client";

export default function PickupScheduleForm({ dealId }: { dealId: string }) {
  const router = useRouter();
  const [scheduledAt, setScheduledAt] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = tomorrow.toISOString().slice(0, 16);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post(`/api/buyer/pickup/${dealId}`, { scheduledAt, location, notes: notes.trim() || undefined });
      router.refresh();
    } catch (err) {
      setError(apiErrorMessage(err, "Scheduling failed. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-testid="pickup-schedule-form">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">
          <Calendar size={14} className="inline mr-1.5" />Preferred pickup date &amp; time
        </label>
        <input
          type="datetime-local"
          value={scheduledAt}
          min={minDate}
          onChange={e => setScheduledAt(e.target.value)}
          required
          data-testid="pickup-datetime-input"
          className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-al-primary focus:border-transparent"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">
          <MapPin size={14} className="inline mr-1.5" />Pickup location
        </label>
        <input
          type="text"
          value={location}
          onChange={e => setLocation(e.target.value)}
          placeholder="123 Dealer Drive, Dallas, TX 75001"
          required
          minLength={5}
          data-testid="pickup-location-input"
          className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-al-primary focus:border-transparent"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">Notes (optional)</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          maxLength={500}
          rows={2}
          placeholder="Any special instructions or questions…"
          data-testid="pickup-notes-input"
          className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-al-primary focus:border-transparent resize-none"
        />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={loading || !scheduledAt || !location}
        data-testid="submit-pickup-btn"
        className="w-full flex items-center justify-center gap-2 py-4 bg-al-primary text-white font-semibold rounded-xl hover:bg-al-primary-hover disabled:opacity-60 disabled:cursor-not-allowed transition-colors text-sm"
      >
        {loading ? <><Loader2 size={15} className="animate-spin" /> Scheduling…</> : "Confirm Pickup Time"}
      </button>
    </form>
  );
}
