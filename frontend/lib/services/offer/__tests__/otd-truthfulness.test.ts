// Program 3 — req #11: a valid dealer bid becomes a TRUTHFUL stored offer. The
// shared anti-fabrication core is assertOtdComponentsMatch — the SAME assertion
// the reverse-auction submit path (offer.service) and the concierge→canonical
// conversion both run, so no Offer can carry an OTD total that does not reconcile
// to its own components, and no negative "junk fee" can misrepresent the breakdown.
//
//   npx tsx --test lib/services/offer/__tests__/otd-truthfulness.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { assertOtdComponentsMatch, OTD_SUM_TOLERANCE_CENTS } from "@/lib/services/offer/otd";

test("a truthful breakdown (components sum to OTD) is accepted", () => {
  assert.doesNotThrow(() =>
    assertOtdComponentsMatch({
      otdPriceCents: 3_500_000,
      vehiclePriceCents: 3_200_000,
      taxCents: 250_000,
      feesCents: 50_000,
      junkFeeItems: [],
    }),
  );
});

test("a fabricated OTD total that does NOT reconcile to components is REJECTED", () => {
  assert.throws(
    () =>
      assertOtdComponentsMatch({
        otdPriceCents: 3_000_000, // claimed total...
        vehiclePriceCents: 3_200_000, // ...but components already exceed it
        taxCents: 250_000,
        feesCents: 50_000,
        junkFeeItems: [],
      }),
    /OTD breakdown mismatch/,
  );
});

test("a negative junk-fee line item is rejected (cannot inflate the vehicle line while holding OTD)", () => {
  assert.throws(
    () =>
      assertOtdComponentsMatch({
        otdPriceCents: 3_500_000,
        vehiclePriceCents: 3_600_000,
        taxCents: 0,
        feesCents: 0,
        junkFeeItems: [{ name: "phantom discount", amount: -1000 }],
      }),
    /cannot be negative/,
  );
});

test("junk-fee line items (dollars) are summed into the OTD reconciliation", () => {
  // 3,200,000 + 250,000 + 50,000 + (1000 dollars * 100) = 3,600,000
  assert.doesNotThrow(() =>
    assertOtdComponentsMatch({
      otdPriceCents: 3_600_000,
      vehiclePriceCents: 3_200_000,
      taxCents: 250_000,
      feesCents: 50_000,
      junkFeeItems: [{ name: "doc fee", amount: 1000 }],
    }),
  );
});

test("the ±1¢ rounding tolerance is honored, but a larger gap is rejected", () => {
  assert.doesNotThrow(() =>
    assertOtdComponentsMatch({
      otdPriceCents: 1_000_000 + OTD_SUM_TOLERANCE_CENTS,
      vehiclePriceCents: 1_000_000,
      taxCents: 0,
      feesCents: 0,
    }),
  );
  assert.throws(() =>
    assertOtdComponentsMatch({
      otdPriceCents: 1_000_000 + OTD_SUM_TOLERANCE_CENTS + 5,
      vehiclePriceCents: 1_000_000,
      taxCents: 0,
      feesCents: 0,
    }),
  );
});
