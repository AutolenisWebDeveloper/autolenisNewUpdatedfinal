// Phase 7's post-merge review — the five boundaries that were missing, outside the firewall and
// the recap arithmetic (which have their own files).
//
// Run with:  npx tsx --test lib/services/deal/__tests__/phase7-review-boundaries.test.ts
//
//   §10c   `releaseVehicleHold` checked OWNERSHIP and not LIFECYCLE, so the dealership that owns
//          a deal at SIGNING_PENDING could still "release its hold" and cancel it. The predicate
//          for what the hold protects already existed — `sweepExpiringHolds`' PRE_CONTRACT list —
//          and was defined inside that one function where nothing else could reach it.
//
//   §11    `disputeRecap` required no deal state. A dispute raised after both parties confirmed
//          and the deal advanced still superseded the recap and NULLED
//          `recap_confirmed_by_buyer_at` / `..._dealer_at` on the Deal — erasing the confirmation
//          record of a stage already passed, from a deal now at FINANCING_PENDING or beyond.
//
//   §Stage 10  `returnToRemainingOffers` wrote `actorRole: actorId === "system" ? "SYSTEM" :
//          "DEALER"` — so a BUYER rejecting a material change (the one decision §10a gives them
//          unconditionally) was recorded in `deal_status_history` as the DEALERSHIP cancelling.
//          The stand-down is correct and its audit row names the wrong party.
//
//   §28.3  the same function cancelled the deal with an unconditional `update`, from a status read
//          before the transaction opened. Two callers — the 24-hour sweep and a dealer release in
//          the same second — both cancelled, both wrote a history row, and the second recorded a
//          `fromStatus` it had read before the first one moved it.

import test from "node:test";
import assert from "node:assert/strict";
import { DealStatus } from "@prisma/client";
import { readFileSync } from "node:fs";
import { PRE_CONTRACT_HOLD_STATUSES } from "../dealer-reaffirmation.service";
import { standDownActorRole } from "../return-to-offers.service";
import { RECAP_MUTABLE_DEAL_STATUSES, assertRecapMutable, RecapError } from "../deal-recap.service";

const ROOT = process.cwd();
function src(rel: string): string {
  return readFileSync(`${ROOT}/${rel}`, "utf8")
    .split("\n")
    .map((line) => (line.trimStart().startsWith("//") ? "" : line))
    .join("\n");
}
function body(text: string, name: string): string {
  const start = text.indexOf(`export async function ${name}(`);
  assert.ok(start > 0, `${name} must exist`);
  const next = text.indexOf("\nexport ", start + 10);
  return text.slice(start, next > 0 ? next : text.length);
}

// ─────────────────────────────────────────────────────────────────────────────
// §10c — the hold's lifecycle
// ─────────────────────────────────────────────────────────────────────────────

test("the pre-contract window is one shared list, not a copy per call site", () => {
  assert.deepEqual(
    [...PRE_CONTRACT_HOLD_STATUSES].sort(),
    ["DEALER_CONFIRMATION", "FEE_PAID", "FEE_PENDING", "FINANCING_PENDING", "INSURANCE_PENDING", "RECAP_PENDING"],
    "the same six `sweepExpiringHolds` already used — a second list is two rules that drift",
  );
});

test("nothing at or past the contract is in the hold window", () => {
  for (const status of [
    DealStatus.CONTRACT_PENDING,
    DealStatus.CONTRACT_REVIEW,
    DealStatus.SIGNING_PENDING,
    DealStatus.SIGNED,
    DealStatus.PICKUP_SCHEDULED,
    DealStatus.COMPLETED,
    DealStatus.CANCELLED,
  ]) {
    assert.equal(
      PRE_CONTRACT_HOLD_STATUSES.includes(status),
      false,
      `${status} has passed the point the hold exists to protect`,
    );
  }
});

test("releaseVehicleHold consults the window before standing the deal down", () => {
  const fn = body(src("lib/services/deal/dealer-reaffirmation.service.ts"), "releaseVehicleHold");
  assert.match(fn, /PRE_CONTRACT_HOLD_STATUSES/, "ownership alone let an owner cancel a signed deal");
  assert.match(fn, /HOLD_NOT_RELEASABLE/, "and the refusal must be named, not a silent no-op");
  const gate = fn.indexOf("PRE_CONTRACT_HOLD_STATUSES");
  const act = fn.indexOf("returnToRemainingOffers");
  assert.ok(gate > 0 && act > gate, "a check after the deal is cancelled is not a check");
  // AND IT COMES SECOND. Its message names the deal's status, and the route maps FORBIDDEN to 404
  // so a dealership cannot learn that a deal exists but is not theirs. Ordered first, the fix for
  // one disclosure would have opened another.
  assert.ok(
    fn.indexOf("belongs to another dealership") < gate,
    "ownership is decided before anything that tells the caller about the deal",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// §11 — the recap stage
// ─────────────────────────────────────────────────────────────────────────────

test("the recap is mutable only while the deal is at RECAP_PENDING", () => {
  assert.deepEqual([...RECAP_MUTABLE_DEAL_STATUSES], ["RECAP_PENDING"]);
  assert.doesNotThrow(() => assertRecapMutable(DealStatus.RECAP_PENDING));
});

test("a dispute cannot reach back into a deal that has left the stage", () => {
  for (const status of [
    DealStatus.FINANCING_PENDING,
    DealStatus.FEE_PAID,
    DealStatus.CONTRACT_PENDING,
    DealStatus.SIGNED,
    DealStatus.CANCELLED,
  ]) {
    assert.throws(
      () => assertRecapMutable(status),
      (err: unknown) => err instanceof RecapError && err.code === "RECAP_STAGE_CLOSED",
      `${status} must refuse — a dispute here nulls confirmations the deal has already acted on`,
    );
  }
});

test("all three recap mutators carry the boundary; reading it stays open", () => {
  const text = src("lib/services/deal/deal-recap.service.ts");
  for (const name of ["decideOptionalProduct", "confirmRecap", "disputeRecap"]) {
    assert.match(body(text, name), /assertRecapMutable\(/, `${name} writes to the recap`);
  }
  assert.equal(
    /assertRecapMutable\(/.test(body(text, "currentRecap")),
    false,
    "reading a past recap must stay possible — gating the read would remove a capability",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// §Stage 10 — who cancelled, and under what compare-and-swap
// ─────────────────────────────────────────────────────────────────────────────

test("a buyer rejecting a material change is recorded as the BUYER", () => {
  assert.equal(
    standDownActorRole({ cause: "MATERIAL_CHANGE_REJECTED", actorId: "buyer-42" }),
    "BUYER",
    "§10a gives the buyer this decision; the history row said DEALER",
  );
});

test("the sweep is recorded as SYSTEM whatever the cause", () => {
  for (const cause of ["MATERIAL_CHANGE_REJECTED", "DEALER_TIMED_OUT", "HOLD_RELEASED"] as const) {
    assert.equal(standDownActorRole({ cause, actorId: "system" }), "SYSTEM");
  }
});

test("a dealership's own failure is still recorded against the dealership", () => {
  for (const cause of ["DEALER_REJECTED", "DEALER_TIMED_OUT", "VEHICLE_UNAVAILABLE", "HOLD_RELEASED"] as const) {
    assert.equal(standDownActorRole({ cause, actorId: "dealer-user-3" }), "DEALER");
  }
});

test("an explicit role from a caller that knows wins over the derivation", () => {
  assert.equal(
    standDownActorRole({ cause: "DEALER_REJECTED", actorId: "admin-1", actorRole: "ADMIN" }),
    "ADMIN",
    "an admin standing a deal down on a dealership's behalf is neither of them",
  );
});

test("the cancellation is compare-and-swapped on the status it read", () => {
  const fn = body(src("lib/services/deal/return-to-offers.service.ts"), "returnToRemainingOffers");
  assert.match(fn, /tx\.deal\.updateMany\(/, "an unconditional update cannot lose a race it should lose");
  assert.match(fn, /status: deal\.status/, "and it must pin the status the history row will claim it moved from");
  assert.match(fn, /STALE_STATUS|claimed\.count/, "a lost race must abort the transaction, not write half of it");
});

test("a deal already stood down is a no-op, not a second stand-down", () => {
  const fn = body(src("lib/services/deal/return-to-offers.service.ts"), "returnToRemainingOffers");
  const guard = fn.indexOf("ALREADY_STOOD_DOWN");
  const revoke = fn.indexOf("revokeIdentityFirewall");
  assert.ok(guard > 0, "the terminal states must be named");
  assert.ok(guard < revoke, "and checked BEFORE the firewall is revoked, or a duplicate call revokes a live release");
});

// ─────────────────────────────────────────────────────────────────────────────
// The buyer's financing scenario
// ─────────────────────────────────────────────────────────────────────────────

test("a financing scenario cannot be modelled against a dead deal", () => {
  const route = src("app/api/buyer/financing/route.ts");
  // NARROWED TO THE EXPLICIT BRANCH. Slicing as far as "No active deal" swallowed the FALLBACK
  // branch too, whose own `status:` filter satisfied the match on the unfixed code.
  const from = route.indexOf("const deal = parsed.data.dealId");
  assert.ok(from > 0, "the ternary is still there");
  const explicit = route.slice(from, route.indexOf("\n    : await", from));
  assert.match(
    explicit,
    /status:/,
    "the explicit-dealId branch was scoped by buyer alone while the fallback beside it filtered status",
  );
});
