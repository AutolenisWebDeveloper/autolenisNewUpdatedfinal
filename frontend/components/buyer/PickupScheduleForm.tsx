"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, MapPin, Loader2, Clock, AlertCircle } from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import type { DealerAvailability } from "@/lib/services/pickup/availability.service";

/** Local `YYYY-MM-DDTHH:mm` string for a datetime-local min/max bound. */
function toLocalInput(t: number): string {
  const d = new Date(t);
  return new Date(t - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function hourLabel(h: number): string {
  const am = h < 12;
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}:00 ${am ? "AM" : "PM"}`;
}
function daysLabel(days: number[]): string {
  if (days.length === 0) return "";
  const sorted = [...days].sort((a, b) => a - b);
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1]! + 1);
  return contiguous && sorted.length > 1
    ? `${DOW[sorted[0]!]}–${DOW[sorted[sorted.length - 1]!]}`
    : sorted.map((d) => DOW[d]).join(", ");
}

export default function PickupScheduleForm({
  dealId,
  availability,
}: {
  dealId: string;
  availability: DealerAvailability;
}) {
  const router = useRouter();
  const [scheduledAt, setScheduledAt] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const now = Date.now();
  const minDate = toLocalInput(now + availability.minLeadTimeHours * 3600_000);
  const maxDate = toLocalInput(now + availability.maxAdvanceDays * 86_400_000);

  const windowLabel = `${daysLabel(availability.days)}, ${hourLabel(availability.openHour)}–${hourLabel(
    availability.closeHour,
  )} ${availability.timezoneLabel}`;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post(`/api/buyer/pickup/${dealId}`, {
        scheduledAt,
        location,
        notes: notes.trim() || undefined,
      });
      router.refresh();
    } catch (err) {
      setError(apiErrorMessage(err, "We couldn't schedule that time. Please try another slot."));
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" data-testid="pickup-schedule-form" noValidate>
      {/* Availability guidance — the same window the server enforces. */}
      <div
        id="pickup-availability-hint"
        className="flex items-start gap-2.5 rounded-al-lg bg-al-primary-subtle px-4 py-3 text-sm text-al-text-muted"
      >
        <Clock size={16} className="mt-0.5 shrink-0 text-al-primary" aria-hidden="true" />
        <p className="leading-relaxed">
          Pickups run <span className="font-medium text-al-text">{windowLabel}</span>, starting at least{" "}
          {availability.minLeadTimeHours} hours out so the dealership can prep your vehicle.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="pickup-datetime" className="flex items-center gap-1.5">
          <CalendarClock size={14} aria-hidden="true" /> Preferred date &amp; time
        </Label>
        <Input
          id="pickup-datetime"
          type="datetime-local"
          value={scheduledAt}
          min={minDate}
          max={maxDate}
          onChange={(e) => setScheduledAt(e.target.value)}
          required
          aria-describedby="pickup-availability-hint pickup-datetime-help"
          data-testid="pickup-datetime-input"
        />
        <p id="pickup-datetime-help" className="text-xs text-al-text-subtle">
          Choose any open slot within the next {availability.maxAdvanceDays} days.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="pickup-location" className="flex items-center gap-1.5">
          <MapPin size={14} aria-hidden="true" /> Pickup location
        </Label>
        <Input
          id="pickup-location"
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="123 Dealer Drive, Dallas, TX 75001"
          required
          minLength={5}
          autoComplete="street-address"
          data-testid="pickup-location-input"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="pickup-notes">Notes for the dealership (optional)</Label>
        <Textarea
          id="pickup-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={500}
          rows={3}
          placeholder="Anything the dealership should know before you arrive…"
          className="min-h-[84px]"
          data-testid="pickup-notes-input"
        />
      </div>

      {error && (
        <p
          role="alert"
          aria-live="assertive"
          className="flex items-start gap-2 rounded-al-lg bg-al-danger-subtle px-3.5 py-2.5 text-sm text-al-danger"
          data-testid="pickup-error"
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}

      <Button
        type="submit"
        size="lg"
        disabled={loading || !scheduledAt || location.trim().length < 5}
        className="w-full"
        data-testid="submit-pickup-btn"
      >
        {loading ? (
          <>
            <Loader2 size={16} className="motion-safe:animate-spin" aria-hidden="true" /> Scheduling…
          </>
        ) : (
          "Confirm pickup time"
        )}
      </Button>
    </form>
  );
}
