// Regression guard: the public catalogue must never filter by distance again.
//
// It used to push a bounding box into the Prisma WHERE and then filter the result set again in
// memory. Both dropped out-of-radius rows, and because a bounding box is a coordinate comparison
// both also dropped every row with a NULL coordinate — which, since the adapter had never
// written one, was all 148 of them. Entering a ZIP emptied the entire catalogue.
//
// The gating logic itself is unit-tested in lib/services/shortlist/__tests__/catalogue-gating.
// This file guards the one thing those tests cannot see: that the page does not reintroduce a
// filter of its own around them.
//
//   npx tsx --test app/\(public\)/inventory/__tests__/catalogue-no-filter.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PAGE = join(process.cwd(), "app", "(public)", "inventory", "page.tsx");
const SEARCH = join(process.cwd(), "components", "public", "InventorySearchClient.tsx");

/** Comments explain WHY the filter is gone; matching them would flag the explanation. */
const strip = (p: string) =>
  readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*"))
    .join("\n");

const PAGE_SRC = strip(PAGE);
const SEARCH_SRC = strip(SEARCH);

test("no bounding box is pushed into the catalogue WHERE", () => {
  assert.doesNotMatch(PAGE_SRC, /where\.latitude/);
  assert.doesNotMatch(PAGE_SRC, /where\.longitude/);
  assert.doesNotMatch(PAGE_SRC, /boundingBox/);
});

test("no in-memory distance filter survives", () => {
  assert.doesNotMatch(PAGE_SRC, /\.filter\([^)]*distanceMiles/);
  assert.doesNotMatch(PAGE_SRC, /distanceMiles\s*<=\s*radius/);
});

test("radiusMiles is gone from the catalogue contract entirely", () => {
  assert.doesNotMatch(PAGE_SRC, /radiusMiles/,
    "the server ignores it, so accepting it would advertise a narrowing that does not happen");
});

test("the search UI no longer offers a radius control", () => {
  assert.doesNotMatch(SEARCH_SRC, /RADIUS_OPTIONS/);
  assert.doesNotMatch(SEARCH_SRC, /filter-radius/);
  assert.doesNotMatch(SEARCH_SRC, /setRadiusMiles/);
});

test("the ZIP input survives — it is what powers distance and the gate", () => {
  assert.match(SEARCH_SRC, /setZip/);
});

test("the page routes its rows through the shared gate rather than its own logic", () => {
  assert.match(PAGE_SRC, /gateCatalogue/);
  assert.match(PAGE_SRC, /inRadiusCount/);
});

test("both the ZIP prompt and the zero-in-radius lead are rendered", () => {
  assert.match(PAGE_SRC, /data-testid="zip-prompt"/);
  assert.match(PAGE_SRC, /data-testid="no-vehicles-in-radius"/);
});

test("no listing-level 'Verified' claim remains on the catalogue", () => {
  assert.doesNotMatch(PAGE_SRC, /label: "Verified"/);
  assert.doesNotMatch(PAGE_SRC, /Verified sellers/);
});
