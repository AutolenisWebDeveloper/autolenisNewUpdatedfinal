// AutoLenis Social Engine — posting-slot scheduling helpers.
//
// Franchise posting slots are expressed as hours in US Central Time (the
// platform's primary market). These helpers convert a CT hour into the correct
// absolute UTC instant for a given day, handling CST/CDT automatically.

// Returns (tz wall time − UTC) in minutes for a timezone at a given instant.
// Negative for US Central (e.g. −300 during CDT, −360 during CST).
function tzOffsetMinutes(timeZone: string, date: Date): number {
  const utc = new Date(date.toLocaleString("en-US", { timeZone: "UTC" }));
  const tz = new Date(date.toLocaleString("en-US", { timeZone }));
  return (tz.getTime() - utc.getTime()) / 60000;
}

// Builds the absolute Date for `hourCt` (0–23, Central Time) on the day that is
// `dayOffset` days from now.
export function ctSlotToDate(hourCt: number, dayOffset = 0): Date {
  const base = new Date(Date.now() + dayOffset * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(base);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const y = get("year");
  const m = get("month");
  const d = get("day");
  const hh = String(hourCt).padStart(2, "0");

  // Treat the CT wall time as if it were UTC, then subtract the CT offset to
  // land on the true UTC instant.
  const naiveUtc = new Date(`${y}-${m}-${d}T${hh}:00:00Z`);
  const offset = tzOffsetMinutes("America/Chicago", naiveUtc);
  return new Date(naiveUtc.getTime() - offset * 60_000);
}

// Returns today's posting-slot instants (CT hours → UTC). Slots that have
// already passed today roll forward to the same hour tomorrow so generated
// content is always scheduled in the future.
export function computePostingSlots(slotsCt: number[], minLeadMs = 5 * 60_000): Date[] {
  const now = Date.now();
  return slotsCt.map((hour) => {
    const today = ctSlotToDate(hour, 0);
    return today.getTime() > now + minLeadMs ? today : ctSlotToDate(hour, 1);
  });
}
