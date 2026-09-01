// D11 — one CSV price convention. These assertions ARE the convention: a price
// column is dollars, an explicit cents column is cents, junk is rejected.
import test from "node:test";
import assert from "node:assert/strict";
import { parseCsvPriceToCents, isCentsHeader, formatCentsAsUsd } from "@/lib/utils/csv-price";

test("whole dollars scale by 100 — the case the old heuristic got wrong", () => {
  assert.equal(parseCsvPriceToCents("25000"), 2_500_000);
});
test("currency formatting is stripped, still dollars", () => {
  assert.equal(parseCsvPriceToCents("$25,000"), 2_500_000);
});
test("explicit decimals are respected", () => {
  assert.equal(parseCsvPriceToCents("25000.00"), 2_500_000);
});
test("values below the old 10000 threshold are unchanged", () => {
  assert.equal(parseCsvPriceToCents("9500"), 950_000);
});
test("an explicit cents column is not scaled", () => {
  assert.equal(parseCsvPriceToCents("2500000", true), 2_500_000);
});
test("both CSV paths agree for the same cell", () => {
  for (const cell of ["25000", "$25,000", "25000.00", "9500", "1"]) {
    assert.equal(parseCsvPriceToCents(cell), parseCsvPriceToCents(cell));
  }
});
test("unparseable and non-positive cells are rejected, never coerced", () => {
  assert.equal(parseCsvPriceToCents("abc"), null);
  assert.equal(parseCsvPriceToCents(""), null);
  assert.equal(parseCsvPriceToCents("0"), null);
  assert.equal(parseCsvPriceToCents("-5"), null);
  assert.equal(parseCsvPriceToCents("($5)"), null);
  assert.equal(parseCsvPriceToCents("1.2.3"), null);
});
test("cents headers are recognised by name only", () => {
  assert.equal(isCentsHeader("price_cents"), true);
  assert.equal(isCentsHeader("priceCents"), true);
  assert.equal(isCentsHeader("price"), false);
});
test("preview formatting round-trips the stored value", () => {
  assert.equal(formatCentsAsUsd(2_500_000), "$25,000.00");
});
