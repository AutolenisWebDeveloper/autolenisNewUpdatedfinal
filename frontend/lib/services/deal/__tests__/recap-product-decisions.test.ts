// §11a — the SERVER half of "a declined product leaves the total".
//
// Run with:  npx tsx --test lib/services/deal/__tests__/recap-product-decisions.test.ts
//
// THE SCREEN WAS FIXED AND THE DATABASE WAS NOT. `RecapConfirmClient` now carves declined and
// undecided products out of the running total (`recap-totals.ts`). `decideOptionalProduct` flipped
// `accepted` on a JSON element and wrote nothing else — so `amount_financed_cents` and
// `estimated_payment_cents`, both computed at build time from an out-the-door figure containing
// EVERY product, kept the declined ones in. The buyer read one number on the confirmation screen
// and agreed to a row carrying another, and Stage 12 finances the row.
//
// UNDECIDED PRODUCTS ARE OUT TOO, for the reason §11a exists: "nothing may first appear in your
// contract". A principal that already contains a product nobody has answered has let it ride in on
// silence. The figure rises as the buyer accepts — which is what the screen's "still to decide"
// row warns them about, and the two now say the same thing because they run the same function.
//
// `itemised.otdCents` is NOT rewritten by any of this. It is the figure the DEALERSHIP reaffirmed
// (`deal-recap.service.ts:226`), it is what §10a compares and the ceiling test reads, and it is
// evidence. The carve-out is derived from it, never applied to it.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { agreedMoney } from "../deal-recap.service";
import type { RecapProduct } from "../recap-totals";

/** $40,000 out the door AS REAFFIRMED — $2,500 of that is the two optional products. */
const OTD = 4_000_000;
const GAP: RecapProduct = { key: "product-0", label: "GAP", amountCents: 120_000, accepted: null };
const COAT: RecapProduct = { key: "product-1", label: "Paint protection", amountCents: 130_000, accepted: null };

const BASE = {
  itemisedOtdCents: OTD,
  downPaymentCents: 200_000,
  equityCents: null,
  financingPath: "DEALER",
  aprRate: 7,
  termMonths: 60,
};

test("an undecided product is not financed — silence is not an answer", () => {
  const m = agreedMoney({ ...BASE, products: [GAP, COAT] });
  assert.equal(m.agreedOtdCents, OTD - 250_000, "both unanswered products sit outside the agreed total");
  assert.equal(m.amountFinancedCents, OTD - 250_000 - 200_000);
});

test("accepting a product puts exactly its amount back — the defect this file exists for", () => {
  const undecided = agreedMoney({ ...BASE, products: [GAP, COAT] });
  const accepted = agreedMoney({ ...BASE, products: [{ ...GAP, accepted: true }, COAT] });
  assert.equal(
    accepted.amountFinancedCents - undecided.amountFinancedCents,
    GAP.amountCents,
    "accepting GAP must move the principal by GAP's price and by nothing else",
  );
});

test("DECLINING a product does not change the principal it was never in", () => {
  const undecided = agreedMoney({ ...BASE, products: [GAP, COAT] });
  const declined = agreedMoney({ ...BASE, products: [{ ...GAP, accepted: false }, COAT] });
  assert.equal(declined.amountFinancedCents, undecided.amountFinancedCents);
});

test("a declined product is NEVER financed, whatever the reaffirmed total contained", () => {
  const all = agreedMoney({
    ...BASE,
    products: [
      { ...GAP, accepted: false },
      { ...COAT, accepted: true },
    ],
  });
  assert.equal(all.agreedOtdCents, OTD - GAP.amountCents, "only the declined one comes out");
  assert.notEqual(all.amountFinancedCents, OTD - 200_000, "the old answer financed both");
});

test("the estimated payment moves with the decision — which is the harm a buyer feels", () => {
  const withGap = agreedMoney({ ...BASE, products: [{ ...GAP, accepted: true }, COAT] });
  const without = agreedMoney({ ...BASE, products: [{ ...GAP, accepted: false }, COAT] });
  assert.ok(withGap.estimatedPaymentCents != null && without.estimatedPaymentCents != null);
  assert.ok(
    withGap.estimatedPaymentCents! > without.estimatedPaymentCents!,
    "declining GAP must quote a smaller monthly payment, not the same one",
  );
});

test("a cash deal finances nothing however the products were answered", () => {
  const m = agreedMoney({
    ...BASE,
    financingPath: "CASH",
    products: [{ ...GAP, accepted: true }, { ...COAT, accepted: false }],
  });
  assert.equal(m.amountFinancedCents, 0);
  assert.equal(m.agreedOtdCents, OTD - COAT.amountCents, "the agreed OTD still reflects the answers");
});

test("negative equity still rides in — the earlier fix is not undone by this one", () => {
  const m = agreedMoney({
    ...BASE,
    equityCents: -500_000,
    products: [{ ...GAP, accepted: true }, { ...COAT, accepted: true }],
  });
  assert.equal(m.amountFinancedCents, OTD - 200_000 + 500_000);
});

test("the agreed total never exceeds the figure the dealership reaffirmed", () => {
  const m = agreedMoney({ ...BASE, products: [{ ...GAP, accepted: true }, { ...COAT, accepted: true }] });
  assert.equal(m.agreedOtdCents, OTD, "everything accepted → the reaffirmed figure exactly, not more");
});

// ─────────────────────────────────────────────────────────────────────────────
// The wiring. Pure arithmetic nobody calls is the shape the UI defect already had.
// ─────────────────────────────────────────────────────────────────────────────

const SRC = readFileSync(`${process.cwd()}/lib/services/deal/deal-recap.service.ts`, "utf8");

function body(name: string): string {
  const start = SRC.indexOf(`export async function ${name}(`);
  assert.ok(start > 0, `${name} must exist`);
  const next = SRC.indexOf("\nexport ", start + 10);
  return SRC.slice(start, next > 0 ? next : SRC.length);
}

test("decideOptionalProduct persists the recomputed money, not just the flag", () => {
  const fn = body("decideOptionalProduct");
  assert.match(fn, /agreedMoney\(/, "the decision must recompute through the shared arithmetic");
  assert.match(
    fn,
    /amountFinancedCents/,
    "and write it — flipping `accepted` while the principal keeps the product is the defect",
  );
  assert.match(fn, /estimatedPaymentCents/, "the quoted payment is derived from the principal and moves with it");
});

test("buildRecap computes the first version through the same function", () => {
  const fn = body("buildRecap");
  assert.match(fn, /agreedMoney\(/, "or version 1 finances every product before the buyer has answered one");
});

test("neither writer rewrites the reaffirmed out-the-door figure", () => {
  for (const name of ["buildRecap", "decideOptionalProduct"]) {
    assert.equal(
      /itemised\.otdCents\s*=/.test(body(name)),
      false,
      `${name} must not reassign the dealership's reaffirmed total — it is evidence, and §10a compares it`,
    );
  }
});
