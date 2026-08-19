// lib/services/pickup/availability.service.ts
// D1 — dealer pickup availability (real per-dealer model).
//
// `resolveDealerAvailability` is the single seam a buyer schedules against. It
// now reads a real `DealerAvailability` (per-weekday windows + blackout dates +
// timezone) when one exists; absent a row it derives the dealer's timezone from
// its address ZIP (state fallback) and applies platform-default hours, so every
// existing dealer keeps working before any hours are set. `isWithinAvailability`
// is the pure validator both the buyer API route and the scheduling service
// consult, so client hints and the server gate never drift — and it evaluates
// the slot in the dealer's IANA timezone via `Intl` (DST-correct, no fixed
// UTC offset).

import { prisma } from "@/lib/prisma";
import { resolveUsTimezone } from "@/lib/util/us-timezone";

/** A bookable window on one weekday, in minutes-from-midnight (dealer local). */
export interface AvailabilityWindow {
  /** 0=Sun … 6=Sat. */
  weekday: number;
  /** Inclusive open, minutes from local midnight (e.g. 9:30 = 570). */
  openMinute: number;
  /** Exclusive close, minutes from local midnight (e.g. 18:00 = 1080). */
  closeMinute: number;
}

/** A closed date range (dealer-local calendar days, inclusive). */
export interface BlackoutRange {
  start: Date;
  end: Date;
}

export interface DealerAvailability {
  /** IANA timezone the windows are expressed in. */
  timezone: string;
  /** Human-readable timezone label for UI copy (e.g. "CT"). */
  timezoneLabel: string;
  /** Per-weekday bookable windows (authoritative — the gate enforces these). */
  windows: AvailabilityWindow[];
  /** Closed date ranges (holidays, inventory events). */
  blackouts: BlackoutRange[];
  /** Minimum hours between "now" and the booked slot. */
  minLeadTimeHours: number;
  /** Furthest a slot may be booked, in days from now. */
  maxAdvanceDays: number;
  /** Display-only summary derived from `windows` (server enforces `windows`). */
  openHour: number;
  /** Display-only summary derived from `windows`. */
  closeHour: number;
  /** Display-only summary: weekdays with at least one window. */
  days: number[];
}

// Safe fallback timezone when a dealer has no availability row and no
// derivable ZIP/state (Eastern covers the largest share of US dealers).
const DEFAULT_TIMEZONE = "America/New_York";

// Platform-default hours: Mon–Sat, 9:00–18:00 local, 24h lead, 30-day advance.
const DEFAULT_OPEN_MINUTE = 9 * 60;
const DEFAULT_CLOSE_MINUTE = 18 * 60;
const DEFAULT_DAYS = [1, 2, 3, 4, 5, 6]; // Mon–Sat
const DEFAULT_MIN_LEAD_HOURS = 24;
const DEFAULT_MAX_ADVANCE_DAYS = 30;

const TZ_LABEL: Record<string, string> = {
  "America/New_York": "ET",
  "America/Detroit": "ET",
  "America/Indiana/Indianapolis": "ET",
  "America/Chicago": "CT",
  "America/Denver": "MT",
  "America/Boise": "MT",
  "America/Phoenix": "MST",
  "America/Los_Angeles": "PT",
  "America/Anchorage": "AKT",
  "Pacific/Honolulu": "HT",
};

function tzLabel(timezone: string): string {
  return TZ_LABEL[timezone] ?? timezone.split("/").pop() ?? timezone;
}

/** Derive the display-only open/close/day summary from the enforced windows. */
function summarize(windows: AvailabilityWindow[]): {
  openHour: number;
  closeHour: number;
  days: number[];
} {
  if (windows.length === 0) return { openHour: 0, closeHour: 0, days: [] };
  const openHour = Math.floor(Math.min(...windows.map((w) => w.openMinute)) / 60);
  const closeHour = Math.ceil(Math.max(...windows.map((w) => w.closeMinute)) / 60);
  const days = [...new Set(windows.map((w) => w.weekday))].sort((a, b) => a - b);
  return { openHour, closeHour, days };
}

/** Platform-default availability (Mon–Sat 9–18) in the given timezone. */
export function platformDefaultAvailability(
  timezone: string = DEFAULT_TIMEZONE,
): DealerAvailability {
  const windows: AvailabilityWindow[] = DEFAULT_DAYS.map((weekday) => ({
    weekday,
    openMinute: DEFAULT_OPEN_MINUTE,
    closeMinute: DEFAULT_CLOSE_MINUTE,
  }));
  return {
    timezone,
    timezoneLabel: tzLabel(timezone),
    windows,
    blackouts: [],
    minLeadTimeHours: DEFAULT_MIN_LEAD_HOURS,
    maxAdvanceDays: DEFAULT_MAX_ADVANCE_DAYS,
    ...summarize(windows),
  };
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/** The dealer-local weekday, minute-of-day, and YYYY-MM-DD of `d` in `timezone`. */
function localParts(
  timezone: string,
  d: Date,
): { weekday: number; minuteOfDay: number; ymd: string } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const weekday = WEEKDAY_INDEX[get("weekday")] ?? 0;
    const hour = parseInt(get("hour") || "0", 10) % 24; // some engines emit "24" for midnight
    const minute = parseInt(get("minute") || "0", 10);
    const ymd = `${get("year")}-${get("month")}-${get("day")}`;
    return { weekday, minuteOfDay: hour * 60 + minute, ymd };
  } catch {
    // A malformed/unknown IANA zone must never 500 the buyer's schedule page or
    // the gate — fall back to UTC (same defensive posture as hourInTimezone).
    return {
      weekday: d.getUTCDay(),
      minuteOfDay: d.getUTCHours() * 60 + d.getUTCMinutes(),
      ymd: d.toISOString().slice(0, 10),
    };
  }
}

/** UTC YYYY-MM-DD of a stored blackout date (blackouts are date-only at UTC midnight). */
function utcYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Pure check that a requested pickup instant falls inside the dealer's bookable
 * window: past the minimum lead time, within the advance limit, not on a
 * blackout date, on a day that has a window, and inside one of that day's
 * windows — all evaluated in the dealer's timezone (DST-correct via Intl).
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

  const { weekday, minuteOfDay, ymd } = localParts(a.timezone, when);

  // Blackout dates — compared on the dealer-local calendar day.
  for (const b of a.blackouts) {
    if (ymd >= utcYmd(b.start) && ymd <= utcYmd(b.end)) {
      return {
        ok: false,
        reason: "The dealership is closed on that date. Please choose another day.",
      };
    }
  }

  const dayWindows = a.windows.filter((w) => w.weekday === weekday);
  if (dayWindows.length === 0) {
    return {
      ok: false,
      reason: "Please choose a business day the dealership is open for pickups.",
    };
  }

  const insideAWindow = dayWindows.some(
    (w) => minuteOfDay >= w.openMinute && minuteOfDay < w.closeMinute,
  );
  if (!insideAWindow) {
    return {
      ok: false,
      reason: `Please choose a time during business hours (${a.openHour}:00–${a.closeHour}:00 ${a.timezoneLabel}).`,
    };
  }

  return { ok: true };
}

// Minimal shape of the Prisma client the resolver needs — lets tests inject a
// fake without a real DB connection (mirrors the ensureCurrentCycleLedger deps
// pattern used elsewhere).
type AvailabilityPrisma = {
  dealerAvailability: {
    findUnique: (args: unknown) => Promise<{
      timezone: string;
      minLeadTimeHours: number;
      maxAdvanceDays: number;
      windows: { weekday: number; openMinute: number; closeMinute: number }[];
      blackouts: { startDate: Date; endDate: Date }[];
    } | null>;
  };
  dealer: {
    findUnique: (args: unknown) => Promise<{ zip: string | null; state: string | null } | null>;
  };
};

/**
 * Resolve the availability window a buyer may schedule a pickup against.
 * Precedence: a stored `DealerAvailability` row wins; absent a row, the dealer's
 * timezone is derived from its ZIP (state fallback) with platform-default hours.
 * A null dealer resolves to the platform default without touching the DB.
 */
export async function resolveDealerAvailability(
  dealerId?: string | null,
  deps: { prisma: AvailabilityPrisma } = { prisma: prisma as unknown as AvailabilityPrisma },
): Promise<DealerAvailability> {
  if (!dealerId) return platformDefaultAvailability(DEFAULT_TIMEZONE);

  const row = await deps.prisma.dealerAvailability.findUnique({
    where: { dealerId },
    include: { windows: true, blackouts: true },
  });

  if (row) {
    const windows: AvailabilityWindow[] = (row.windows ?? []).map((w) => ({
      weekday: w.weekday,
      openMinute: w.openMinute,
      closeMinute: w.closeMinute,
    }));
    const blackouts: BlackoutRange[] = (row.blackouts ?? []).map((b) => ({
      start: b.startDate,
      end: b.endDate,
    }));
    return {
      timezone: row.timezone,
      timezoneLabel: tzLabel(row.timezone),
      windows,
      blackouts,
      minLeadTimeHours: row.minLeadTimeHours,
      maxAdvanceDays: row.maxAdvanceDays,
      ...summarize(windows),
    };
  }

  // No stored hours yet — derive the timezone from the dealer's address and use
  // platform-default hours. This keeps existing dealers bookable pre-D2 (the
  // dealer-facing hours editor).
  const dealer = await deps.prisma.dealer.findUnique({
    where: { id: dealerId },
    select: { zip: true, state: true },
  });
  const tz = resolveUsTimezone(dealer?.state ?? null, dealer?.zip ?? null) ?? DEFAULT_TIMEZONE;
  return platformDefaultAvailability(tz);
}

/**
 * The single availability gate every scheduling path shares: resolve the
 * dealer's availability and validate the requested instant against it. Buyer
 * initial-schedule, buyer reschedule, and admin schedule all call this so the
 * rule lives in exactly one place (no copy-pasted resolve+validate).
 */
export async function checkPickupTime(
  dealerId: string | null | undefined,
  when: Date,
  now: Date = new Date(),
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const availability = await resolveDealerAvailability(dealerId ?? null);
  return isWithinAvailability(availability, when, now);
}
