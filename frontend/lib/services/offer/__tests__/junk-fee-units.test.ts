// §8.2 Phase 6, defect 1 — ONE INTEGER-CENTS UNIT for `offers.junk_fee_items`, end to end.
//
// Two distinct defects lived on this column and both are pinned here:
//
//   (1) THE 100x DIVERGENCE. `otd.ts:31` multiplied `amount` by 100 (dollars) while
//       `best-price.service.ts:64` summed the same field raw into `junkFeesCents` (cents).
//
//   (2) THE BLOCKING DOUBLE-COUNT, which the parity table did not record and which is the harder
//       failure. The dealer quick-bid form sent every fee TWICE — as the lump `feesCents` and as
//       the whole list in `junkFeeItems` — and `otd.ts` adds the two, so `expected` exceeded
//       `otdPriceCents` by the entire fee total and the submission threw. A dealer could only bid
//       with ZERO fees, and saw nothing but "Failed to submit offer. Please try again."
//
// The third group proves the ROLLBACK the §8.2 rollback paragraph specifies: a reversible
// transform with the dollars pre-image retained in the same row until Phase 10.

import test from "node:test";
import assert from "node:assert/strict";
import { assertOtdComponentsMatch } from "@/lib/services/offer/otd";
import {
  normalizeJunkFeeItems,
  feeItemsTotalCents,
  junkFeeTotalCents,
  toPreImageDollars,
  feeItemsSchema,
} from "@/lib/services/offer/junk-fee-items";

// ── (2) the double-count that blocked every fee-bearing bid ──────────────────────────────────────

test("the payload the dealer form USED to send is rejected — every fee counted twice", () => {
  // vehicle 3,000,000 + tax 200,000 + fees 50,000 = 3,250,000 OTD, with one $500 fee.
  // The old form sent feesCents = ALL fees AND junkFeeItems = ALL fees, so the assertion saw
  // 3,000,000 + 200,000 + 50,000 + 50,000 = 3,300,000 against a stated 3,250,000.
  assert.throws(
    () =>
      assertOtdComponentsMatch({
        otdPriceCents: 3_250_000,
        vehiclePriceCents: 3_000_000,
        taxCents: 200_000,
        feesCents: 50_000,                                   // the whole fee total...
        junkFeeItems: [{ name: "dealer prep", amount: 500 }], // ...and the same money again
      }),
    /OTD breakdown mismatch/,
    "the double-count no longer throws — the blocking defect would be back",
  );
});

test("the payload the dealer form sends NOW reconciles — itemised fees, counted once", () => {
  // feesCents is the UN-ITEMISED remainder; junkFeeItems carries the itemised fees in cents.
  assert.doesNotThrow(() =>
    assertOtdComponentsMatch({
      otdPriceCents: 3_250_000,
      vehiclePriceCents: 3_000_000,
      taxCents: 200_000,
      feesCents: 0,
      junkFeeItems: [{ name: "dealer prep", amountCents: 50_000 }],
    }),
  );
});

test("a mixed bid — itemised junk plus an un-itemised remainder — reconciles exactly", () => {
  assert.doesNotThrow(() =>
    assertOtdComponentsMatch({
      otdPriceCents: 3_250_000,
      vehiclePriceCents: 3_000_000,
      taxCents: 200_000,
      feesCents: 20_000,                                          // doc fee, not itemised
      junkFeeItems: [{ name: "nitrogen", amountCents: 30_000 }],   // itemised
    }),
  );
});

// ── (1) the 100x divergence ──────────────────────────────────────────────────────────────────────

test("canonical cents are NOT re-multiplied — the 100x bug, in the direction that overstates", () => {
  const items = normalizeJunkFeeItems([{ name: "vin etch", amountCents: 19_900 }]);
  assert.equal(feeItemsTotalCents(items), 19_900, "cents were multiplied by 100 again");
});

test("legacy dollars are converted once — the 100x bug, in the direction that understates", () => {
  const items = normalizeJunkFeeItems([{ name: "vin etch", amount: 199 }]);
  assert.equal(
    feeItemsTotalCents(items), 19_900,
    "a stored dollars row was summed as cents — the best-price.service defect",
  );
});

test("both readers now agree on the same stored row", () => {
  // The divergence was that `otd.ts` and `best-price.service.ts` derived different numbers from
  // ONE column. They now share `junk-fee-items.ts`, so this is an identity — and it is worth
  // asserting precisely because it was not one.
  const stored = [{ name: "paint protection", amount: 995 }];
  const items = normalizeJunkFeeItems(stored);
  assert.equal(feeItemsTotalCents(items), junkFeeTotalCents(items));
  assert.equal(feeItemsTotalCents(items), 99_500);
});

test("classification moves money between ranking dimensions, never between totals", () => {
  const items = normalizeJunkFeeItems([
    { name: "nitrogen", amountCents: 30_000, isJunk: true },
    { name: "documentation", amountCents: 20_000, isJunk: false },
  ]);
  assert.equal(feeItemsTotalCents(items), 50_000, "the OTD total must include non-junk fees");
  assert.equal(junkFeeTotalCents(items), 30_000, "only junk counts toward the junk ranking");
});

test("an unclassified legacy item counts as junk, not as zero", () => {
  // `isJunk` is absent on every row written before Phase 6. Treating unknown as not-junk would
  // silently zero the ranking dimension for all of them.
  const items = normalizeJunkFeeItems([{ name: "mystery fee", amount: 100 }]);
  assert.equal(junkFeeTotalCents(items), 10_000);
});

// ── the admin `{ label, amount }` shape ──────────────────────────────────────────────────────────

test("the admin route's `{label, amount}` shape is understood and gets a name", () => {
  const items = normalizeJunkFeeItems([{ label: "market adjustment", amount: 250 }]);
  assert.equal(items[0].name, "market adjustment");
  assert.equal(items[0].amountCents, 25_000);
});

test("a negative admin-shaped fee is rejected BY NAME — it used to read `undefined`", () => {
  assert.throws(
    () =>
      assertOtdComponentsMatch({
        otdPriceCents: 100,
        vehiclePriceCents: 100,
        taxCents: 0,
        feesCents: 0,
        junkFeeItems: [{ label: "phantom discount", amount: -10 }],
      }),
    /Fee "phantom discount" cannot be negative/,
  );
});

// ── the reversible transform (§8.2 Phase 6 rollback) ─────────────────────────────────────────────

test("the dollars pre-image is retained in the same row, so a revert reads what it wrote", () => {
  const items = normalizeJunkFeeItems([{ name: "dealer prep", amount: 499.5 }]);
  assert.equal(items[0].amountCents, 49_950);
  assert.equal(items[0].amount, 499.5, "the pre-image was dropped — a revert could not restore it");
});

test("the transform round-trips: canonical -> pre-image -> canonical is stable", () => {
  const original = [{ name: "nitrogen", amount: 299 }];
  const forward = normalizeJunkFeeItems(original);
  const reverted = toPreImageDollars(forward);
  assert.deepEqual(reverted, original, "a revert would not restore the prior representation");
  assert.equal(feeItemsTotalCents(normalizeJunkFeeItems(reverted)), feeItemsTotalCents(forward));
});

test("the backfill is idempotent — normalising twice changes nothing", () => {
  const once = normalizeJunkFeeItems([{ name: "ppf", amount: 150 }]);
  const twice = normalizeJunkFeeItems(once);
  assert.deepEqual(twice, once, "re-running the backfill would multiply by 100 again");
});

// ── malformed input ──────────────────────────────────────────────────────────────────────────────

test("an unreadable amount is DROPPED, not coerced to zero", () => {
  // A fee whose amount cannot be read is not a fee worth nothing. Zeroing it would let the OTD
  // assertion pass on a breakdown nobody can justify.
  const items = normalizeJunkFeeItems([
    { name: "good", amountCents: 100 },
    { name: "bad", amount: "oops" },
    { name: "", amountCents: 500 },
    null,
    "not an object",
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].name, "good");
});

test("the wire schema accepts all three shapes and refuses a nameless or amountless item", () => {
  assert.equal(feeItemsSchema.safeParse([{ name: "a", amount: 1 }]).success, true);
  assert.equal(feeItemsSchema.safeParse([{ label: "a", amount: 1 }]).success, true);
  assert.equal(feeItemsSchema.safeParse([{ name: "a", amountCents: 100 }]).success, true);
  assert.equal(feeItemsSchema.safeParse([{ amount: 1 }]).success, false, "a nameless fee was accepted");
  assert.equal(feeItemsSchema.safeParse([{ name: "a" }]).success, false, "an amountless fee was accepted");
});
