// §Stage 20's fourteen completion preconditions — each one proved INDEPENDENTLY FALSIFIABLE.
//
// THE FAILURE THIS FILE EXISTS AGAINST. A fourteen-item checklist that always returns
// `complete: true` looks exactly like a fourteen-item checklist that works. Both render fourteen
// green rows; both let the completion through; and the second is indistinguishable from the first
// until a deal completes that should not have. So it is not enough to assert that a good deal
// passes — every item has to be shown CAPABLE of failing, and capable of failing ALONE, on a
// fixture where the other thirteen still hold.
//
// The loop below does exactly that: for each of the fourteen, it flips the one fact that item
// reads and asserts the evaluation reports that item outstanding AND no other. An item whose
// spoiler changes nothing is a check that is not wired to anything. An item whose spoiler trips
// two rows is two checks reading one fact, which means one of them cannot be repaired without
// breaking the other.
//
// IT ALSO CATCHES THE OPPOSITE MISTAKE — a checklist that quietly loses an item. The count is
// asserted against the document's own fourteen bullets rather than against whatever the
// evaluator happens to return, so deleting an item fails here instead of completing more deals.
//
// THE TOKEN OF FAITH IS `signatureProgress`, WHICH IS NOT MOCKED. It is Phase 8's predicate for
// "every required signer has signed", and mocking it would let this file agree with itself about
// the one precondition most likely to be wrong. The fixture models the ROWS it reads instead.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/deal/__tests__/completion-preconditions.test.ts"

import test, { beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

const VIN = "1HGCM82633A004352";
const PAST = new Date("2026-02-01T00:00:00Z");

type Row = Record<string, unknown>;
let deal: Row | null;
let envelopes: Row[];

/** Every fact the evaluator reads, with all fourteen preconditions TRUE. */
function baseDeal(): Row {
  return {
    id: "deal_1",
    status: "HANDOVER_PENDING",
    buyerId: "buyer_1",
    coBuyerId: null,
    vehicleRequestId: "vr_1",
    depositId: "dep_1",
    auctionId: "auc_1",
    offerId: "off_1",
    vehicleRequestOfferId: null,
    dealerId: "dlr_1",
    vin: VIN,
    vehicleYear: 2021,
    vehicleMake: "Honda",
    vehicleModel: "Accord",
    recapConfirmedByBuyerAt: PAST,
    recapConfirmedByDealerAt: PAST,
    financingCompletedAt: PAST,
    fundingClearedAt: PAST,
    feePaidAt: PAST,
    feeAmountCents: 49900,
    insuranceStatus: "VERIFIED",
    dealerExecutedContractId: "cv_exec",
    holdReason: null,
    frozenAt: null,
    buyer: { id: "buyer_1", firstName: "Ada", lastName: "Byron", user: { email: "ada@example.com" } },
    coBuyer: null,
    offer: { id: "off_1", dealerId: "dlr_1", auctionId: "auc_1" },
    vehicleRequestOffer: null,
    auction: { id: "auc_1", sourcingCaseId: "sc_1", vehicleRequestId: "vr_1" },
    vehicleRequest: { id: "vr_1" },
    deposit: { id: "dep_1", status: "PAID" },
    dealer: { id: "dlr_1" },
    dealerReaffirmations: [{ status: "CONFIRMED", confirmedVin: VIN, decidedAt: PAST }],
    contractVersions: [{ id: "cv_1", version: 3 }],
    eSignEnvelopes: [{ signerKind: "BUYER", status: "COMPLETED", documentVersionId: "cv_1" }],
    pickup: {
      dealerReleasedAt: PAST,
      releasedBy: "dlr_1",
      identityVerifiedAt: PAST,
      buyerConfirmedAt: PAST,
      vinMatch: true,
      odometerAtPossession: 12,
      conditionAtPossession: "Clean, as described.",
      possessionDiscrepancy: null,
    },
    queueItems: [],
  };
}

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      // Prisma mocks ignore `select`, so ONE row serves both this evaluator's query and
      // `requiredSignersForDeal`'s — which is what lets the real signature predicate run.
      deal: { findUnique: async () => deal },
      eSignEnvelope: { findMany: async () => envelopes },
    },
  },
});

const evaluate = async () =>
  (await import("../completion-preconditions.service")).evaluateCompletionPreconditions("deal_1");

const count = async () => (await import("../completion-preconditions.service")).STAGE_20_PRECONDITION_COUNT;

beforeEach(() => {
  deal = baseDeal();
  envelopes = [{ signerKind: "BUYER", status: "COMPLETED" }];
});

test("a deal with every checkpoint met completes, and the list is the document's fourteen", async () => {
  const result = await evaluate();

  assert.equal(result.complete, true, `outstanding: ${result.outstanding.map((i) => i.key).join(", ")}`);
  assert.deepEqual(result.outstanding, []);
  assert.equal(
    result.items.length,
    await count(),
    "§Stage 20 lists fourteen bullets. A checklist with a different number is not that list."
  );
  assert.equal(result.items.length, 14, "the constant itself must equal the document's count, not merely the code's");
  assert.equal(new Set(result.items.map((i) => i.key)).size, 14, "every item needs a distinct key to be addressable");
});

/**
 * One spoiler per precondition: the smallest change that makes exactly that item false.
 *
 * MUTATING THE FIXTURE RATHER THAN THE EVALUATOR is what makes this a test of the checklist
 * instead of a restatement of it. Each entry breaks a FACT; the evaluator is untouched and has
 * to notice on its own.
 */
const SPOILERS: Record<string, () => void> = {
  BUYER_IDENTIFIED: () => {
    // A co-buyer NAMED on the deal whose record does not resolve. Removing the buyer entirely
    // would break the chain item too, which is a different failure.
    deal!.coBuyerId = "cob_1";
    deal!.coBuyer = null;
  },
  REFERENCE_CHAIN_INTACT: () => {
    deal!.depositId = null;
    deal!.deposit = null;
  },
  VEHICLE_VIN_BOUND: () => {
    deal!.vehicleModel = null;
  },
  DEALER_REAFFIRMED: () => {
    deal!.dealerReaffirmations = [{ status: "TIMED_OUT", confirmedVin: null, decidedAt: null }];
  },
  RECAP_CONFIRMED_BOTH: () => {
    deal!.recapConfirmedByDealerAt = null;
  },
  FINANCING_OR_CASH: () => {
    deal!.financingCompletedAt = null;
  },
  FUNDING_CLEARED: () => {
    deal!.fundingClearedAt = null;
  },
  FEES_RESOLVED: () => {
    deal!.feePaidAt = null;
  },
  INSURANCE_VERIFIED: () => {
    deal!.insuranceStatus = "PENDING_REVIEW";
  },
  CONTRACT_SIGNED_BY_ALL: () => {
    // Signed — but against a SUPERSEDED version. This is the case the item exists for, and a
    // naive `allSigned` check passes it.
    deal!.eSignEnvelopes = [{ signerKind: "BUYER", status: "COMPLETED", documentVersionId: "cv_OLD" }];
  },
  EXECUTED_CONTRACT_STORED: () => {
    deal!.dealerExecutedContractId = null;
  },
  RELEASED_BY_DEALERSHIP: () => {
    (deal!.pickup as Row).releasedBy = "some_other_party";
  },
  POSSESSION_CONFIRMED: () => {
    (deal!.pickup as Row).odometerAtPossession = null;
  },
  NO_HOLD_OR_DISCREPANCY: () => {
    deal!.queueItems = [{ id: "qi_1", exceptionCode: "DELIVERY_DISCREPANCY_REPORTED" }];
  },
};

test("every one of the fourteen can fail, and can fail ALONE", async () => {
  const keys = (await evaluate()).items.map((i) => i.key);
  assert.deepEqual(
    Object.keys(SPOILERS).sort(),
    [...keys].sort(),
    "every evaluated item needs a spoiler, and every spoiler an item — a key with no spoiler is an unproved check"
  );

  for (const [key, spoil] of Object.entries(SPOILERS)) {
    deal = baseDeal();
    envelopes = [{ signerKind: "BUYER", status: "COMPLETED" }];
    spoil();

    const result = await evaluate();

    assert.equal(result.complete, false, `${key}: spoiling this fact changed nothing — the check is not wired to it`);
    assert.deepEqual(
      result.outstanding.map((i) => i.key),
      [key],
      `${key}: exactly this item must go outstanding. More than one means two checks share a fact; a different one means the spoiler and the check disagree about which fact this is.`
    );

    const item = result.outstanding[0];
    assert.ok(item.label.length > 0, `${key}: §Stage 20 shows "the exact missing checkpoint" — it needs a label`);
    assert.ok(item.detail.length > 0, `${key}: a checkpoint with no explanation is not actionable`);
    assert.ok(
      ["FINANCE", "DEALERSHIP", "BUYER", "OPERATIONS"].includes(item.owner),
      `${key}: §Stage 20 shows "the responsible party" — ${item.owner} is not one`
    );
  }
});

test("a concierge deal has no auction and no sourcing case, and completes anyway", async () => {
  // The chain the document names includes an auction and a sourcing case. A vehicle-request deal
  // never had either. Marking them outstanding would make an entire product line uncompletable;
  // marking them satisfied would claim a check that never ran.
  deal!.offerId = null;
  deal!.offer = null;
  deal!.vehicleRequestOfferId = "vro_1";
  deal!.vehicleRequestOffer = { id: "vro_1", requestId: "vr_1" };
  deal!.auctionId = null;
  deal!.auction = null;

  const result = await evaluate();

  assert.equal(result.complete, true, `outstanding: ${result.outstanding.map((i) => i.key).join(", ")}`);
});

test("an auction deal missing its sourcing case IS a broken chain", async () => {
  // The same two links, on a deal that DOES have an auction. The concierge exemption must not
  // become a blanket one.
  (deal!.auction as Row).sourcingCaseId = null;

  const result = await evaluate();

  assert.deepEqual(result.outstanding.map((i) => i.key), ["REFERENCE_CHAIN_INTACT"]);
  assert.match(result.outstanding[0].detail, /sourcing case/);
});

test("the broken link is named, not merely counted", async () => {
  deal!.vehicleRequestId = null;
  deal!.vehicleRequest = null;
  deal!.depositId = null;
  deal!.deposit = null;

  const result = await evaluate();

  const chain = result.outstanding.find((i) => i.key === "REFERENCE_CHAIN_INTACT");
  assert.ok(chain, "the chain item must be outstanding");
  assert.match(chain.detail, /vehicle request/);
  assert.match(chain.detail, /payment/);
});

test("a deal that cannot be read is not a complete one", async () => {
  deal = null;

  const result = await evaluate();

  assert.equal(result.complete, false, "fail closed — an unreadable deal must never evaluate as complete");
  assert.equal(result.outstanding.length, 1);
  assert.equal(result.outstanding[0].owner, "OPERATIONS");
});

test("a reaffirmation naming a DIFFERENT VIN is not a reaffirmation of this vehicle", async () => {
  deal!.dealerReaffirmations = [{ status: "CONFIRMED", confirmedVin: "5YJ3E1EA7KF000000", decidedAt: PAST }];

  const result = await evaluate();

  assert.deepEqual(result.outstanding.map((i) => i.key), ["DEALER_REAFFIRMED"]);
  assert.match(result.outstanding[0].detail, /different VIN/);
});

test("a deal that owes no AutoLenis fee has its fees resolved", async () => {
  // "Resolved" is not "charged". A deal with nothing owing is resolved; treating a null fee as
  // unpaid would block every deal that never carried one.
  deal!.feeAmountCents = null;
  deal!.feePaidAt = null;

  const result = await evaluate();

  assert.equal(result.complete, true, `outstanding: ${result.outstanding.map((i) => i.key).join(", ")}`);
});

test("a required CO-BUYER who has not signed blocks completion", async () => {
  deal!.coBuyerId = "cob_1";
  deal!.coBuyer = { id: "cob_1", isRequiredSigner: true, legalFirstName: "Grace", legalLastName: "Hopper", email: "g@example.com" };
  envelopes = [{ signerKind: "BUYER", status: "COMPLETED" }];

  const result = await evaluate();

  assert.ok(
    result.outstanding.some((i) => i.key === "CONTRACT_SIGNED_BY_ALL"),
    "a required co-buyer with no completed envelope must block the signature precondition"
  );
  assert.match(result.outstanding.find((i) => i.key === "CONTRACT_SIGNED_BY_ALL")!.detail, /CO_BUYER/);
});

test("unreadable discrepancy JSON reads as a material discrepancy, not as no discrepancy", async () => {
  // Fail closed. A value nobody can parse is not evidence that nothing was reported.
  (deal!.pickup as Row).possessionDiscrepancy = "corrupted";

  const result = await evaluate();

  assert.deepEqual(result.outstanding.map((i) => i.key), ["NO_HOLD_OR_DISCREPANCY"]);
});
