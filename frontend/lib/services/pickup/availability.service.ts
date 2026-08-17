// lib/services/pickup/availability.service.ts
// G3 — dealer pickup availability (Phase 1).
//
// `resolveDealerAvailability` is the single seam a buyer schedules against. In
// Phase 1 it returns platform-default business hours + a minimum lead time +
// the dealer's timezone; a real recurring-rules `DealerAvailability` model can be
// populated behind this exact function in a later phase with no buyer-flow
// rework. `isWithinAvailability` is the pure validator both the buyer API route
// and the scheduling UI consult, so client hints and the server gate never drift.

export interface DealerAvailability {
  /** IANA timezone the business hours are expressed in. */
  timezone: string;
  /** Human-readable timezone label for UI copy. */
  timezoneLabel: string;
  /** Inclusive opening hour, 0–23 (local to `timezone`). */
  openHour: number;
  /** Exclusive closing hour, 0–23 (local to `timezone`). */
  closeHour: number;
  /** Bookable weekdays, 0=Sun … 6=Sat. */
  days: number[];
  /** Minimum hours between "now" and the booked slot. */
  minLeadTimeHours: number;
  /** Furthest a slot may be booked, in days from now. */
  maxAdvanceDays: number;
}

// Phase-1 platform defaults. A real per-dealer lookup replaces the body of
// resolveDealerAvailability later without changing this shape or any caller.
const PLATFORM_DEFAULT: DealerAvailability = {
  timezone: "America/Chicago",
  timezoneLabel: "CT",
  openHour: 9,
  closeHour: 18,
  days: [1, 2, 3, 4, 5, 6], // Mon–Sat
  minLeadTimeHours: 24,
  maxAdvanceDays: 30,
};

/**
 * Resolve the availability window a buyer may schedule a pickup against.
 * Phase 1: platform defaults for every dealer. The `dealerId` is accepted now so
 * the signature is stable when per-dealer rules land.
 */
export function resolveDealerAvailability(_dealerId?: string | null): DealerAvailability {
  return { ...PLATFORM_DEFAULT, days: [...PLATFORM_DEFAULT.days] };
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/** The wall-clock weekday + hour of `d` in the given IANA timezone. */
function localParts(timezone: string, d: Date): { weekday: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(d);
  const weekdayStr = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "0";
  return {
    weekday: WEEKDAY_INDEX[weekdayStr] ?? 0,
    hour: parseInt(hourStr, 10) % 24, // some engines emit "24" for midnight
  };
}

/**
 * Pure check that a requested pickup instant falls inside the dealer's bookable
 * window: past the minimum lead time, within the advance limit, on a business
 * day, and during business hours (all evaluated in the dealer's timezone).
 */
export function isWithinAvailability(
  a: DealerAvailability,
  when: Date,
  now: Date,
): { ok: true } | { ok: false; reason: string } {
  if (Number.isNaN(when.getTime())) {
    return { ok: false, reason: "Please choose a valid pickup date and time." };
  }

  const leadMs = a.minLeadTimeHours * 60 * 60 * 1000;
  if (when.getTime() < now.getTime() + leadMs) {
    return {
      ok: false,
      reason: `Pickup must be at least ${a.minLeadTimeHours} hours from now so the dealership can prepare your vehicle.`,
    };
  }

  const maxMs = a.maxAdvanceDays * 24 * 60 * 60 * 1000;
  if (when.getTime() > now.getTime() + maxMs) {
    return {
      ok: false,
      reason: `Pickup must be within the next ${a.maxAdvanceDays} days.`,
    };
  }

  const { weekday, hour } = localParts(a.timezone, when);
  if (!a.days.includes(weekday)) {
    return {
      ok: false,
      reason: "Please choose a business day (Monday–Saturday) for your pickup.",
    };
  }
  if (hour < a.openHour || hour >= a.closeHour) {
    return {
      ok: false,
      reason: `Please choose a time during business hours (${a.openHour}:00–${a.closeHour}:00 ${a.timezoneLabel}).`,
    };
  }

  return { ok: true };
}
