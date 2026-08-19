// D1 — resolveDealerAvailability: the DB-backed resolver behind the pickup gate.
//
// Precedence: a stored DealerAvailability row wins; absent a row, the timezone is
// DERIVED from the dealer's ZIP (state fallback) and platform-default hours apply,
// so every existing dealer keeps working before any hours are set. A null dealer
// resolves to the platform default without touching the DB.
//
// Uses dependency injection (no module mocking) — a fake prisma is passed in.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/pickup/__tests__/dealer-availability.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { resolveDealerAvailability } from "../availability.service";

function fakePrisma(opts: {
  availabilityRow?: unknown;
  dealer?: unknown;
}) {
  return {
    dealerAvailability: {
      findUnique: async () => opts.availabilityRow ?? null,
    },
    dealer: {
      findUnique: async () => opts.dealer ?? null,
    },
  } as never;
}

test("a null dealerId resolves to the platform default and never touches the DB", async () => {
  let touched = false;
  const prisma = {
    dealerAvailability: { findUnique: async () => { touched = true; return null; } },
    dealer: { findUnique: async () => { touched = true; return null; } },
  } as never;

  const a = await resolveDealerAvailability(null, { prisma });
  assert.equal(touched, false, "no DB read for a null dealer");
  assert.equal(a.windows.length, 6);
  assert.equal(a.minLeadTimeHours, 24);
});

test("a stored availability row wins: its timezone + per-weekday windows are used", async () => {
  const prisma = fakePrisma({
    availabilityRow: {
      timezone: "America/Los_Angeles",
      timezoneOverridden: true,
      minLeadTimeHours: 12,
      maxAdvanceDays: 45,
      windows: [
        { weekday: 6, openMinute: 600, closeMinute: 840 }, // Sat 10:00–14:00
      ],
      blackouts: [
        { startDate: new Date("2026-07-04T00:00:00Z"), endDate: new Date("2026-07-04T00:00:00Z") },
      ],
    },
  });

  const a = await resolveDealerAvailability("dealer_1", { prisma });
  assert.equal(a.timezone, "America/Los_Angeles");
  assert.equal(a.minLeadTimeHours, 12);
  assert.equal(a.maxAdvanceDays, 45);
  assert.equal(a.windows.length, 1);
  assert.deepEqual(a.windows[0], { weekday: 6, openMinute: 600, closeMinute: 840 });
  assert.equal(a.blackouts.length, 1);
  // Display summary derived from the single Saturday window.
  assert.deepEqual(a.days, [6]);
});

test("no row → timezone derived from the dealer's ZIP (CA → Pacific), default hours", async () => {
  const prisma = fakePrisma({ availabilityRow: null, dealer: { zip: "90001", state: "CA" } });
  const a = await resolveDealerAvailability("dealer_ca", { prisma });
  assert.equal(a.timezone, "America/Los_Angeles");
  assert.equal(a.windows.length, 6, "platform-default Mon–Sat hours");
});

test("no row and no ZIP/state signal → safe Eastern default", async () => {
  const prisma = fakePrisma({ availabilityRow: null, dealer: { zip: null, state: null } });
  const a = await resolveDealerAvailability("dealer_unknown", { prisma });
  assert.equal(a.timezone, "America/New_York");
  assert.equal(a.windows.length, 6);
});
