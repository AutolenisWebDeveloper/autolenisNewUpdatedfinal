// §30's responsibility registry — every stage resolves exactly one owner.
//
// Run: pnpm test:operations

import test from "node:test";
import assert from "node:assert/strict";
import {
  STAGE_RESPONSIBILITY,
  responsibilityForStage,
  ownerRoleForStage,
  buyerDutyForStage,
} from "../stage-responsibility";

test("every spec stage 1-21 resolves exactly one responsibility row", () => {
  for (let stage = 1; stage <= 21; stage++) {
    const row = responsibilityForStage(stage);
    assert.ok(row, `stage ${stage} has no §30 row`);
    assert.ok(row!.stages.includes(stage));
  }
  // And no row claims a stage outside the range.
  for (const row of STAGE_RESPONSIBILITY) {
    for (const s of row.stages) assert.ok(s >= 1 && s <= 21, `row "${row.label}" claims stage ${s}`);
  }
});

test("every stage resolves exactly one owner_role", () => {
  for (let stage = 1; stage <= 21; stage++) {
    assert.ok(ownerRoleForStage(stage), `stage ${stage} has no owner`);
  }
});

test("stages 1-2 duties match §30 row 1 verbatim", () => {
  const row = responsibilityForStage(1)!;
  assert.equal(row.buyer, "Register, verify, provide address");
  assert.equal(row.dealership, null, "§30's dash is an explicit null, not an empty string");
  assert.equal(row.staff, "Correct geocoding failures");
  assert.equal(row.system, "Verify, geocode, dedupe");
  assert.equal(responsibilityForStage(2), row, "§30 groups stages 1 and 2 in one row");
});

test("stage 3 duties match §30 row 2 verbatim", () => {
  const row = responsibilityForStage(3)!;
  assert.equal(row.buyer, "Apply, consent");
  assert.equal(row.dealership, null);
  assert.equal(row.staff, "Manual and OFAC review, adverse action");
  assert.equal(row.system, "Pull, screen, decide, notify");
  assert.equal(row.ownerRole, "COMPLIANCE");
});

test("a dash in §30 is null, never an empty string", () => {
  for (const row of STAGE_RESPONSIBILITY) {
    for (const [col, v] of Object.entries({ buyer: row.buyer, dealership: row.dealership, staff: row.staff, system: row.system })) {
      assert.ok(v === null || v.trim().length > 0, `${row.label}.${col} is an empty string — use null for §30's dash`);
    }
  }
});

test("the §26 catalogue's owners agree with §30 where both name a stage", async () => {
  const { EXCEPTION_CATALOGUE } = await import("@/lib/services/operations/exception-catalogue");
  // Two hand-maintained lists that must agree. Rather than trusting them to, check
  // the overlap: the Stage 1-3 exceptions Phase 2 raises must carry the owner §30
  // assigns to their stage.
  const expected: Record<string, string> = {
    BUYER_UNVERIFIED: ownerRoleForStage(1)!,
    LOCATION_UNUSABLE: ownerRoleForStage(2)!,
    PREQUAL_MANUAL_OR_OFAC_REVIEW: ownerRoleForStage(3)!,
    PREQUAL_DECLINE: ownerRoleForStage(3)!,
  };
  for (const [code, owner] of Object.entries(expected)) {
    const def = EXCEPTION_CATALOGUE.find((d) => d.code === code);
    assert.ok(def, `${code} is not catalogued`);
    if (code === "BUYER_UNVERIFIED") {
      // §26 assigns this one to System explicitly ("Buyer does not verify account
      // — System"), which is narrower than §30's stage owner. §26 governs the
      // exception; §30 governs the stage. Recorded rather than forced to agree.
      assert.equal(def!.ownerRole, "SYSTEM");
      continue;
    }
    assert.equal(def!.ownerRole, owner, `${code}: §26 says ${def!.ownerRole}, §30 stage owner is ${owner}`);
  }
});

test("buyer duty text is available for the Stage 1-2 surface", () => {
  assert.equal(buyerDutyForStage(1), "Register, verify, provide address");
  assert.equal(buyerDutyForStage(8), null, "§30 gives the buyer no duty at Stage 8");
  assert.equal(buyerDutyForStage(99), undefined, "a stage outside 1-21 is undefined, not null");
});
