// G3 — buyer pickup self-scheduling availability guard.
//
// resolveDealerAvailability is the single Phase-1 seam that returns the pickup
// window a buyer may book against (platform defaults for now; a real per-dealer
// recurring-rules model slots in behind this same function in a later phase with
// zero buyer-flow rework). isWithinAvailability is the pure validator the buyer
// route and the UI both consult.
//
// Run with:
//   npx tsx --test lib/services/pickup/__tests__/availability.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveDealerAvailability,
  isWithinAvailability,
} from "../availability.service";

// Fixed January dates → America/Chicago is on CST (UTC-6), no DST ambiguity.
// Jan 12 2026 = Mon, Jan 14 = Wed, Jan 18 = Sun.
const NOW = new Date("2026-01-12T20:00:00Z"); // Mon 14:00 CST

test("resolveDealerAvailability returns platform defaults and is stable for any dealer", () => {
  const a = resolveDealerAvailability(null);
  assert.equal(a.openHour, 9);
  assert.equal(a.closeHour, 18);
  assert.deepEqual(a.days, [1, 2, 3, 4, 5, 6]); // Mon–Sat
  assert.equal(a.minLeadTimeHours, 24);
  assert.equal(a.maxAdvanceDays, 30);
  assert.ok(a.timezone.length > 0);
  // Phase 1: dealer id does not change the window (defaults for everyone).
  assert.deepEqual(resolveDealerAvailability("dealer-123"), a);
  assert.deepEqual(resolveDealerAvailability(undefined), a);
});

test("a weekday slot during business hours, past the lead time and inside the window, is allowed", () => {
  const a = resolveDealerAvailability(null);
  const when = new Date("2026-01-14T20:00:00Z"); // Wed 14:00 CST
  assert.deepEqual(isWithinAvailability(a, when, NOW), { ok: true });
});

test("a slot inside the minimum lead time is rejected", () => {
  const a = resolveDealerAvailability(null);
  const now = new Date("2026-01-14T10:00:00Z");
  const when = new Date("2026-01-14T20:00:00Z"); // only 10h later < 24h
  const res = isWithinAvailability(a, when, now);
  assert.equal(res.ok, false);
  assert.match(res.reason!, /24 hours/);
});

test("a slot beyond the maximum advance window is rejected", () => {
  const a = resolveDealerAvailability(null);
  const when = new Date("2026-03-01T20:00:00Z"); // ~48 days out
  const res = isWithinAvailability(a, when, NOW);
  assert.equal(res.ok, false);
  assert.match(res.reason!, /30 days/);
});

test("a Sunday slot is rejected as a non-business day", () => {
  const a = resolveDealerAvailability(null);
  const when = new Date("2026-01-18T20:00:00Z"); // Sun 14:00 CST
  const res = isWithinAvailability(a, when, NOW);
  assert.equal(res.ok, false);
  assert.match(res.reason!, /business day/i);
});

test("a weekday slot before opening is rejected", () => {
  const a = resolveDealerAvailability(null);
  const when = new Date("2026-01-14T13:00:00Z"); // Wed 07:00 CST (< 9)
  const res = isWithinAvailability(a, when, NOW);
  assert.equal(res.ok, false);
  assert.match(res.reason!, /business hours/i);
});

test("a weekday slot after closing is rejected", () => {
  const a = resolveDealerAvailability(null);
  const when = new Date("2026-01-15T01:00:00Z"); // Wed 19:00 CST (>= 18)
  const res = isWithinAvailability(a, when, NOW);
  assert.equal(res.ok, false);
  assert.match(res.reason!, /business hours/i);
});
