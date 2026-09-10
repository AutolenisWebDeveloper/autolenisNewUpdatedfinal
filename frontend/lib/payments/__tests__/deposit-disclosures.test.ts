// §5b — the seven disclosures, and the version that keeps an acceptance honest.
//
// Run with: npx tsx --test lib/payments/__tests__/deposit-disclosures.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  DEPOSIT_DISCLOSURES,
  REQUIRED_DISCLOSURE_COUNT,
  DISCLOSURES_VERSION,
  DISCLOSURES_LEGAL_APPROVED,
} from "../deposit-disclosures";

test("all seven §5b bullets are present, each with the clause it satisfies", () => {
  assert.equal(DEPOSIT_DISCLOSURES.length, REQUIRED_DISCLOSURE_COUNT);
  assert.equal(REQUIRED_DISCLOSURE_COUNT, 7);
  for (const d of DEPOSIT_DISCLOSURES) {
    assert.ok(d.id && d.text && d.source, `disclosure ${d.id} is incomplete`);
    assert.ok(d.source.includes("§"), "each names the clause it exists to satisfy");
  }
  assert.equal(new Set(DEPOSIT_DISCLOSURES.map((d) => d.id)).size, 7, "ids are unique");
});

test("the seven cover the seven subjects §5b names", () => {
  const ids = DEPOSIT_DISCLOSURES.map((d) => d.id);
  assert.deepEqual(ids, [
    "amount_is_the_plan",
    "premium_balance",
    "radius_expansion",
    "out_of_state",
    "beyond_250_needs_authorization",
    "no_obligation",
    "refund_policy",
  ]);
});

// §13-D48 exists because the live copy contradicted the specification AND itself: the
// checkout called the $99 a refundable "Auction Access Deposit", the receipt said it was
// "credited toward your AutoLenis concierge fee when your deal closes". §23.1 says it is
// the Standard plan paid in full.
test("the amount is described as the Standard plan, not as a deposit against a larger fee", () => {
  const first = DEPOSIT_DISCLOSURES[0]!;
  assert.match(first.text, /Standard plan, paid in full/);
  assert.match(first.text, /not a deposit against a larger fee/);
  assert.ok(
    !/credited toward/i.test(first.text),
    "the wording §13-D48 was raised about must not come back",
  );
});

test("Premium is the balance of a $499 total, never a second $99", () => {
  const premium = DEPOSIT_DISCLOSURES.find((d) => d.id === "premium_balance")!;
  assert.match(premium.text, /\$400/);
  assert.match(premium.text, /\$499/);
  assert.match(premium.text, /never a second \$99/);
});

test("the refund bullet says reviewed and not automatic, which is what §22.1 requires", () => {
  const refund = DEPOSIT_DISCLOSURES.find((d) => d.id === "refund_policy")!;
  assert.match(refund.text, /not automatic/);
  assert.match(refund.text, /reviewed/i);
});

// The gate that makes it safe to ship un-approved wording.
test("the version is draft-marked and legal approval is NOT claimed", () => {
  assert.equal(
    DISCLOSURES_LEGAL_APPROVED,
    false,
    "§13-D48 is open. Flip this WITH a version bump when legal returns the approved wording — " +
      "the bump is what re-asks buyers who accepted the draft.",
  );
  assert.match(DISCLOSURES_VERSION, /draft/, "the version says out loud which era of wording this is");
});
