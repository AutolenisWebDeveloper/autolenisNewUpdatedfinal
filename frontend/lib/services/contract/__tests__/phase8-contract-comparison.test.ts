// §14b — Contract Shield's FACTUAL COMPARISON against the agreed terms.
//
// THE DEFECT THESE PIN. Nothing in the scan pipeline read the offer, the reaffirmation or
// the recap. `scanContract`'s only inputs were the extracted PDF text and the rule rows, so
// a contract whose out-the-door total was $600 higher than the recap the buyer confirmed
// scored exactly the same as one that matched — and the old
// `contract-comparison.service.ts` was a regex diff between two contract TEXTS with zero
// callers, which is a different question entirely.
//
// Run: npx tsx --test --experimental-test-module-mocks \
//   "lib/services/contract/__tests__/phase8-contract-comparison.test.ts"

import test, { mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

let dealRow: unknown = null;
mock.module("@/lib/prisma", {
  namedExports: { prisma: { deal: { findUnique: async () => dealRow } } },
});

const mod = () => import("../contract-comparison.service");

/** A recap both parties confirmed: $32,450 OTD, a $150 doc fee, one ACCEPTED GAP product. */
function agreedDeal(overrides: Record<string, unknown> = {}) {
  return {
    vin: "1HGCM82633A004352",
    odometerAtOffer: 12_345,
    downPaymentCents: 300_000,
    otdCentsConfirmed: 3_245_000,
    offer: {
      vin: "1HGCM82633A004352",
      vehiclePriceCents: 2_950_000, docFeeCents: 15_000, taxCents: 240_000,
      titleRegistrationCents: 40_000, deliveryFeeCents: 0, otdPriceCents: 3_245_000,
      aprRate: 6.9, termMonths: 60,
    },
    dealerReaffirmations: [{ confirmedOtdCents: 3_245_000, confirmedVin: "1HGCM82633A004352", confirmedOdometer: 12_345 }],
    dealRecaps: [{
      version: 2,
      itemized: {
        vehiclePriceCents: 2_950_000, documentationFeeCents: 15_000, taxesCents: 240_000,
        titleAndRegistrationCents: 40_000, deliveryFeeCents: 0, otdCents: 3_245_000,
      },
      optionalProducts: [
        { key: "product-0", label: "GAP Protection", amountCents: 120_000, accepted: true },
        { key: "product-1", label: "Paint Protection Film", amountCents: 80_000, accepted: false },
      ],
      downPaymentCents: 300_000,
    }],
    tradeInSubmissions: [],
    ...overrides,
  };
}

/** Contract text stating every agreed figure correctly, and only the accepted product. */
const MATCHING_CONTRACT = `
RETAIL INSTALMENT CONTRACT
VIN 1HGCM82633A004352   Odometer 12,345 miles
Vehicle price $29,500.00
Documentation fee $150.00
Sales tax $2,400.00
Title and registration $400.00
Cash down payment $3,000.00
GAP Protection $1,200.00
Annual Percentage Rate 6.9%   60 months
Out-the-door total $32,450.00
`;

test("a contract matching the confirmed recap produces NO findings", async () => {
  dealRow = agreedDeal();
  const { compareContractAgainstAgreedTerms } = await mod();
  const findings = await compareContractAgainstAgreedTerms({ dealId: "d1", contractText: MATCHING_CONTRACT });
  assert.deepEqual(findings, [], `expected a clean comparison, got: ${JSON.stringify(findings, null, 2)}`);
});

test("THE DEFECT: an unexplained increase in the out-the-door total is HELD", async () => {
  dealRow = agreedDeal();
  const { compareContractAgainstAgreedTerms } = await mod();
  const findings = await compareContractAgainstAgreedTerms({
    dealId: "d1",
    contractText: MATCHING_CONTRACT.replace("Out-the-door total $32,450.00", "Out-the-door total $33,050.00"),
  });
  const otd = findings.find((f) => f.key === "otd");
  assert.ok(otd, "a $600 increase over the confirmed recap must be a finding");
  assert.equal(otd.kind, "MISMATCH");
  assert.match(otd.expectedValue, /32,450/);
  assert.match(otd.foundValue, /33,050/);
  assert.match(otd.source, /recap/);
});

test("a changed VIN is a finding — the identity of the thing being sold", async () => {
  dealRow = agreedDeal();
  const { compareContractAgainstAgreedTerms } = await mod();
  const findings = await compareContractAgainstAgreedTerms({
    dealId: "d1",
    contractText: MATCHING_CONTRACT.replace("1HGCM82633A004352", "2FMDK3GC4BBA00001"),
  });
  assert.ok(findings.some((f) => f.key === "vin" && f.kind === "MISMATCH"));
});

test("§11a: a DECLINED optional product appearing in the contract is an ADDITION", async () => {
  // "A warranty, service contract, GAP product, maintenance plan or protection package may
  // never first appear in the contract." This is the single thing §11a forbids.
  dealRow = agreedDeal();
  const { compareContractAgainstAgreedTerms } = await mod();
  const findings = await compareContractAgainstAgreedTerms({
    dealId: "d1",
    contractText: `${MATCHING_CONTRACT}\nPaint Protection Film $800.00\n`,
  });
  const ppf = findings.find((f) => f.label.includes("Paint Protection Film"));
  assert.ok(ppf, "a declined product in the contract must be flagged");
  assert.equal(ppf.kind, "ADDITION");
  assert.match(ppf.expectedValue, /DECLINED/);
});

test("an ACCEPTED optional product missing from the contract is a finding too", async () => {
  // The other direction: the buyer is paying for something the contract does not record,
  // so they have no contractual right to it.
  dealRow = agreedDeal();
  const { compareContractAgainstAgreedTerms } = await mod();
  const findings = await compareContractAgainstAgreedTerms({
    dealId: "d1",
    contractText: MATCHING_CONTRACT.replace("GAP Protection $1,200.00", ""),
  });
  const gap = findings.find((f) => f.label.includes("GAP Protection"));
  assert.ok(gap, "an accepted product absent from the contract must be flagged");
  assert.equal(gap.kind, "NOT_FOUND");
});

test("EACH product is judged INDIVIDUALLY, not as a total", async () => {
  // §14b says "each accepted optional product". A comparison that only checked the sum
  // would pass a contract that swapped a $1,200 GAP for a $1,200 service plan.
  dealRow = agreedDeal();
  const { compareContractAgainstAgreedTerms } = await mod();
  const findings = await compareContractAgainstAgreedTerms({
    dealId: "d1",
    contractText: MATCHING_CONTRACT.replace("GAP Protection $1,200.00", "Extended Service Plan $1,200.00"),
  });
  assert.ok(findings.some((f) => f.label.includes("GAP Protection") && f.kind === "NOT_FOUND"));
});

test("AN UNFINDABLE VALUE IS A FINDING, NEVER A PASS", async () => {
  // Extraction from a PDF is partial. A figure this cannot locate is reported for a human,
  // never silently treated as matching — the same rule §14b gives extraction failure.
  dealRow = agreedDeal();
  const { compareContractAgainstAgreedTerms } = await mod();
  const findings = await compareContractAgainstAgreedTerms({
    dealId: "d1",
    contractText: MATCHING_CONTRACT.replace(/Documentation fee \$150\.00/, ""),
  });
  const docFee = findings.find((f) => f.key === "docFee");
  assert.ok(docFee, "a value that could not be read must be a finding");
  assert.equal(docFee.kind, "NOT_FOUND");
  assert.match(docFee.foundValue, /could not be located/);
});

test("a changed financing term is a finding — it triggers Stage 14's full send-back", async () => {
  dealRow = agreedDeal();
  const { compareContractAgainstAgreedTerms } = await mod();
  const findings = await compareContractAgainstAgreedTerms({
    dealId: "d1",
    contractText: MATCHING_CONTRACT.replace("Annual Percentage Rate 6.9%", "Annual Percentage Rate 9.9%"),
  });
  assert.ok(findings.some((f) => f.key === "apr" && f.kind === "MISMATCH"));
});

test("a deal with NO recap and NO offer yields one honest finding, not a clean pass", async () => {
  dealRow = { ...agreedDeal(), offer: null, dealRecaps: [], dealerReaffirmations: [] };
  const { compareContractAgainstAgreedTerms } = await mod();
  const findings = await compareContractAgainstAgreedTerms({ dealId: "d1", contractText: MATCHING_CONTRACT });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].key, "agreed-terms");
  assert.match(findings[0].howToFix, /cannot be compared/);
});

test("an unreadable deal is a finding, not an empty list", async () => {
  dealRow = null;
  const { compareContractAgainstAgreedTerms } = await mod();
  const findings = await compareContractAgainstAgreedTerms({ dealId: "d1", contractText: MATCHING_CONTRACT });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, "NOT_FOUND");
});

test("a zero-value component is not demanded, but a charge in its place IS an ADDITION", async () => {
  // Found by the test above: a contract matching the recap in every respect still reported
  // an outstanding $0 delivery fee. Absence and zero are the same fact on real paperwork,
  // so demanding the line is noise — but a CHARGE where nothing was agreed is exactly the
  // quiet insertion §14b exists to catch, and that direction stays strict.
  dealRow = agreedDeal();
  const { compareContractAgainstAgreedTerms } = await mod();

  const clean = await compareContractAgainstAgreedTerms({ dealId: "d1", contractText: MATCHING_CONTRACT });
  assert.equal(clean.filter((f) => f.key === "delivery").length, 0, "a $0 fee must not be demanded");

  const padded = await compareContractAgainstAgreedTerms({
    dealId: "d1",
    contractText: `${MATCHING_CONTRACT}\nDelivery fee $499.00\n`,
  });
  const delivery = padded.find((f) => f.key === "delivery");
  assert.ok(delivery, "a charge where nothing was agreed must be flagged");
  assert.equal(delivery.kind, "ADDITION");
  assert.match(delivery.foundValue, /499/);
});

// ── DEFECT 10 — found by the independent adversarial review ─────────────────
//
// Accepted optional products were compared by LABEL PRESENCE only. The amount — the one part
// of a product line that moves, and the exact place payment packing happens — was never read.
// §14b asks for each accepted optional product compared against the confirmed recap; a name
// match is not a comparison, and this was the only §14b fact with no money check at all.
test("DEFECT 10: an accepted product charged at the wrong price is a finding", async () => {
  dealRow = agreedDeal();
  const { compareContractAgainstAgreedTerms } = await mod();

  // The recap says GAP Protection at $1,200, accepted. The contract charges $4,995 for it.
  // Before the fix this produced NOTHING: the label was present and accepted, so both
  // existing branches were satisfied and the contract passed.
  const packed = await compareContractAgainstAgreedTerms({
    dealId: "d1",
    contractText: MATCHING_CONTRACT.replace("GAP Protection $1,200.00", "GAP Protection $4,995.00"),
  });
  const finding = packed.find((f) => f.key === "product:product-0:amount");
  assert.ok(finding, `the overcharge must be flagged; got ${JSON.stringify(packed.map((f) => f.key))}`);
  assert.equal(finding.kind, "ADDITION", "charging MORE than agreed is an addition, not a mismatch");
  assert.match(finding.foundValue, /4,?995/);
  assert.match(finding.expectedValue, /1,?200/);

  // And the matching contract still produces no amount finding — the check must not be noisy.
  const clean = await compareContractAgainstAgreedTerms({ dealId: "d1", contractText: MATCHING_CONTRACT });
  assert.equal(
    clean.filter((f) => f.key.startsWith("product:product-0")).length,
    0,
    "a correctly priced accepted product must produce nothing",
  );
});

test("DEFECT 10: an accepted product named with no readable price is NOT_FOUND, never a pass", async () => {
  dealRow = agreedDeal();
  const { compareContractAgainstAgreedTerms } = await mod();
  const noPrice = await compareContractAgainstAgreedTerms({
    dealId: "d1",
    contractText: MATCHING_CONTRACT.replace("GAP Protection $1,200.00", "GAP Protection included"),
  });
  const finding = noPrice.find((f) => f.key === "product:product-0:amount");
  assert.ok(finding, "a product with no price is unreadable, and unreadable is a finding");
  assert.equal(finding.kind, "NOT_FOUND");
});
