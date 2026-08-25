// Concierge → canonical spine conversion contract.
// Run: npx tsx --test --experimental-test-module-mocks lib/services/concierge/__tests__/concierge-conversion.test.ts
//
// Locks the deposit-gated convergence: conversion is driven by the SPECIFIC
// BuyerOfferReview the buyer acted on — one SUBMITTED canonical Offer per
// non-rejected review item, priced on that item's vehicleIndex — under a CLOSED,
// deposit-gated Auction with a VehicleRequest link. Real dealers keep their id;
// unregistered dealers point at the Outside-Dealer placeholder with identity in
// externalDealer*. Prices pass the shared assertOtdComponentsMatch, and the whole
// thing is idempotent on Auction.depositId. Hand-rolled transaction client — no DB.

import test from "node:test";
import assert from "node:assert/strict";
import {
  convertConciergeOfferToClosedAuction,
  extractOfferPriceCents,
  parseBudgetToCents,
  ConciergeConversionError,
} from "../concierge-conversion.service";

type AnyRec = Record<string, unknown>;

interface MockState {
  existingAuction: AnyRec | null;
  review: AnyRec | null;
  vehicleRequestCreates: AnyRec[];
  auctionCreates: AnyRec[];
  offerCreates: AnyRec[];
}

function makeTx(state: MockState) {
  let vrSeq = 0;
  let aucSeq = 0;
  let offerSeq = 0;
  return {
    auction: {
      findUnique: async (_args: AnyRec) => state.existingAuction,
      create: async ({ data, select }: { data: AnyRec; select?: AnyRec }) => {
        state.auctionCreates.push(data);
        void select;
        return { id: `auc_${++aucSeq}`, ...data };
      },
    },
    buyerOfferReview: {
      findUnique: async (_args: AnyRec) => state.review,
    },
    vehicleRequest: {
      create: async ({ data }: { data: AnyRec }) => {
        state.vehicleRequestCreates.push(data);
        return { id: `vr_${++vrSeq}` };
      },
    },
    offer: {
      create: async ({ data }: { data: AnyRec }) => {
        state.offerCreates.push(data);
        return { id: `off_${++offerSeq}` };
      },
    },
  } as unknown as Parameters<typeof convertConciergeOfferToClosedAuction>[0];
}

function vehicleOffer(overrides: AnyRec = {}): AnyRec {
  return {
    id: "vo_1",
    vehicleMake: "BMW",
    vehicleModel: "3 Series 330i",
    vehicleYear: 2024,
    buyerBudget: "35000",
    createdByAdminId: "admin_1",
    ...overrides,
  };
}

function submission(overrides: AnyRec = {}): AnyRec {
  return {
    id: "sub_1",
    dealershipName: "Athelus Motors LLC",
    contactEmail: "sales@athelus.example",
    contactPhone: "3617174215",
    dealerId: null,
    rejected: false,
    vehicles: [{ offerPriceCents: 3450000, make: "BMW", model: "3 Series", year: 2024 }],
    ...overrides,
  };
}

function reviewItem(id: string, sub: AnyRec, vehicleIndex = 0): AnyRec {
  return { id, vehicleIndex, submission: sub };
}

function review(items: AnyRec[], voOverrides: AnyRec = {}): AnyRec {
  return { id: "rev_1", vehicleOffer: vehicleOffer(voOverrides), items };
}

const PARAMS = {
  buyerId: "buyer_1",
  depositId: "dep_1",
  reviewToken: "rev-token-1",
  outsideDealerId: "outside_dealer_1",
};

test("happy path: mints CLOSED deposit-gated auction + VehicleRequest + offers from review items", async () => {
  const state: MockState = {
    existingAuction: null,
    review: review([
      reviewItem("it_outside", submission({ id: "sub_outside", dealerId: null })),
      reviewItem("it_real", submission({ id: "sub_real", dealerId: "dealer_real", vehicles: [{ offerPriceCents: 3835000 }] })),
    ]),
    vehicleRequestCreates: [],
    auctionCreates: [],
    offerCreates: [],
  };
  const res = await convertConciergeOfferToClosedAuction(makeTx(state), PARAMS);

  assert.equal(res.reused, false);
  assert.equal(res.offerIds.length, 2);
  assert.equal(res.skipped, 0);

  assert.equal(state.vehicleRequestCreates.length, 1);
  assert.equal(state.vehicleRequestCreates[0].buyerId, "buyer_1");
  assert.equal(state.vehicleRequestCreates[0].status, "OFFER_SENT");
  assert.equal(state.vehicleRequestCreates[0].maxBudgetCents, 3500000);

  assert.equal(state.auctionCreates.length, 1);
  const auc = state.auctionCreates[0];
  assert.equal(auc.status, "CLOSED");
  assert.equal(auc.depositId, "dep_1");
  assert.ok(auc.vehicleRequestId);
  assert.ok(auc.postCloseProcessedAt instanceof Date);
  assert.ok(auc.closedAt instanceof Date);
});

test("outside dealer → placeholder id + externalDealer*; real dealer → own id, no externalDealer*", async () => {
  const state: MockState = {
    existingAuction: null,
    review: review([
      reviewItem("it_o", submission({ id: "sub_outside", dealerId: null, dealershipName: "Outside LLC", contactEmail: "o@x.com", contactPhone: "111" })),
      reviewItem("it_r", submission({ id: "sub_real", dealerId: "dealer_real", vehicles: [{ offerPriceCents: 4000000 }] })),
    ]),
    vehicleRequestCreates: [],
    auctionCreates: [],
    offerCreates: [],
  };
  await convertConciergeOfferToClosedAuction(makeTx(state), PARAMS);

  const outside = state.offerCreates.find((o) => o.externalDealerName === "Outside LLC");
  assert.ok(outside, "outside offer present");
  assert.equal(outside!.dealerId, "outside_dealer_1");
  assert.equal(outside!.externalDealerEmail, "o@x.com");
  assert.equal(outside!.externalDealerPhone, "111");
  assert.equal(outside!.status, "SUBMITTED");
  assert.equal(outside!.otdPriceCents, 3450000);
  assert.equal(outside!.vehiclePriceCents, 3450000);
  assert.equal(outside!.taxCents, 0);
  assert.equal(outside!.feesCents, 0);
  assert.equal(outside!.includesFinancing, false);

  const real = state.offerCreates.find((o) => o.dealerId === "dealer_real");
  assert.ok(real, "real-dealer offer present");
  assert.equal(real!.externalDealerName, null);
  assert.equal(real!.externalDealerEmail, null);
  assert.equal(real!.externalDealerPhone, null);
  assert.equal(real!.otdPriceCents, 4000000);
});

test("prices the EXACT vehicleIndex the buyer was shown, not always vehicles[0]", async () => {
  const state: MockState = {
    existingAuction: null,
    review: review([
      reviewItem(
        "it_idx1",
        submission({
          id: "sub_multi",
          dealerId: "d1",
          vehicles: [{ offerPriceCents: 1000000 }, { offerPriceCents: 2222222 }, { offerPriceCents: 3000000 }],
        }),
        1, // buyer was shown vehicles[1]
      ),
    ]),
    vehicleRequestCreates: [],
    auctionCreates: [],
    offerCreates: [],
  };
  const res = await convertConciergeOfferToClosedAuction(makeTx(state), PARAMS);
  assert.equal(res.offerIds.length, 1);
  assert.equal(state.offerCreates[0].otdPriceCents, 2222222, "must price vehicles[1], not vehicles[0]");
  assert.equal(state.offerCreates[0].vehiclePriceCents, 2222222);
});

test("only the curated review items convert — submissions not in the review are excluded", async () => {
  // The VehicleOffer may have more submissions than the review curated; the
  // converter must NOT surface offers the buyer was never shown. Modeled by the
  // review carrying exactly one item even though other submissions exist.
  const state: MockState = {
    existingAuction: null,
    review: review([
      reviewItem("it_only", submission({ id: "sub_curated", dealerId: "d1", vehicles: [{ offerPriceCents: 500000 }] })),
    ]),
    vehicleRequestCreates: [],
    auctionCreates: [],
    offerCreates: [],
  };
  const res = await convertConciergeOfferToClosedAuction(makeTx(state), PARAMS);
  assert.equal(res.offerIds.length, 1);
  assert.equal(state.offerCreates[0].otdPriceCents, 500000);
});

test("idempotent: existing auction for deposit → reuse, no offers created", async () => {
  const state: MockState = {
    existingAuction: { id: "auc_existing", vehicleRequestId: "vr_existing", offers: [{ id: "off_a" }, { id: "off_b" }] },
    review: review([reviewItem("it_1", submission())]),
    vehicleRequestCreates: [],
    auctionCreates: [],
    offerCreates: [],
  };
  const res = await convertConciergeOfferToClosedAuction(makeTx(state), PARAMS);
  assert.equal(res.reused, true);
  assert.equal(res.auctionId, "auc_existing");
  assert.deepEqual(res.offerIds, ["off_a", "off_b"]);
  assert.equal(state.auctionCreates.length, 0);
  assert.equal(state.offerCreates.length, 0);
  assert.equal(state.vehicleRequestCreates.length, 0);
});

test("rejected submissions are skipped", async () => {
  const state: MockState = {
    existingAuction: null,
    review: review([
      reviewItem("it_ok", submission({ id: "ok", dealerId: "d1", vehicles: [{ offerPriceCents: 100 }] })),
      reviewItem("it_rej", submission({ id: "rej", rejected: true, vehicles: [{ offerPriceCents: 200 }] })),
    ]),
    vehicleRequestCreates: [],
    auctionCreates: [],
    offerCreates: [],
  };
  const res = await convertConciergeOfferToClosedAuction(makeTx(state), PARAMS);
  assert.equal(res.offerIds.length, 1);
  assert.equal(res.skipped, 1);
});

test("malformed / non-positive / out-of-range prices are skipped, not thrown", async () => {
  const state: MockState = {
    existingAuction: null,
    review: review([
      reviewItem("it_empty", submission({ id: "empty", vehicles: [] })),
      reviewItem("it_missing", submission({ id: "missing", vehicles: [{ make: "BMW" }] })),
      reviewItem("it_zero", submission({ id: "zero", vehicles: [{ offerPriceCents: 0 }] })),
      reviewItem("it_neg", submission({ id: "neg", vehicles: [{ offerPriceCents: -5 }] })),
      reviewItem("it_oor", submission({ id: "oor", vehicles: [{ offerPriceCents: 100 }] }), 3), // index out of range
      reviewItem("it_good", submission({ id: "good", vehicles: [{ offerPriceCents: 123456 }] })),
    ]),
    vehicleRequestCreates: [],
    auctionCreates: [],
    offerCreates: [],
  };
  const res = await convertConciergeOfferToClosedAuction(makeTx(state), PARAMS);
  assert.equal(res.offerIds.length, 1);
  assert.equal(res.skipped, 5);
  assert.equal(state.offerCreates[0].otdPriceCents, 123456);
});

test("missing BuyerOfferReview throws ConciergeConversionError", async () => {
  const state: MockState = {
    existingAuction: null,
    review: null,
    vehicleRequestCreates: [],
    auctionCreates: [],
    offerCreates: [],
  };
  await assert.rejects(
    () => convertConciergeOfferToClosedAuction(makeTx(state), PARAMS),
    ConciergeConversionError,
  );
});

test("extractOfferPriceCents handles shapes and index", () => {
  assert.equal(extractOfferPriceCents([{ offerPriceCents: 100 }]), 100);
  assert.equal(extractOfferPriceCents([{ offerPriceCents: 100 }, { offerPriceCents: 200 }], 1), 200);
  assert.equal(extractOfferPriceCents([{ offerPriceCents: 100 }], 1), null); // out of range
  assert.equal(extractOfferPriceCents([{ offerPriceCents: 100 }], -1), null);
  assert.equal(extractOfferPriceCents([]), null);
  assert.equal(extractOfferPriceCents(null), null);
  assert.equal(extractOfferPriceCents([{ offerPriceCents: 0 }]), null);
  assert.equal(extractOfferPriceCents([{ offerPriceCents: -1 }]), null);
  assert.equal(extractOfferPriceCents([{ offerPriceCents: 1.5 }]), null);
  assert.equal(extractOfferPriceCents([{ make: "x" }]), null);
  assert.equal(extractOfferPriceCents("nope"), null);
});

test("parseBudgetToCents best-effort parse", () => {
  assert.equal(parseBudgetToCents("35000"), 3500000);
  assert.equal(parseBudgetToCents("$35,000"), 3500000);
  assert.equal(parseBudgetToCents("35k"), 3500000);
  assert.equal(parseBudgetToCents("30k-35k"), 3000000);
  assert.equal(parseBudgetToCents(""), null);
  assert.equal(parseBudgetToCents(null), null);
  assert.equal(parseBudgetToCents("no number"), null);
});
