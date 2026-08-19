import 'server-only';
import { resolveUsTimezone } from '@/lib/util/us-timezone';

// ---------------------------------------------------------------------------
// RECIPIENT TIMEZONE + TCPA QUIET HOURS (Fix B)
// ---------------------------------------------------------------------------
// TCPA quiet hours (08:00–21:00) are local to the RECIPIENT, not to a single
// platform timezone. We derive the recipient's IANA tz from their US state
// (dominant zone for split states), fall back to a ZIP3 range, and — when
// neither resolves — apply the CONUS-safe envelope: only send when the current
// time is inside 08:00–21:00 in BOTH America/New_York AND America/Los_Angeles
// (the strictest contiguous-US intersection, ~11:00–21:00 ET).
//
// The state/ZIP → IANA maps live in `lib/util/us-timezone.ts` (no `server-only`)
// so the pickup availability gate can reuse the exact same resolution without
// pulling this server-only module. This file keeps the TCPA quiet-hours policy.

const QUIET_END_HOUR = 8; // sends allowed from 08:00 local (inclusive)
const QUIET_START_HOUR = 21; // no sends at/after 21:00 local

// Resolve a recipient's IANA timezone. ZIP3 is PREFERRED over state when both
// are present (a ZIP3 pins the actual zone of a split-zone state); state is the
// fallback; null when neither resolves (caller applies the CONUS-safe envelope).
export function resolveRecipientTimezone(
  state?: string | null,
  zip?: string | null,
): string | null {
  return resolveUsTimezone(state, zip);
}

// Current local hour (0–23) in a given IANA timezone.
function hourInTimezone(now: Date, tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      hour12: false,
    }).formatToParts(now);
    let hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '12');
    if (hour === 24) hour = 0; // hour12:false can emit 24 at midnight
    return hour;
  } catch {
    return now.getUTCHours();
  }
}

function withinSendWindow(hour: number): boolean {
  return hour >= QUIET_END_HOUR && hour < QUIET_START_HOUR;
}

// TRUE when sending is prohibited (recipient is inside quiet hours). When the
// recipient tz is unknown, requires BOTH coasts to be inside the send window.
export function isRecipientInQuietHours(
  now: Date,
  ref: { state?: string | null; zip?: string | null },
): boolean {
  const tz = resolveRecipientTimezone(ref.state, ref.zip);
  if (tz) {
    return !withinSendWindow(hourInTimezone(now, tz));
  }
  // CONUS-safe envelope — intersection of ET and PT send windows.
  const etOk = withinSendWindow(hourInTimezone(now, 'America/New_York'));
  const ptOk = withinSendWindow(hourInTimezone(now, 'America/Los_Angeles'));
  return !(etOk && ptOk);
}
