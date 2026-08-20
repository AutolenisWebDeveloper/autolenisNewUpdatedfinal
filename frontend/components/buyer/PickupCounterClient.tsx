"use client";

// D2b — buyer accept / propose-another leaf, shown when the dealership has
// countered with an alternative pickup time (Pickup DEALER_COUNTERED). Accept
// the dealer's time, or propose another within the dealer's availability. Posts
// to the CAS-guarded routes, echoing `proposedAt` (the CAS token).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, Clock, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AvailabilityHint } from "@/components/dealer/PickupConfirmClient";

function toLocalInput(t: number): string {
  const d = new Date(t);
  return new Date(t - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function hourLabel(h: number): string {
  const am = h < 12;
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}:00 ${am ? "AM" : "PM"}`;
}
function daysLabel(days: number[]): string {
  if (days.length === 0) return "";
  const sorted = [...days].sort((a, b) => a - b);
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1]! + 1);
  return contiguous && sorted.length > 1
    ? `${DOW[sorted[0]!]}–${DOW[sorted[sorted.length - 1]!]}`
    : sorted.map((d) => DOW[d]).join(", ");
}

export default function PickupCounterClient({
  dealId,
  proposedAt,
  availability,
}: {
  dealId: string;
  proposedAt: string;
  availability: AvailabilityHint;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "proposing">("idle");
  const [altDate, setAltDate] = useState("");
  const [busy, setBusy] = useState<null | "accept" | "counter">(null);
  const [error, setError] = useState<string | null>(null);

  const now = Date.now();
  const minDate = toLocalInput(now + availability.minLeadTimeHours * 3600_000);
  const maxDate = toLocalInput(now + availability.maxAdvanceDays * 86_400_000);
  const windowLabel = `${daysLabel(availability.days)}, ${hourLabel(availability.openHour)}–${hourLabel(
    availability.closeHour,
  )} ${availability.timezoneLabel}`;

  async function post(url: string, body: unknown, kind: "accept" | "counter") {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        router.refresh();
        return;
      }
      let message = "Something went wrong. Please try again.";
      try {
        const data = (await res.json()) as { error?: { message?: string } };
        if (data?.error?.message) message = data.error.message;
      } catch { /* keep default */ }
      setError(message);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3" data-testid="pickup-counter">
      {error && (
        <p
          role="alert"
          aria-live="assertive"
          className="flex items-start gap-2 rounded-al-lg bg-al-danger-subtle px-3.5 py-2.5 text-sm text-al-danger"
          data-testid="pickup-counter-error"
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}

      {mode === "idle" ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            onClick={() => post(`/api/buyer/pickup/${dealId}/accept`, { proposedAt }, "accept")}
            disabled={busy !== null}
            className="w-full sm:w-auto"
            data-testid="accept-pickup"
          >
            {busy === "accept" ? (
              <><Loader2 size={16} className="motion-safe:animate-spin" aria-hidden="true" /> Accepting…</>
            ) : (
              <><Check size={16} aria-hidden="true" /> Accept this time</>
            )}
          </Button>
          <Button
            variant="secondary"
            onClick={() => { setMode("proposing"); setError(null); }}
            disabled={busy !== null}
            className="w-full sm:w-auto"
            data-testid="propose-another"
          >
            <CalendarClock size={16} aria-hidden="true" /> Propose another time
          </Button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!altDate) return;
            post(`/api/buyer/pickup/${dealId}/counter`, { scheduledAt: new Date(altDate).toISOString(), proposedAt }, "counter");
          }}
          className="space-y-3"
          data-testid="counter-form"
        >
          <div id="counter-avail-hint" className="flex items-start gap-2 rounded-al-lg bg-al-primary-subtle px-3.5 py-2.5 text-sm text-al-text-muted">
            <Clock size={15} className="mt-0.5 shrink-0 text-al-primary" aria-hidden="true" />
            <p>The dealership takes pickups <span className="font-medium text-al-text">{windowLabel}</span>.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="counter-datetime" className="flex items-center gap-1.5">
              <CalendarClock size={14} aria-hidden="true" /> Your preferred date &amp; time
            </Label>
            <Input
              id="counter-datetime"
              type="datetime-local"
              value={altDate}
              min={minDate}
              max={maxDate}
              onChange={(e) => setAltDate(e.target.value)}
              required
              aria-describedby="counter-avail-hint"
              data-testid="counter-datetime-input"
            />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="submit" disabled={busy !== null || !altDate} className="w-full sm:w-auto" data-testid="send-counter">
              {busy === "counter" ? (
                <><Loader2 size={16} className="motion-safe:animate-spin" aria-hidden="true" /> Sending…</>
              ) : (
                "Send my time"
              )}
            </Button>
            <Button type="button" variant="ghost" onClick={() => { setMode("idle"); setError(null); }} disabled={busy !== null} className="w-full sm:w-auto">
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
