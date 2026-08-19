"use client";

// D2b — dealer confirm / propose-alternative leaf. One-tap Confirm, or reveal an
// inline form to propose an alternative time bounded by the dealer's own
// availability. Posts to the CAS-guarded round-trip routes, echoing `proposedAt`
// (the CAS token) so a stale action loses cleanly. Server is authoritative on
// availability — the min/max here are hints that mirror the server gate.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, Clock, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface AvailabilityHint {
  minLeadTimeHours: number;
  maxAdvanceDays: number;
  openHour: number;
  closeHour: number;
  days: number[];
  timezoneLabel: string;
}

/** Local `YYYY-MM-DDTHH:mm` string for a datetime-local min/max bound. */
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

export default function PickupConfirmClient({
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
  const [busy, setBusy] = useState<null | "confirm" | "propose">(null);
  const [error, setError] = useState<string | null>(null);

  const now = Date.now();
  const minDate = toLocalInput(now + availability.minLeadTimeHours * 3600_000);
  const maxDate = toLocalInput(now + availability.maxAdvanceDays * 86_400_000);
  const windowLabel = `${daysLabel(availability.days)}, ${hourLabel(availability.openHour)}–${hourLabel(
    availability.closeHour,
  )} ${availability.timezoneLabel}`;

  async function post(url: string, body: unknown, kind: "confirm" | "propose") {
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
    <div className="space-y-3" data-testid={`pickup-confirm-${dealId}`}>
      {error && (
        <p
          role="alert"
          aria-live="assertive"
          className="flex items-start gap-2 rounded-al-lg bg-al-danger-subtle px-3.5 py-2.5 text-sm text-al-danger"
          data-testid={`pickup-confirm-error-${dealId}`}
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}

      {mode === "idle" ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            onClick={() => post(`/api/dealer/pickup/${dealId}/confirm`, { proposedAt }, "confirm")}
            disabled={busy !== null}
            className="w-full sm:w-auto"
            data-testid={`confirm-pickup-${dealId}`}
          >
            {busy === "confirm" ? (
              <><Loader2 size={16} className="motion-safe:animate-spin" aria-hidden="true" /> Confirming…</>
            ) : (
              <><Check size={16} aria-hidden="true" /> Confirm this time</>
            )}
          </Button>
          <Button
            variant="secondary"
            onClick={() => { setMode("proposing"); setError(null); }}
            disabled={busy !== null}
            className="w-full sm:w-auto"
            data-testid={`propose-alt-${dealId}`}
          >
            <CalendarClock size={16} aria-hidden="true" /> Propose another time
          </Button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!altDate) return;
            post(`/api/dealer/pickup/${dealId}/propose`, { scheduledAt: new Date(altDate).toISOString(), proposedAt }, "propose");
          }}
          className="space-y-3"
          data-testid={`propose-form-${dealId}`}
        >
          <div
            id={`avail-hint-${dealId}`}
            className="flex items-start gap-2 rounded-al-lg bg-al-primary-subtle px-3.5 py-2.5 text-sm text-al-text-muted"
          >
            <Clock size={15} className="mt-0.5 shrink-0 text-al-primary" aria-hidden="true" />
            <p>Pickups run <span className="font-medium text-al-text">{windowLabel}</span>.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`alt-datetime-${dealId}`} className="flex items-center gap-1.5">
              <CalendarClock size={14} aria-hidden="true" /> Alternative date &amp; time
            </Label>
            <Input
              id={`alt-datetime-${dealId}`}
              type="datetime-local"
              value={altDate}
              min={minDate}
              max={maxDate}
              onChange={(e) => setAltDate(e.target.value)}
              required
              aria-describedby={`avail-hint-${dealId}`}
              data-testid={`alt-datetime-input-${dealId}`}
            />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="submit" disabled={busy !== null || !altDate} className="w-full sm:w-auto" data-testid={`send-alt-${dealId}`}>
              {busy === "propose" ? (
                <><Loader2 size={16} className="motion-safe:animate-spin" aria-hidden="true" /> Sending…</>
              ) : (
                "Send alternative"
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => { setMode("idle"); setError(null); }}
              disabled={busy !== null}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
