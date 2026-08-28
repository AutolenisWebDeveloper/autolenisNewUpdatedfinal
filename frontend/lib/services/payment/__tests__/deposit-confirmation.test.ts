// P0 regression: false success on the $99 deposit money path.
//
// Root cause. app/buyer/deposit/page.tsx rendered
//   "Auction activated! Your private 48-hour auction is now live.
//    Dealers are being invited."
// purely because `stripe.confirmPayment` resolved without an error. That
// resolution proves only that Stripe ACCEPTED the confirmation — not that the
// money settled, not that our Deposit row flipped to PAID, and certainly not
// that any dealer was invited. Because the call used `redirect: "if_required"`,
// the normal card path never left the page, so the correct server-verifying
// page (/buyer/deposit/success, which re-retrieves the PaymentIntent and reads
// the Deposit row) was unreachable: the honest code was dead and the false claim
// was what buyers saw. Production has recorded ZERO Stripe webhook events, so
// that claim was false for every buyer who ever reached it.
//
// Second defect in the same path: when Stripe said `succeeded` but no Deposit
// row matched the intent, the success page fell through to a red
// "Payment not confirmed → Return to Payment" screen — inviting a duplicate $99
// charge for a payment that had already gone through.
//
// These prove the shared decision that both defects are now governed by.
//
// Run: pnpm test:admin-payments  (globs lib/services/payment/__tests__/*.test.ts)

import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyDepositConfirmation,
  mayClaimActivation,
  wasCharged,
} from "../deposit-confirmation";

test("only provider-settled AND recorded-PAID may claim activation", () => {
  assert.equal(
    classifyDepositConfirmation({ intentStatus: "succeeded", depositStatus: "PAID" }),
    "settled",
  );
  assert.equal(mayClaimActivation("settled"), true);
});

test("succeeded intent with a still-PENDING deposit is NOT success", () => {
  // The live production condition: the webhook that flips PENDING → PAID has
  // never delivered, so this is what a real paying buyer hits.
  const outcome = classifyDepositConfirmation({
    intentStatus: "succeeded",
    depositStatus: "PENDING",
  });
  assert.equal(outcome, "charged_unsettled");
  assert.equal(mayClaimActivation(outcome), false, "must not claim the auction is live");
  assert.equal(wasCharged(outcome), true, "the buyer's card was charged — acknowledge it");
});

test("succeeded intent with NO deposit row is charged, not failed", () => {
  // Regression for the duplicate-charge invitation: this case previously
  // rendered "Payment not confirmed → Return to Payment".
  const outcome = classifyDepositConfirmation({
    intentStatus: "succeeded",
    depositStatus: null,
  });
  assert.equal(outcome, "charged_unsettled");
  assert.notEqual(outcome, "failed", "a succeeded charge must never be shown as a failure");
  assert.equal(wasCharged(outcome), true);
  assert.equal(mayClaimActivation(outcome), false);
});

test("a processing intent promises nothing and fails nothing", () => {
  const outcome = classifyDepositConfirmation({ intentStatus: "processing", depositStatus: null });
  assert.equal(outcome, "processing");
  assert.equal(mayClaimActivation(outcome), false);
  assert.equal(wasCharged(outcome), false);
});

test("terminal non-success statuses are failures", () => {
  for (const status of ["requires_payment_method", "canceled", "requires_action"]) {
    const outcome = classifyDepositConfirmation({ intentStatus: status, depositStatus: null });
    assert.equal(outcome, "failed", `${status} should be failed`);
    assert.equal(mayClaimActivation(outcome), false);
    assert.equal(wasCharged(outcome), false);
  }
});

test("no reference, or an unreachable provider, claims nothing", () => {
  assert.equal(classifyDepositConfirmation({ intentStatus: null, depositStatus: null }), "unknown");
  assert.equal(
    classifyDepositConfirmation({ intentStatus: undefined, depositStatus: "PAID" }),
    "unknown",
    "a PAID row alone is not provider confirmation",
  );
  assert.equal(
    classifyDepositConfirmation({
      intentStatus: "succeeded",
      depositStatus: "PAID",
      providerReachable: false,
    }),
    "unknown",
    "a provider outage must not be read as settled",
  );
  assert.equal(mayClaimActivation("unknown"), false);
});

test("a locally-recorded PAID can never substitute for provider evidence", () => {
  // Guards the non-fabrication invariant the admin override relies on: an
  // override writes PAID with NO PaymentProviderEvent, and that must not become
  // a provider-confirmed claim on a buyer-facing surface.
  for (const status of [null, undefined, "processing", "canceled"]) {
    const outcome = classifyDepositConfirmation({ intentStatus: status, depositStatus: "PAID" });
    assert.equal(
      mayClaimActivation(outcome),
      false,
      `depositStatus=PAID with intentStatus=${status} must not claim activation`,
    );
  }
});

test("the two optimism rules are asymmetric on purpose", () => {
  // Optimism about the BUYER'S MONEY is required (acknowledge the charge);
  // optimism about OUR FULFILLMENT is forbidden (never claim dealers invited).
  const outcome = classifyDepositConfirmation({
    intentStatus: "succeeded",
    depositStatus: "PENDING",
  });
  assert.equal(wasCharged(outcome), true);
  assert.equal(mayClaimActivation(outcome), false);
});
