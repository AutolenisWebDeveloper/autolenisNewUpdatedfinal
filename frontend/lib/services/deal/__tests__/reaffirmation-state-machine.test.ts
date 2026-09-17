// §Stage 10 / §Stage 11 — the Deal transitions this phase owns.
//
// Run with:  npx tsx --test lib/services/deal/__tests__/reaffirmation-state-machine.test.ts
//
// THE REGRESSION THIS SUITE EXISTS FOR is the one found at the start of Phase 7: Phase 6 added
// `DEALER_CONFIRMATION → FINANCING_PENDING` with no domain caller and recorded it deliberately,
// but the edge was reachable from `POST /api/admin/deals/[dealId]/action`
// (`DEAL_STAGE_ADVANCED`) NON-FORCED, and two admin dropdowns offered it as the next stage. An
// operations admin could therefore move a deal past reaffirmation, the vehicle hold and the
// condition disclosure with an ordinary, legal transition — the gate this phase exists to build,
// skippable by the surface most likely to skip it.
//
// The first test below is the one that fails if anyone restores that edge.

import test from "node:test";
import assert from "node:assert/strict";
import { canTransition } from "../deal.service";
import { DealStatus } from "@prisma/client";

test("§Stage 10 → §Stage 11: DEALER_CONFIRMATION reaches RECAP_PENDING and nothing else forward", () => {
  assert.equal(canTransition("DEALER_CONFIRMATION", "RECAP_PENDING"), true);

  // THE REGRESSION GUARD. Restoring the direct edge makes the reaffirmation gate decorative.
  assert.equal(
    canTransition("DEALER_CONFIRMATION", "FINANCING_PENDING"),
    false,
    "§Stage 10's exit is the recap. A direct edge to financing lets an admin skip reaffirmation, " +
      "the vehicle hold and the condition disclosure with a NON-FORCED transition.",
  );

  for (const to of [
    "FEE_PENDING",
    "CONTRACT_PENDING",
    "SIGNING_PENDING",
    "SIGNED",
    "COMPLETED",
  ] as DealStatus[]) {
    assert.equal(canTransition("DEALER_CONFIRMATION", to), false, `DEALER_CONFIRMATION → ${to} must be illegal`);
  }
});

test("§Stage 11 → §Stage 12: RECAP_PENDING reaches FINANCING_PENDING and nothing else forward", () => {
  assert.equal(canTransition("RECAP_PENDING", "FINANCING_PENDING"), true);
  for (const to of ["FEE_PENDING", "CONTRACT_PENDING", "SIGNED", "COMPLETED"] as DealStatus[]) {
    assert.equal(canTransition("RECAP_PENDING", to), false, `RECAP_PENDING → ${to} must be illegal`);
  }
});

test("the legacy entry to FINANCING_PENDING survives — reverting Phase 7 strands no in-flight deal", () => {
  // `ACTIVE → FINANCING_PENDING` is how deals created before Phase 6 entered the stage. Phase 7
  // narrows the NEW entry; it must not remove the old one, or a revert would leave those deals
  // behind an edge that vanished.
  assert.equal(canTransition("ACTIVE", "FINANCING_PENDING"), true);
});

test("neither new stage is a dead end — both have a forward edge", () => {
  // Six of the seven Phase 1 spine states are deliberately fail-closed (empty exit lists) until
  // the phase that owns them wires the caller. Phase 7 owns these two, so an empty list here would
  // mean a deal stuck by construction — the defect §13-D41 was ruled to avoid.
  for (const from of ["DEALER_CONFIRMATION", "RECAP_PENDING"] as DealStatus[]) {
    const reachable = (
      [
        "RECAP_PENDING",
        "FINANCING_PENDING",
        "FEE_PENDING",
        "CONTRACT_PENDING",
      ] as DealStatus[]
    ).filter((to) => canTransition(from, to));
    assert.ok(reachable.length > 0, `${from} has no forward edge — a deal arriving there is stuck`);
  }
});

test("both new stages remain cancellable — §Stage 10's failure path needs it", () => {
  // Every return-to-offers cause stands the deal down, and `returnToRemainingOffers` writes
  // CANCELLED. If that became illegal from either stage, five failure paths would throw instead.
  for (const from of ["DEALER_CONFIRMATION", "RECAP_PENDING"] as DealStatus[]) {
    assert.equal(canTransition(from, "CANCELLED"), true, `${from} → CANCELLED must stay legal`);
  }
});

test("Phase 7 still opened no edge it does not own — now read against Phase 9's ladder", () => {
  // A scope check as much as a behaviour one. PHASE 9 GAVE THREE OF THESE STATES THEIR EXITS, so
  // the assertion is no longer "these have no forward exit" — that sentence was true only while
  // Phase 9 was unbuilt, and leaving it would have made this test fail for the right reason and
  // be "fixed" by deleting it. What it still checks is the part that was never Phase 7's or
  // Phase 9's to open: none of these states may jump BACKWARD into the contract/financing
  // gauntlet, and none may reach COMPLETED except through handover.
  for (const from of [
    "DEALER_EXECUTED",
    "FUNDING_PENDING",
    "PICKUP_READINESS",
    "HANDOVER_PENDING",
    "FROZEN_PENDING_RELEASE",
  ] as DealStatus[]) {
    for (const to of ["FINANCING_PENDING", "CONTRACT_PENDING", "SIGNED"] as DealStatus[]) {
      assert.equal(canTransition(from, to), false, `${from} → ${to} is not Phase 7's to open`);
    }
  }
  // COMPLETED, specifically: reachable from HANDOVER_PENDING (Phase 9's own edge) and from
  // nowhere else in this set.
  for (const from of ["DEALER_EXECUTED", "FUNDING_PENDING", "PICKUP_READINESS", "FROZEN_PENDING_RELEASE"] as DealStatus[]) {
    assert.equal(canTransition(from, "COMPLETED"), false, `${from} → COMPLETED must go through handover`);
  }
  assert.equal(canTransition("HANDOVER_PENDING", "COMPLETED"), true, "and handover IS the way through");
});
