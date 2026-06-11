import 'server-only';

// ---------------------------------------------------------------------------
// RECIPIENT TIMEZONE + TCPA QUIET HOURS (Fix B)
// ---------------------------------------------------------------------------
// TCPA quiet hours (08:00–21:00) are local to the RECIPIENT, not to a single
// platform timezone. We derive the recipient's IANA tz from their US state
// (dominant zone for split states), fall back to a ZIP3 range, and — when
// neither resolves — apply the CONUS-safe envelope: only send when the current
// time is inside 08:00–21:00 in BOTH America/New_York AND America/Los_Angeles
// (the strictest contiguous-US intersection, ~11:00–21:00 ET).

const QUIET_END_HOUR = 8; // sends allowed from 08:00 local (inclusive)
const QUIET_START_HOUR = 21; // no sends at/after 21:00 local

// State → dominant IANA timezone. Split states (FL, TX, etc.) use the zone that
// covers the majority of the population.
const STATE_TZ: Record<string, string> = {
  AL: 'America/Chicago',
  AK: 'America/Anchorage',
  AZ: 'America/Phoenix',
  AR: 'America/Chicago',
  CA: 'America/Los_Angeles',
  CO: 'America/Denver',
  CT: 'America/New_York',
  DE: 'America/New_York',
  DC: 'America/New_York',
  FL: 'America/New_York', // panhandle is Central but most of FL is Eastern
  GA: 'America/New_York',
  HI: 'Pacific/Honolulu',
  ID: 'America/Boise', // most of ID is Mountain; panhandle is Pacific
  IL: 'America/Chicago',
  IN: 'America/Indiana/Indianapolis',
  IA: 'America/Chicago',
  KS: 'America/Chicago', // far west is Mountain
  KY: 'America/New_York', // western KY is Central
  LA: 'America/Chicago',
  ME: 'America/New_York',
  MD: 'America/New_York',
  MA: 'America/New_York',
  MI: 'America/Detroit',
  MN: 'America/Chicago',
  MS: 'America/Chicago',
  MO: 'America/Chicago',
  MT: 'America/Denver',
  NE: 'America/Chicago', // west is Mountain
  NV: 'America/Los_Angeles', // tiny NE corner is Mountain
  NH: 'America/New_York',
  NJ: 'America/New_York',
  NM: 'America/Denver',
  NY: 'America/New_York',
  NC: 'America/New_York',
  ND: 'America/Chicago', // SW is Mountain
  OH: 'America/New_York',
  OK: 'America/Chicago',
  OR: 'America/Los_Angeles', // far east is Mountain
  PA: 'America/New_York',
  RI: 'America/New_York',
  SC: 'America/New_York',
  SD: 'America/Chicago', // west is Mountain
  TN: 'America/Chicago', // east is Eastern
  TX: 'America/Chicago', // far west (El Paso) is Mountain
  UT: 'America/Denver',
  VT: 'America/New_York',
  VA: 'America/New_York',
  WA: 'America/Los_Angeles',
  WV: 'America/New_York',
  WI: 'America/Chicago',
  WY: 'America/Denver',
};

// Coarse ZIP3 (leading-3-digit) → timezone. Used only when state is absent.
// Ranges follow USPS sectional-center geography at a region granularity; any
// prefix not matched falls through to the CONUS-safe envelope (never unsafe).
function zip3ToTimezone(zip: string): string | null {
  const digits = zip.replace(/\D/g, '');
  if (digits.length < 3) return null;
  const z = Number(digits.slice(0, 3));
  if (Number.isNaN(z)) return null;

  // 005–349: Northeast + Mid-Atlantic + Southeast → Eastern
  if (z >= 5 && z <= 349) return 'America/New_York';
  // 350–369: AL → Central
  if (z >= 350 && z <= 369) return 'America/Chicago';
  // 370–385: TN/MS → Central (east TN is Eastern, accepted approximation)
  if (z >= 370 && z <= 385) return 'America/Chicago';
  // 386–397: MS → Central
  if (z >= 386 && z <= 397) return 'America/Chicago';
  // 398–399: GA → Eastern
  if (z >= 398 && z <= 399) return 'America/New_York';
  // 400–427: KY → Eastern
  if (z >= 400 && z <= 427) return 'America/New_York';
  // 430–459: OH → Eastern
  if (z >= 430 && z <= 459) return 'America/New_York';
  // 460–479: IN → Eastern
  if (z >= 460 && z <= 479) return 'America/Indiana/Indianapolis';
  // 480–499: MI → Eastern
  if (z >= 480 && z <= 499) return 'America/Detroit';
  // 500–599: IA/MN/MT/ND/SD/WI/IL-region → Central (MT is Mountain, approximated)
  if (z >= 500 && z <= 567) return 'America/Chicago';
  if (z >= 570 && z <= 599) return 'America/Denver'; // 59x = MT → Mountain
  // 600–658: IL/MO → Central
  if (z >= 600 && z <= 658) return 'America/Chicago';
  // 660–679: KS → Central
  if (z >= 660 && z <= 679) return 'America/Chicago';
  // 680–693: NE → Central
  if (z >= 680 && z <= 693) return 'America/Chicago';
  // 700–729: LA/AR → Central
  if (z >= 700 && z <= 729) return 'America/Chicago';
  // 730–749: OK → Central
  if (z >= 730 && z <= 749) return 'America/Chicago';
  // 750–797: TX → Central
  if (z >= 750 && z <= 797) return 'America/Chicago';
  // 798–799: far-west TX (El Paso / Hudspeth) → Mountain
  if (z >= 798 && z <= 799) return 'America/Denver';
  // 800–831: CO/WY → Mountain
  if (z >= 800 && z <= 831) return 'America/Denver';
  // 832–838: ID → Mountain
  if (z >= 832 && z <= 838) return 'America/Boise';
  // 840–847: UT → Mountain
  if (z >= 840 && z <= 847) return 'America/Denver';
  // 850–865: AZ → no-DST Mountain
  if (z >= 850 && z <= 865) return 'America/Phoenix';
  // 870–884: NM → Mountain
  if (z >= 870 && z <= 884) return 'America/Denver';
  // 889–898: NV → Pacific
  if (z >= 889 && z <= 898) return 'America/Los_Angeles';
  // 900–961: CA → Pacific
  if (z >= 900 && z <= 961) return 'America/Los_Angeles';
  // 967–968: HI
  if (z >= 967 && z <= 968) return 'Pacific/Honolulu';
  // 970–979: OR → Pacific
  if (z >= 970 && z <= 979) return 'America/Los_Angeles';
  // 980–994: WA → Pacific
  if (z >= 980 && z <= 994) return 'America/Los_Angeles';
  // 995–999: AK
  if (z >= 995 && z <= 999) return 'America/Anchorage';

  return null;
}

// Resolve a recipient's IANA timezone. ZIP3 is PREFERRED over state when both
// are present: a ZIP3 prefix pins the actual zone of a split-zone state (e.g.
// El Paso, TX is Mountain while the rest of TX is Central), whereas STATE_TZ
// only knows the state's dominant zone. State is the fallback when ZIP3 doesn't
// resolve; the caller applies the CONUS-safe envelope when neither does.
export function resolveRecipientTimezone(
  state?: string | null,
  zip?: string | null,
): string | null {
  if (zip) {
    const tz = zip3ToTimezone(zip);
    if (tz) return tz;
  }
  if (state) {
    const tz = STATE_TZ[state.trim().toUpperCase()];
    if (tz) return tz;
  }
  return null;
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
