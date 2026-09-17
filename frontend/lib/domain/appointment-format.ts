// lib/domain/appointment-format.ts
//
// ONE formatter for a pickup appointment — §8.1 row 10's cross-portal parity, at the
// smallest scale it occurs.
//
// ── THIS IS NOT A HYPOTHETICAL TIDY-UP ──────────────────────────────────────
//
// `makeFmt` existed twice, once per portal, and the two had ALREADY DIVERGED:
//
//   app/buyer/pickup/page.tsx:25   weekday: "long",  month: "long"   → "Monday, September 20"
//   app/dealer/pickups/page.tsx:15 weekday: "short", month: "short"  → "Mon, Sep 20"
//
// The same appointment, the same instant, the same time zone — rendered differently to
// the two people who have to meet at it. Nothing was broken enough to notice, and that
// is the point: §8.1 row 10 asks for one lineage precisely because independent
// implementations of the same fact drift quietly and are only found by reading both.
//
// ── DENSITY IS A PARAMETER, NOT A SECOND IMPLEMENTATION ─────────────────────
//
// The dealer surface is a LIST of appointments and the buyer surface is ONE, so a
// shorter form there is a legitimate design choice rather than the drift. Keeping it
// as an explicit `style` means the difference is stated and reviewable, and every
// other property — the zone, the label, the null rendering, the locale — is shared and
// cannot diverge again without editing this file.

export type AppointmentStyle = "long" | "short";

const STYLES: Record<AppointmentStyle, Intl.DateTimeFormatOptions> = {
  /** A single appointment on a detail page. "Monday, September 20 at 2:30 PM". */
  long: { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" },
  /** A row in a list of appointments. "Mon, Sep 20, 2:30 PM". */
  short: { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
};

/**
 * The em dash every surface already used for "no appointment".
 *
 * Shared because a portal that rendered an empty string instead would collapse the
 * row and read as a rendering bug rather than as an absent time.
 */
export const NO_APPOINTMENT = "—";

/**
 * Format an appointment instant in the dealership's zone, with the zone named.
 *
 * `label` is the zone abbreviation the caller already resolved (the two pages both
 * pass one). It is appended rather than derived here so a surface can say "CT
 * (dealership local)" where that disambiguation matters — which the buyer page does,
 * because a buyer in another zone reading a bare time will get the day wrong.
 */
export function formatAppointment(
  d: Date | null | undefined,
  timeZone: string,
  label: string,
  style: AppointmentStyle = "long",
): string {
  if (!d) return NO_APPOINTMENT;
  return `${d.toLocaleString("en-US", { ...STYLES[style], timeZone })} ${label}`;
}

/**
 * The curried form both pages already used, so neither call site changes shape.
 *
 * Kept deliberately: the pages bind zone and label once and then format many dates,
 * and rewriting every call site to pass three arguments would have been a larger diff
 * for no gain.
 */
export function makeAppointmentFormatter(
  timeZone: string,
  label: string,
  style: AppointmentStyle = "long",
): (d: Date | null | undefined) => string {
  return (d) => formatAppointment(d, timeZone, label, style);
}
