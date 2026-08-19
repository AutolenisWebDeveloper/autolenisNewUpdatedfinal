// D1 — dealer pickup availability: the pure validator over a real per-weekday
// window model, evaluated in the dealer's IANA timezone.
//
// resolveDealerAvailability is the DB-backed seam (covered in
// dealer-availability.test.ts). Here we pin the *pure* logic that both the buyer
// route and the scheduling service consult: per-weekday windows, blackout dates,
// lead-time / max-advance, and — critically — timezone + DST correctness, the #1
// way scheduling silently breaks.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/pickup/__tests__/availability.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  platformDefaultAvailability,
  isWithinAvailability,
  type DealerAvailability,
  type AvailabilityWindow,
} from "../availability.service";

// Minutes-from-midnight helpers for readable window literals.
const at = (h: number, m = 0) => h * 60 + m;
const win = (weekday: number, oh: number, ch: number): AvailabilityWindow => ({
  weekday,
  openMinute: at(oh),
  closeMinute: at(ch),
});

// A default-shaped availability in a chosen zone (Mon–Sat 9–18) for the plain cases.
function defaults(tz = "America/Chicago"): DealerAvailability {
  return platformDefaultAvailability(tz);
}

// ── platform default shape ───────────────────────────────────────────────────

test("platformDefaultAvailability exposes windows + a display summary", () => {
  const a = defaults();
  assert.equal(a.timezone, "America/Chicago");
  assert.equal(a.minLeadTimeHours, 24);
  assert.equal(a.maxAdvanceDays, 30);
  // Real enforcement data:
  assert.equal(a.windows.length, 6, "Mon–Sat");
  assert.deepEqual(
    [...new Set(a.windows.map((w) => w.weekday))].sort((x, y) => x - y),
    [1, 2, 3, 4, 5, 6],
  );
  assert.ok(a.windows.every((w) => w.openMinute === at(9) && w.closeMinute === at(18)));
  assert.ok(a.blackouts.length === 0);
  // Display-only summary the buyer form renders (server enforces `windows`):
  assert.equal(a.openHour, 9);
  assert.equal(a.closeHour, 18);
  assert.deepEqual(a.days, [1, 2, 3, 4, 5, 6]);
  assert.ok(a.timezoneLabel.length > 0);
});

// ── basic window / lead-time / advance rules ─────────────────────────────────

const NOW = new Date("2026-01-12T20:00:00Z"); // Mon 14:00 CST

test("a weekday slot during business hours, past lead time, inside window, is allowed", () => {
  const when = new Date("2026-01-14T20:00:00Z"); // Wed 14:00 CST
  assert.deepEqual(isWithinAvailability(defaults(), when, NOW), { ok: true });
});

test("a slot inside the minimum lead time is rejected", () => {
  const now = new Date("2026-01-14T10:00:00Z");
  const when = new Date("2026-01-14T20:00:00Z"); // ~10h later < 24h
  const res = isWithinAvailability(defaults(), when, now);
  assert.equal(res.ok, false);
  assert.match((res as { reason: string }).reason, /24 hours/);
});

test("a slot beyond the maximum advance window is rejected", () => {
  const when = new Date("2026-03-01T20:00:00Z"); // ~48 days out
  const res = isWithinAvailability(defaults(), when, NOW);
  assert.equal(res.ok, false);
  assert.match((res as { reason: string }).reason, /30 days/);
});

test("a Sunday slot is rejected — no window on a closed day", () => {
  const when = new Date("2026-01-18T20:00:00Z"); // Sun 14:00 CST
  const res = isWithinAvailability(defaults(), when, NOW);
  assert.equal(res.ok, false);
  assert.match((res as { reason: string }).reason, /business day/i);
});

test("a weekday slot before opening and after closing is rejected", () => {
  const before = new Date("2026-01-14T13:00:00Z"); // Wed 07:00 CST (< 9)
  const after = new Date("2026-01-15T01:00:00Z"); // Wed 19:00 CST (>= 18)
  assert.equal(isWithinAvailability(defaults(), before, NOW).ok, false);
  assert.equal(isWithinAvailability(defaults(), after, NOW).ok, false);
});

// ── per-weekday windows + split (lunch-gap) hours ────────────────────────────

test("per-weekday windows: only the configured weekday/hours are bookable", () => {
  // Saturday only, 10:00–14:00 CST.
  const a: DealerAvailability = {
    ...defaults(),
    windows: [win(6, 10, 14)],
    days: [6],
    openHour: 10,
    closeHour: 14,
  };
  // Wed → closed (no window that day).
  assert.equal(isWithinAvailability(a, new Date("2026-01-14T18:00:00Z"), NOW).ok, false);
  // Sat 12:00 CST (18:00Z) → open.
  assert.equal(isWithinAvailability(a, new Date("2026-01-17T18:00:00Z"), NOW).ok, true);
  // Sat 15:00 CST (21:00Z) → after the window.
  assert.equal(isWithinAvailability(a, new Date("2026-01-17T21:00:00Z"), NOW).ok, false);
});

test("split hours: a slot in the lunch gap between two same-day windows is rejected", () => {
  // Monday 09:00–12:00 and 13:00–18:00 CST (closed 12–13).
  const a: DealerAvailability = {
    ...defaults(),
    windows: [win(1, 9, 12), win(1, 13, 18)],
    days: [1],
    openHour: 9,
    closeHour: 18,
  };
  const now = new Date("2026-01-16T12:00:00Z");
  // Mon 11:00 CST (17:00Z) → morning window.
  assert.equal(isWithinAvailability(a, new Date("2026-01-19T17:00:00Z"), now).ok, true);
  // Mon 12:30 CST (18:30Z) → lunch gap → rejected.
  assert.equal(isWithinAvailability(a, new Date("2026-01-19T18:30:00Z"), now).ok, false);
  // Mon 14:00 CST (20:00Z) → afternoon window.
  assert.equal(isWithinAvailability(a, new Date("2026-01-19T20:00:00Z"), now).ok, true);
});

// ── blackout dates ───────────────────────────────────────────────────────────

test("a slot that lands on a blackout date is rejected even inside business hours", () => {
  const a: DealerAvailability = {
    ...defaults(),
    blackouts: [{ start: new Date("2026-01-14T00:00:00Z"), end: new Date("2026-01-14T00:00:00Z") }],
  };
  // Wed 14:00 CST — normally open, but the whole local day is blacked out.
  const res = isWithinAvailability(a, new Date("2026-01-14T20:00:00Z"), NOW);
  assert.equal(res.ok, false);
  assert.match((res as { reason: string }).reason, /closed/i);
});

test("blackout matches on the dealer-local calendar day across timezones (Pacific)", () => {
  // Date-only blackout (stored @db.Date → UTC-midnight). July 4 for a PT dealer.
  const a: DealerAvailability = {
    ...defaults("America/Los_Angeles"),
    blackouts: [{ start: new Date("2026-07-04"), end: new Date("2026-07-04") }],
  };
  const now = new Date("2026-07-01T12:00:00Z");
  // Sat 2026-07-04 12:00 PDT = 19:00Z → local date Jul 4 → blacked out.
  assert.equal(isWithinAvailability(a, new Date("2026-07-04T19:00:00Z"), now).ok, false);
  // Fri 2026-07-03 12:00 PDT = 19:00Z → local date Jul 3 → open, not blacked out.
  assert.equal(isWithinAvailability(a, new Date("2026-07-03T19:00:00Z"), now).ok, true);
});

// ── timezone + DST correctness (the load-bearing tests) ──────────────────────

test("the SAME UTC instant resolves per the dealer's own timezone, not a fixed platform zone", () => {
  // 2026-01-14T23:30:00Z → 18:30 in ET (after close) but 17:30 in CT (open).
  const instant = new Date("2026-01-14T23:30:00Z");
  const now = new Date("2026-01-12T18:00:00Z");
  assert.equal(
    isWithinAvailability(defaults("America/Chicago"), instant, now).ok,
    true,
    "17:30 CT is inside 9–18",
  );
  assert.equal(
    isWithinAvailability(defaults("America/New_York"), instant, now).ok,
    false,
    "18:30 ET is after close — proves the dealer's tz is actually applied",
  );
});

test("DST spring-forward: business hours are evaluated in CDT, not a frozen CST offset", () => {
  // 2026-03-08 is the US spring-forward. On Mon 2026-03-09, America/Chicago is CDT (UTC-5).
  const now = new Date("2026-03-05T15:00:00Z");
  // 2026-03-09T23:30:00Z = 18:30 CDT (after close) → rejected.
  // A frozen CST (UTC-6) reading would call it 17:30 and WRONGLY accept it.
  assert.equal(
    isWithinAvailability(defaults("America/Chicago"), new Date("2026-03-09T23:30:00Z"), now).ok,
    false,
    "18:30 CDT is after close",
  );
  // 2026-03-09T15:00:00Z = 10:00 CDT → open.
  assert.equal(
    isWithinAvailability(defaults("America/Chicago"), new Date("2026-03-09T15:00:00Z"), now).ok,
    true,
    "10:00 CDT is inside hours",
  );
});

test("DST fall-back: business hours are evaluated in CST, not a frozen CDT offset", () => {
  // 2026-11-01 is the US fall-back. On Mon 2026-11-02, America/Chicago is CST (UTC-6).
  const now = new Date("2026-10-30T15:00:00Z");
  // 2026-11-02T14:30:00Z = 08:30 CST (before open) → rejected.
  // A frozen CDT (UTC-5) reading would call it 09:30 and WRONGLY accept it.
  assert.equal(
    isWithinAvailability(defaults("America/Chicago"), new Date("2026-11-02T14:30:00Z"), now).ok,
    false,
    "08:30 CST is before open",
  );
  // 2026-11-02T15:30:00Z = 09:30 CST → open.
  assert.equal(
    isWithinAvailability(defaults("America/Chicago"), new Date("2026-11-02T15:30:00Z"), now).ok,
    true,
    "09:30 CST is inside hours",
  );
});

test("an invalid date is rejected cleanly", () => {
  const res = isWithinAvailability(defaults(), new Date("not-a-date"), NOW);
  assert.equal(res.ok, false);
});
