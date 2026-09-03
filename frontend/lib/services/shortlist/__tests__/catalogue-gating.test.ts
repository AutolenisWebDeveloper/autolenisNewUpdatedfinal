// Gating a whole catalogue page: distance is a label and a sort, never a filter.
//
// The public catalogue used to apply ?zip=&radiusMiles= as a WHERE plus an in-memory filter,
// dropping every out-of-radius row AND every row with null coordinates. Since the adapter never
// wrote coordinates, a buyer who entered a ZIP got an empty grid on a catalogue of 148 cars.
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/shortlist/__tests__/catalogue-gating.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { gateCatalogue, type CatalogueRow } from "../shortlist-radius";

const NOW = new Date("2026-09-03T12:00:00Z");
const DALLAS = { lat: 32.7831, lng: -96.8067 };
const ARLINGTON = { lat: 32.7451, lng: -97.0836 };   // ~17 mi from Dallas
const MANHATTAN = { lat: 40.7506, lng: -73.9971 };   // ~1,370 mi

function row(id: string, at: { lat: number; lng: number } | null, over: Partial<CatalogueRow> = {}): CatalogueRow {
  return {
    id,
    latitude: at?.lat ?? null,
    longitude: at?.lng ?? null,
    isActive: true,
    priceCents: 2_500_000,
    lastSeenAt: NOW,
    lane: "LANE_3",
    dealerId: null,
    addedByAdminId: null,
    ...over,
  };
}

test("nothing is ever dropped — the row count in equals the row count out", () => {
  const rows = [row("near", ARLINGTON), row("far", MANHATTAN), row("unplaceable", null)];
  const r = gateCatalogue(rows, DALLAS, NOW);
  assert.equal(r.gated.length, 3);
  assert.deepEqual(r.gated.map(g => g.row.id), ["near", "far", "unplaceable"]);
});

test("distance is computed and rounded for display", () => {
  const r = gateCatalogue([row("near", ARLINGTON)], DALLAS, NOW);
  const d = r.gated[0]!.distanceMiles!;
  assert.ok(d > 10 && d < 25, `expected ~17 miles, got ${d}`);
  assert.equal(d, Math.round(d * 10) / 10, "rounded to one decimal for the card");
});

test("an unplaceable listing gets a null distance, not a fake one", () => {
  const r = gateCatalogue([row("x", null)], DALLAS, NOW);
  assert.equal(r.gated[0]!.distanceMiles, null);
});

test("with a ZIP, results are ordered nearest first", () => {
  const rows = [row("far", MANHATTAN), row("unplaceable", null), row("near", ARLINGTON)];
  const r = gateCatalogue(rows, DALLAS, NOW);
  assert.deepEqual(r.gated.map(g => g.row.id), ["near", "far", "unplaceable"],
    "unplaceable rows sort last — they are still present, just not rankable");
});

test("with NO ZIP the original order is preserved and every action asks for one", () => {
  const rows = [row("a", MANHATTAN), row("b", ARLINGTON)];
  const r = gateCatalogue(rows, null, NOW);
  assert.deepEqual(r.gated.map(g => g.row.id), ["a", "b"]);
  assert.equal(r.hasZip, false);
  assert.ok(r.gated.every(g => g.gate.action === "NEED_ZIP"));
});

test("inRadiusCount drives the empty-state decision without emptying the grid", () => {
  const rows = [row("far", MANHATTAN), row("unplaceable", null)];
  const r = gateCatalogue(rows, DALLAS, NOW);
  assert.equal(r.inRadiusCount, 0, "nothing is shortlistable");
  assert.equal(r.gated.length, 2, "but both are still rendered as examples");
});

test("inRadiusCount counts only what can actually be shortlisted", () => {
  const rows = [
    row("near", ARLINGTON),
    row("near-but-expired", ARLINGTON, { lastSeenAt: new Date(NOW.getTime() - 31 * 864e5) }),
    row("near-but-sold", ARLINGTON, { isActive: false }),
    row("far", MANHATTAN),
  ];
  const r = gateCatalogue(rows, DALLAS, NOW);
  assert.equal(r.inRadiusCount, 1);
  assert.equal(r.gated.length, 4);
});

test("a stale-flagged listing still counts as shortlistable", () => {
  const rows = [row("stale", ARLINGTON, { lastSeenAt: new Date(NOW.getTime() - 8 * 864e5) })];
  const r = gateCatalogue(rows, DALLAS, NOW);
  assert.equal(r.inRadiusCount, 1);
  assert.equal(r.gated[0]!.gate.freshness, "STALE");
  assert.equal(r.gated[0]!.gate.action, "ADD");
});

test("an empty catalogue is an empty result, not a crash", () => {
  const r = gateCatalogue([], DALLAS, NOW);
  assert.deepEqual(r.gated, []);
  assert.equal(r.inRadiusCount, 0);
});

test("Prisma Decimal coordinates are handled, not just numbers", () => {
  // Prisma returns Decimal for these columns; Number() is what makes them usable.
  const decimal = (n: number) => ({ toString: () => String(n), valueOf: () => n });
  const r = gateCatalogue(
    [{ ...row("d", null), latitude: decimal(32.7451) as unknown as number, longitude: decimal(-97.0836) as unknown as number }],
    DALLAS,
    NOW,
  );
  assert.ok(r.gated[0]!.distanceMiles !== null, "a Decimal must not read as unplaceable");
});
