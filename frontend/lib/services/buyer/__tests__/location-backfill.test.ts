// Decision logic for the buyer-location backfill
// (docs/plans/BUYER-LOCATION-BACKFILL.md).
//
// The backfill sources ZIPs from `buyer_opportunities.zip`, joined to buyers via
// `vehicle_requests.buyer_opportunity_id`. That source is corroborated: where a
// buyer also carries its own ZIP the two agree, 3 of 3 in production. This
// module is where that corroboration is enforced rather than assumed — a
// disagreement, or two opportunities disagreeing with each other, is a human
// question, not something a script should pick a winner for.
//
// Pure: no database, no I/O. The script is a thin CLI over it.
//
// Run: pnpm test:buyer-location-backfill

import test from "node:test";
import assert from "node:assert/strict";
import { decideBackfill, type BuyerRow } from "../location-backfill";

const EMPTY: BuyerRow = { id: "b1", city: null, state: null, zip: null };

test("fills from a single corroborating opportunity ZIP", () => {
  const d = decideBackfill(EMPTY, ["75035"]);
  assert.equal(d.action, "FILL");
  assert.equal(d.zip, "75035");
});

test("ignores blank and null opportunity ZIPs", () => {
  const d = decideBackfill(EMPTY, [null, "  ", "75034", undefined]);
  assert.equal(d.action, "FILL");
  assert.equal(d.zip, "75034");
});

test("several opportunities agreeing is still a fill", () => {
  const d = decideBackfill(EMPTY, ["75035", "75035", "75035"]);
  assert.equal(d.action, "FILL");
  assert.equal(d.zip, "75035");
});

test("no opportunity ZIP anywhere is NO_SOURCE — these need customer contact", () => {
  // 6 of the 10 affected buyers land here. A script must not invent a location
  // for them; the plan routes them to customer contact.
  assert.equal(decideBackfill(EMPTY, []).action, "NO_SOURCE");
  assert.equal(decideBackfill(EMPTY, [null, ""]).action, "NO_SOURCE");
});

test("two opportunities disagreeing is a CONFLICT, never a guess", () => {
  const d = decideBackfill(EMPTY, ["75035", "75034"]);
  assert.equal(d.action, "CONFLICT");
  assert.match(d.reason, /disagree/i);
});

test("an opportunity ZIP contradicting the buyer's own ZIP is a CONFLICT", () => {
  // This is the corroboration check. If it ever fires, the premise that the two
  // sources agree has broken and the backfill must stop for that row.
  const buyer: BuyerRow = { id: "b1", city: null, state: null, zip: "75024" };
  const d = decideBackfill(buyer, ["75035"]);
  assert.equal(d.action, "CONFLICT");
  assert.match(d.reason, /corroborat/i);
});

test("an opportunity ZIP matching the buyer's own ZIP corroborates rather than conflicts", () => {
  // The buyer keeps its ZIP; there is nothing to write, because ZIP is the only
  // field this backfill sources.
  const buyer: BuyerRow = { id: "b1", city: null, state: null, zip: "75035" };
  const d = decideBackfill(buyer, ["75035"]);
  assert.equal(d.action, "ALREADY_SET");
});

test("ZIP comparison is whitespace- and ZIP+4-tolerant", () => {
  const buyer: BuyerRow = { id: "b1", city: null, state: null, zip: " 75035-1234 " };
  assert.equal(decideBackfill(buyer, ["75035"]).action, "ALREADY_SET");
});

test("a buyer that already has a ZIP and no source is left alone", () => {
  const buyer: BuyerRow = { id: "b1", city: null, state: null, zip: "75035" };
  assert.equal(decideBackfill(buyer, []).action, "ALREADY_SET");
});

test("the decision never returns city or state — this source only carries ZIP", () => {
  // buyer_opportunities has no city/state column. Claiming to fill them would be
  // fabricating; the plan covers city/state separately.
  const d = decideBackfill(EMPTY, ["75035"]);
  assert.ok(!("city" in d), "must not invent a city");
  assert.ok(!("state" in d), "must not invent a state");
});

test("every decision carries a human-readable reason", () => {
  for (const zips of [["75035"], [], ["75035", "75034"]]) {
    assert.ok(decideBackfill(EMPTY, zips).reason.length > 0);
  }
});
