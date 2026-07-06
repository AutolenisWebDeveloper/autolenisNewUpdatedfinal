// Unit tests for lib/format.ts — pins the shared formatter behavior the
// per-dashboard migration relies on.
//
// Run with: npx tsx --test lib/__tests__/format.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { formatCurrency, formatNumber, formatDate, formatRelative } from "../format";

test("formatCurrency: whole-dollar default (cents in)", () => {
  assert.equal(formatCurrency(9900), "$99");
  assert.equal(formatCurrency(123456), "$1,235"); // rounds to whole dollars
  assert.equal(formatCurrency(0), "$0");
});

test("formatCurrency: two-decimal mode for exact balances", () => {
  assert.equal(formatCurrency(9900, { cents: true }), "$99.00");
  assert.equal(formatCurrency(123450, { cents: true }), "$1,234.50");
});

test("formatNumber: locale grouping", () => {
  assert.equal(formatNumber(1234567), "1,234,567");
});

test("formatDate: default and null handling", () => {
  assert.equal(formatDate("2026-01-05T12:00:00Z"), "Jan 5, 2026");
  assert.equal(formatDate(null), "—");
  assert.equal(formatDate("not-a-date"), "—");
});

test("formatRelative: buckets", () => {
  const now = new Date("2026-01-10T12:00:00Z");
  assert.equal(formatRelative(new Date("2026-01-10T11:59:40Z"), now), "just now");
  assert.equal(formatRelative(new Date("2026-01-10T11:30:00Z"), now), "30m ago");
  assert.equal(formatRelative(new Date("2026-01-10T09:00:00Z"), now), "3h ago");
  assert.equal(formatRelative(new Date("2026-01-08T12:00:00Z"), now), "2d ago");
  assert.equal(formatRelative(new Date("2025-12-01T12:00:00Z"), now), "Dec 1, 2025");
  assert.equal(formatRelative(null, now), "—");
});
