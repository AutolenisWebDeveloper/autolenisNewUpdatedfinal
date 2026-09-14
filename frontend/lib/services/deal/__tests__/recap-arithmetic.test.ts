// §Stage 11 — the two computations a buyer is asked to agree to, and the two that were wrong.
//
// Run with:  npx tsx --test lib/services/deal/__tests__/recap-arithmetic.test.ts
//
// Both were found by an adversarial read of the diff rather than by a failing test, because
// neither was reachable without a database write. They are pure functions now for that reason:
// arithmetic a buyer signs off on should not need a Postgres to exercise.

import test from "node:test";
import assert from "node:assert/strict";
import { amountFinanced, estimateMonthlyPaymentCents, reconcileLines } from "../deal-recap.service";

// ─────────────────────────────────────────────────────────────────────────────
// Negative equity
// ─────────────────────────────────────────────────────────────────────────────

test("positive equity reduces the amount financed", () => {
  // OTD $40,000, down $2,000, trade worth $8,000 with a $3,000 payoff → $5,000 of real equity.
  assert.equal(
    amountFinanced({ otdCents: 4_000_000, downPaymentCents: 200_000, equityCents: 500_000, financingPath: "DEALER" }),
    3_300_000,
  );
});

test("NEGATIVE equity is added to the amount financed — the defect this file exists for", () => {
  // OTD $40,000, down $2,000, trade worth $8,000 against a $13,000 payoff → $5,000 UPSIDE DOWN.
  //
  // The old expression floored equity at zero and produced $38,000. The recap page simultaneously
  // told the buyer the shortfall "is being added to what you finance, so you will be borrowing
  // it" — so the screen said $38,000 and the sentence said otherwise, and the estimated payment
  // was computed from the smaller number.
  const financed = amountFinanced({
    otdCents: 4_000_000,
    downPaymentCents: 200_000,
    equityCents: -500_000,
    financingPath: "DEALER",
  });
  assert.equal(financed, 4_300_000, "the $5,000 shortfall must be IN the principal, not floored away");
  assert.notEqual(financed, 3_800_000, "3,800,000 is the old, floored answer");
});

test("the estimated payment moves with the shortfall — which is the harm", () => {
  const wrong = estimateMonthlyPaymentCents(3_800_000, 7, 60);
  const right = estimateMonthlyPaymentCents(4_300_000, 7, 60);
  assert.ok(wrong != null && right != null);
  assert.ok(right! > wrong!, "a larger principal must quote a larger payment");
  // Roughly $99/month on these figures. Asserted as a floor rather than an exact cent so the test
  // is about the magnitude of the misstatement, not about the amortisation constant.
  assert.ok(right! - wrong! > 8_000, `the understatement was ${(right! - wrong!) / 100} dollars a month`);
});

test("a cash deal finances nothing, whatever the trade did", () => {
  assert.equal(
    amountFinanced({ otdCents: 4_000_000, downPaymentCents: 0, equityCents: -500_000, financingPath: "CASH" }),
    0,
  );
});

test("the amount financed never goes below zero", () => {
  // A trade worth more than the whole deal is equity the buyer takes back, not a negative loan.
  assert.equal(
    amountFinanced({ otdCents: 2_000_000, downPaymentCents: 0, equityCents: 2_500_000, financingPath: "DEALER" }),
    0,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// §Stage 11's reconciliation — the itemisation has to add up to the total
// ─────────────────────────────────────────────────────────────────────────────

const LINES = [
  { key: "vehicle", label: "Vehicle price", amountCents: 3_800_000 },
  { key: "taxes", label: "Taxes", amountCents: 270_000 },
  { key: "docFee", label: "Documentation fee", amountCents: 50_000 },
];
const LINES_TOTAL = 4_120_000;

test("a table that already adds up is left exactly as it is", () => {
  const out = reconcileLines(LINES, LINES_TOTAL);
  assert.deepEqual(out, LINES, "no residual line may appear when there is no residual");
});

test("a fee the total does not contain shows as a dealer contribution", () => {
  // The dealership adds a $2,000 reconditioning fee and leaves the out-the-door price alone. The
  // buyer still pays the out-the-door price — so the dealership is absorbing it, and the table now
  // says so instead of listing $2,000 of charges under a total that is $2,000 smaller.
  const withFee = [...LINES, { key: "fee-0", label: "Reconditioning", amountCents: 200_000 }];
  const out = reconcileLines(withFee, LINES_TOTAL);
  assert.equal(out.length, withFee.length + 1);
  assert.equal(out.at(-1)!.label, "Dealer contribution");
  assert.equal(out.at(-1)!.amountCents, -200_000);
  assert.equal(out.reduce((s, l) => s + l.amountCents, 0), LINES_TOTAL, "the table must sum to the total");
});

test("a total above the enumerated components shows as other charges", () => {
  const out = reconcileLines(LINES, LINES_TOTAL + 150_000);
  assert.equal(out.at(-1)!.label, "Other charges included in the total");
  assert.equal(out.at(-1)!.amountCents, 150_000);
  assert.equal(out.reduce((s, l) => s + l.amountCents, 0), LINES_TOTAL + 150_000);
});

test("a price RISE with no line-item change still reconciles — it must not be refused", () => {
  // The defect an earlier fix introduced, and the reason this check lives at the recap rather than
  // at the dealership's submission: a $1,400 increase moves the total without touching any of the
  // three item lists, and refusing it blocked §10a's entire material-change path. Journeys 3, 4
  // and 5 failed on exactly this.
  const out = reconcileLines(LINES, LINES_TOTAL + 140_000);
  assert.equal(out.reduce((s, l) => s + l.amountCents, 0), LINES_TOTAL + 140_000);
});

test("rounding does not produce a line item", () => {
  const out = reconcileLines(LINES, LINES_TOTAL + 40);
  assert.deepEqual(out, LINES, "40 cents is rounding, not a charge a buyer should have to interpret");
});

test("an incentive line keeps its sign through reconciliation", () => {
  const withIncentive = [...LINES, { key: "incentives", label: "Discounts and incentives", amountCents: -100_000 }];
  const out = reconcileLines(withIncentive, LINES_TOTAL - 100_000);
  assert.deepEqual(out, withIncentive);
});
