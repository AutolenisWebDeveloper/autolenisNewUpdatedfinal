// §Stage 11 — the recap row's id IS its identity, and that is the concurrency control.
//
// Run with:  npx tsx --test lib/services/deal/__tests__/deal-recap-identity.test.ts
//
// WHY THIS SUITE EXISTS. `buildRecap` used `randomUUID()` and guarded version 1 with a read of the
// current max — a check-then-act with nothing between the two reads, under Read Committed, on a
// table with no unique on `(deal_id, version)`. Two concurrent arrivals (the RECAP_PENDING arrival
// hook and the buyer's GET repair path — two page loads is enough) could each insert a version 1.
// `currentRecap` then returns one of them arbitrarily, so the buyer can confirm one row while the
// dealership confirms the other and NEITHER reaches both-confirmed: a deal wedged at RECAP_PENDING
// with two complete recaps and no way to tell which is real.
//
// The fix derives the primary key from `(deal_id, version)`, so the key the database already
// enforces becomes the guard and the loser of the race collides instead of forking. That property
// is invisible at the call site — someone reintroducing `randomUUID()` would see every test pass —
// so it is asserted here directly.
//
// This is a PURE test: `recapId` takes no client and touches no database. The P2002 branches it
// makes reachable are exercised against a real Postgres in the Playwright journeys.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { recapId } from "../deal-recap.service";

const DEAL_A = "3f1b0c62-0f2a-4a8f-9a1e-2b6c4d8e0a11";
const DEAL_B = "9c2d1e73-1a3b-4b9f-8c2d-3e7f5a9b1c22";

test("the same (deal, version) always produces the same id — that is what makes the PK the guard", () => {
  assert.equal(recapId(DEAL_A, 1), recapId(DEAL_A, 1));
  assert.equal(recapId(DEAL_A, 7), recapId(DEAL_A, 7));
});

test("a different version produces a different id — versions are rows, not overwrites", () => {
  const ids = new Set([1, 2, 3, 4, 5].map((v) => recapId(DEAL_A, v)));
  assert.equal(ids.size, 5, "two versions of one deal collided — a dispute would overwrite the recap it supersedes");
});

test("a different deal produces a different id — one deal's recap can never land on another's", () => {
  assert.notEqual(recapId(DEAL_A, 1), recapId(DEAL_B, 1));
});

test("the id keeps the UUID shape the schema uses everywhere else", () => {
  // `deal_recaps.id` is a text column, but every other id in this schema reads as a UUID, and a
  // row whose id does not is a row an operator has to think about.
  assert.match(recapId(DEAL_A, 1), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test("the writer does not mint a random id — the regression this suite guards", () => {
  // The property above is necessary but not sufficient: a writer could compute `recapId` and then
  // ignore it. This asserts the call site, because that is the line that was wrong.
  const src = readFileSync(`${process.cwd()}/lib/services/deal/deal-recap.service.ts`, "utf8");
  assert.equal(
    /randomUUID/.test(src),
    false,
    "a random id puts the (deal, version) uniqueness back in the application, where two concurrent " +
      "callers both win. Derive it from the row's identity with `recapId`.",
  );
  assert.match(src, /id: recapId\(params\.dealId, 1\)|const id = recapId\(params\.dealId, 1\)/);
  assert.match(src, /recapId\(params\.dealId, row\.version \+ 1\)/);
  // Both insert sites must treat a collision as the expected outcome of a race, not as a 500.
  assert.equal((src.match(/P2002/g) ?? []).length >= 2, true, "both recap insert paths must handle P2002");
});
