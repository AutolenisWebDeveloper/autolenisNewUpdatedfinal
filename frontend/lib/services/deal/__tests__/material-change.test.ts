// §10a — the material-change classifier, proved rule by rule.
//
// Run with:  npx tsx --test lib/services/deal/__tests__/material-change.test.ts
//
// THE CLASSIFIER IS PURE, so this suite needs no database, no fixtures and no server — which is
// why the seven rules are pinned HERE rather than only through the route that calls them. §10a is
// the business rule this phase exists to enforce, and a rule that can only be exercised through a
// route is a rule that gets tested on the happy path.
//
// EVERY TEST NAMES THE CLAUSE IT PROVES, and the ordering cases (REFUSE before AUTO_APPLY before
// DECIDE) are the ones most likely to break under a later edit, because each looks locally
// reasonable on its own.

import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyMaterialChange,
  ODOMETER_TOLERANCE_MILES,
  DELIVERY_TOLERANCE_DAYS,
  type ReaffirmationSnapshot,
} from "../material-change";

const BASE: ReaffirmationSnapshot = {
  otdCents: 4_120_000,
  vin: "1HGCM82633A004352",
  odometer: 31_000,
  aprRate: 6.9,
  termMonths: 60,
  monthlyPaymentCents: 78_000,
  deliveryDate: new Date("2026-10-01T00:00:00.000Z"),
  vehicleYear: 2022,
  vehicleTrim: "EX-L",
  vehicleCondition: "USED",
  drivetrain: "AWD",
  feeItems: [{ label: "Doc fee", amountCents: 29_900 }],
  addOnItems: [],
  requiredFeatures: ["Apple CarPlay", "Heated seats"],
};

const CEILING = 4_300_000;

function proposed(overrides: Partial<ReaffirmationSnapshot>): ReaffirmationSnapshot {
  return { ...BASE, ...overrides };
}

test("no change at all → NONE", () => {
  const r = classifyMaterialChange(BASE, proposed({}), CEILING);
  assert.equal(r.outcome, "NONE");
  assert.deepEqual(r.differences, []);
});

test("§10a rule 1 — a different VIN is a different vehicle", () => {
  const r = classifyMaterialChange(BASE, proposed({ vin: "2HGCM82633A004353" }), CEILING);
  assert.equal(r.outcome, "DECIDE");
  const vin = r.differences.find((d) => d.field === "vin");
  assert.ok(vin, "the VIN difference must be reported");
  assert.equal(vin!.severity, "IDENTITY");
});

test("§10a rule 2 — an out-the-door INCREASE is the buyer's decision", () => {
  const r = classifyMaterialChange(BASE, proposed({ otdCents: 4_260_000 }), CEILING);
  assert.equal(r.outcome, "DECIDE");
  assert.match(r.differences[0]!.consequence, /\$1,400 more/);
});

test("§10a — a LOWER out-the-door with everything else unchanged applies automatically", () => {
  const r = classifyMaterialChange(BASE, proposed({ otdCents: 4_080_000 }), CEILING);
  assert.equal(r.outcome, "AUTO_APPLY");
  if (r.outcome !== "AUTO_APPLY") return;
  assert.equal(r.newOtdCents, 4_080_000);
  assert.equal(r.savingCents, 40_000);
});

test("§10a — a lower out-the-door beside ANY other change is NOT automatic", () => {
  // "with everything else unchanged" is load-bearing: a $400 discount arriving beside a different
  // VIN is a different car at a lower price, and that is the buyer's call.
  const r = classifyMaterialChange(
    BASE,
    proposed({ otdCents: 4_080_000, vin: "2HGCM82633A004353" }),
    CEILING,
  );
  assert.equal(r.outcome, "DECIDE");
});

test("§10a — above the approved ceiling is REFUSED, never offered as a choice", () => {
  const r = classifyMaterialChange(BASE, proposed({ otdCents: 4_400_000 }), CEILING);
  assert.equal(r.outcome, "REFUSE");
  if (r.outcome !== "REFUSE") return;
  assert.equal(r.ceilingCents, CEILING);
  assert.equal(r.proposedOtdCents, 4_400_000);
});

test("REFUSE outranks AUTO_APPLY — an above-ceiling proposal is refused even when something fell", () => {
  // Ordering regression. Both branches look locally correct; only the order makes the ceiling bind.
  const r = classifyMaterialChange(
    { ...BASE, otdCents: 4_500_000 },
    proposed({ otdCents: 4_400_000 }),
    CEILING,
  );
  assert.equal(r.outcome, "REFUSE");
});

test("no ceiling on the approval → falls through to DECIDE, never waved past", () => {
  const r = classifyMaterialChange(BASE, proposed({ otdCents: 9_900_000 }), null);
  assert.equal(r.outcome, "DECIDE");
});

test("§10a rule 3 — a NEW fee is material; a REMOVED fee is not", () => {
  const added = classifyMaterialChange(
    BASE,
    proposed({ feeItems: [...BASE.feeItems, { label: "Reconditioning", amountCents: 89_500 }] }),
    CEILING,
  );
  assert.equal(added.outcome, "DECIDE");
  assert.ok(added.differences.some((d) => d.label.includes("Reconditioning")));

  const removed = classifyMaterialChange(BASE, proposed({ feeItems: [] }), CEILING);
  assert.equal(removed.outcome, "NONE", "a dealership dropping a charge needs no permission");
});

test("an INCREASED existing fee is a new charge by another name", () => {
  const r = classifyMaterialChange(
    BASE,
    proposed({ feeItems: [{ label: "Doc fee", amountCents: 79_900 }] }),
    CEILING,
  );
  assert.equal(r.outcome, "DECIDE");
  assert.match(r.differences[0]!.consequence, /\$500 higher/);
});

test("fee labels are matched case- and whitespace-insensitively", () => {
  const r = classifyMaterialChange(
    BASE,
    proposed({ feeItems: [{ label: "  DOC   FEE ", amountCents: 29_900 }] }),
    CEILING,
  );
  assert.equal(r.outcome, "NONE", '"Doc fee" and "  DOC   FEE " are one item');
});

test("§10a rule 3 — a new ADD-ON is material and reads as an optional product", () => {
  const r = classifyMaterialChange(
    BASE,
    proposed({ addOnItems: [{ label: "GAP protection", amountCents: 99_500 }] }),
    CEILING,
  );
  assert.equal(r.outcome, "DECIDE");
  assert.match(r.differences[0]!.label, /optional product/i);
});

test("§10a rule 4 — APR, term and payment changes are each material", () => {
  for (const [field, patch] of [
    ["aprRate", { aprRate: 8.9 }],
    ["termMonths", { termMonths: 72 }],
    ["monthlyPaymentCents", { monthlyPaymentCents: 82_000 }],
  ] as const) {
    const r = classifyMaterialChange(BASE, proposed(patch), CEILING);
    assert.equal(r.outcome, "DECIDE", `${field} must be material`);
    assert.equal(r.differences[0]!.field, field);
  }
});

test("§10a rule 5 — the 500-mile odometer tolerance binds in both directions", () => {
  const within = classifyMaterialChange(
    BASE,
    proposed({ odometer: BASE.odometer! + ODOMETER_TOLERANCE_MILES }),
    CEILING,
  );
  assert.equal(within.outcome, "NONE", "exactly 500 more is within tolerance");

  const over = classifyMaterialChange(
    BASE,
    proposed({ odometer: BASE.odometer! + ODOMETER_TOLERANCE_MILES + 1 }),
    CEILING,
  );
  assert.equal(over.outcome, "DECIDE", "501 more is not");

  const lower = classifyMaterialChange(BASE, proposed({ odometer: 10_000 }), CEILING);
  assert.equal(lower.outcome, "NONE", "a LOWER reading corrects in the buyer's favour");
});

test("§10a rule 6 — the seven-day delivery tolerance binds, and only later counts", () => {
  const day = 24 * 60 * 60 * 1000;
  const within = classifyMaterialChange(
    BASE,
    proposed({ deliveryDate: new Date(BASE.deliveryDate!.getTime() + DELIVERY_TOLERANCE_DAYS * day) }),
    CEILING,
  );
  assert.equal(within.outcome, "NONE");

  const over = classifyMaterialChange(
    BASE,
    proposed({ deliveryDate: new Date(BASE.deliveryDate!.getTime() + (DELIVERY_TOLERANCE_DAYS + 1) * day) }),
    CEILING,
  );
  assert.equal(over.outcome, "DECIDE");

  const earlier = classifyMaterialChange(
    BASE,
    proposed({ deliveryDate: new Date(BASE.deliveryDate!.getTime() - 30 * day) }),
    CEILING,
  );
  assert.equal(earlier.outcome, "NONE", "earlier delivery is not a change the buyer must approve");
});

test("§10a rule 7 — losing a required feature is material", () => {
  const r = classifyMaterialChange(
    BASE,
    proposed({ requiredFeatures: ["Apple CarPlay"] }),
    CEILING,
  );
  assert.equal(r.outcome, "DECIDE");
  assert.match(r.differences[0]!.label, /Heated seats/);
});

test("§10a rule 7 — year, trim, condition and drivetrain changes are each material", () => {
  for (const patch of [
    { vehicleYear: 2021 },
    { vehicleTrim: "LX" },
    { vehicleCondition: "CERTIFIED" },
    { drivetrain: "FWD" },
  ]) {
    const r = classifyMaterialChange(BASE, proposed(patch), CEILING);
    assert.equal(r.outcome, "DECIDE", `${JSON.stringify(patch)} must be material`);
  }
});

test("every difference carries a severity, a consequence and both sides — the screen needs all three", () => {
  const r = classifyMaterialChange(
    BASE,
    proposed({ vin: "2HGCM82633A004353", otdCents: 4_200_000, termMonths: 72 }),
    CEILING,
  );
  assert.equal(r.outcome, "DECIDE");
  assert.ok(r.differences.length >= 3);
  for (const d of r.differences) {
    assert.ok(d.field.length > 0, "a stable key is the React key and the test handle");
    assert.ok(d.label.length > 0);
    assert.ok(d.confirmed.length > 0, "the left column must never be blank");
    assert.ok(d.proposed.length > 0, "the right column must never be blank");
    assert.ok(d.consequence.length > 10, "the consequence is a sentence, not a delta");
    assert.ok(["IDENTITY", "MONEY", "TERMS", "TIMING", "SPECIFICATION"].includes(d.severity));
  }
});

test("a null on either side is not a change — an unknown value must not read as a difference", () => {
  // The dealership may leave a field it was never asked for. Treating absent as changed would fill
  // the comparison with rows the buyer cannot act on, which is how a real change gets skimmed past.
  const r = classifyMaterialChange(
    BASE,
    proposed({ aprRate: null, termMonths: null, monthlyPaymentCents: null, deliveryDate: null, drivetrain: null }),
    CEILING,
  );
  assert.equal(r.outcome, "NONE");
});
