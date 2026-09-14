// §8.2 Phase 6 defects 2, 7 and 10 — what `submitOffer` validates and what it writes.
//
// `submitOffer` had NO test of any kind before this phase, which is how three of the ten defects
// came to live in one function:
//
//   (7) `assertWithinBuyerBudget` had two fail-open early returns — no auction row and no prequal
//       row each returned silently — and selected `decision` and `expiresAt` without ever reading
//       them. A DECLINED or long-expired approval authorised any price under a stale ceiling; a
//       buyer with no prequalification at all authorised ANY price.
//
//  (10) `offers.expires_at`, `auction_vehicle_id` and `rooftop_id` shipped in the Phase 1 wave
//       with no writer. With all three NULL, `offers_one_live_per_rooftop_candidate_key` — a
//       partial unique over exactly those columns — was INERT, because PostgreSQL treats NULLs as
//       distinct. §8b's caps existed in the schema and bound nothing.
//
//   (2) the admin path never reached any of this: it wrote straight to `prisma.offer.create`.
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/offer/__tests__/offer-submission.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { OFFER_VALIDITY_HOURS } from "@/lib/constants";

type Rec = Record<string, unknown>;

let auction: Rec | null;
let invitation: Rec | null;
let candidates: Rec[];
let liveOffers: Rec[];
let approval: Rec;
let created: Rec[];
let invitationUpdates: Rec[];

let requestCriteria: Rec | null;
let originalOffer: Rec | null;
let offerUpdates: Rec[];

const tx = {
  auctionInvitation: {
    findFirst: async () => invitation,
    update: async (a: Rec) => { invitationUpdates.push(a); return {}; },
  },
  auction: { findUnique: async () => auction },
  vehicleRequest: { findUnique: async () => requestCriteria },
  auctionVehicle: { findMany: async () => candidates },
  offer: {
    // HONOURS THE `where`. A fake that returned every seeded row regardless of scope would have
    // made the outside-dealership test below pass for the wrong reason — and answering by one key
    // while the service asks by another is the exact defect class this phase spent its
    // core-rule-11 budget on. `liveOffers` entries carry the scope keys they belong to.
    findMany: async ({ where }: { where: Rec }) =>
      liveOffers.filter((o) =>
        Object.entries(where).every(([k, v]) => {
          if (k === "auctionId" || k === "status") return true; // constant across the fixture
          return (o as Rec)[k] === v;
        }),
      ),
    create: async ({ data }: { data: Rec }) => {
      const row = { id: `off_${created.length + 1}`, ...data };
      created.push(row);
      return row;
    },
    findFirst: async () => originalOffer,
    update: async (a: Rec) => { offerUpdates.push(a); return {}; },
    // `reviseOffer`'s compare-and-swap: withdrawing the original IS the claim, and it happens
    // BEFORE the superseding row is inserted — because both now carry the scope columns the
    // partial unique index is over, so inserting first collides with the still-live original.
    // The real proof of that ordering is `__tests__/destructive/offer-revision-index.test.ts`,
    // which runs against a database that has the index; this fake only mirrors the contract.
    updateMany: async (a: Rec) => {
      const where = a.where as Rec;
      if (!originalOffer || originalOffer.id !== where.id || originalOffer.status === "WITHDRAWN") {
        return { count: 0 };
      }
      offerUpdates.push(a);
      originalOffer = { ...originalOffer, ...(a.data as Rec) };
      return { count: 1 };
    },
  },
  notification: { create: async () => ({}) },
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      ...tx,
      // The post-create tail runs OUTSIDE the transaction: it re-reads the auction, counts
      // SUBMITTED offers for the buyer's "N offers" notice, and — on the first offer only —
      // loads the buyer, deposit and vehicle for the first-offer email.
      offer: { ...tx.offer, count: async () => created.length },
      auctionVehicle: { ...tx.auctionVehicle, findFirst: async () => ({ make: "Honda", model: "Accord" }) },
      buyer: { findUnique: async () => ({ firstName: "Ada", user: { email: "ada@test.local" } }) },
      deposit: { findUnique: async () => ({ status: "PAID" }) },
      $transaction: async (fn: (c: typeof tx) => Promise<unknown>) => fn(tx),
    },
  },
});

mock.module("@/lib/services/prequal/approval-recheck", {
  namedExports: { recheckApproval: async () => approval },
});

mock.module("@/lib/services/offer/junk-fee.service", {
  namedExports: { classifyFeeItems: async () => [] },
});

mock.module("next/server", { namedExports: { after: () => {} } });
mock.module("@/lib/services/audit/dealer-audit.service", { namedExports: { writeDealerAudit: async () => {} } });
mock.module("@/lib/services/auction/anti-snipe.service", { namedExports: { maybeExtendForAntiSnipe: async () => {} } });
mock.module("@/lib/services/ghl/tag-sync", { namedExports: { syncGhlTag: () => {} } });
mock.module("@/lib/services/email/buyer-notifications.service", {
  namedExports: { sendFirstOfferReceivedEmail: async () => {} },
});

const AUCTION_ENDS = new Date(Date.now() + 3_600_000);

beforeEach(() => {
  auction = { id: "auc_1", status: "ACTIVE", endsAt: AUCTION_ENDS, buyerId: "b1", vehicleRequestId: "vr_1", depositId: "dep_1" };
  invitation = { id: "inv_1", rooftopId: "roof_1" };
  candidates = [
    {
      id: "cand_1", year: 2023, make: "Honda", model: "Accord", trim: "EX-L", mileage: 18_400,
      inventoryItem: {
        vin: "1HGCV1F30PA000001", year: 2023, make: "Honda", model: "Accord", trim: "EX-L",
        mileage: 18_400, condition: "used", exteriorColor: "Platinum White", interiorColor: "Black",
        features: ["Heated Seats", "Apple CarPlay", "Sunroof"],
      },
    },
    { id: "cand_2", year: 2022, make: "Toyota", model: "Camry", trim: null, mileage: null, inventoryItem: null },
  ];
  liveOffers = [];
  approval = { ok: true, approvedAmountCents: 4_000_000, expiresAt: new Date() };
  created = [];
  invitationUpdates = [];
  requestCriteria = { requiredFeatures: ["Heated Seats", "AWD"] };
  originalOffer = null;
  offerUpdates = [];
});

function base(over: Rec = {}): Rec {
  return {
    auctionId: "auc_1", dealerId: "d1",
    otdPriceCents: 3_000_000, vehiclePriceCents: 2_800_000, taxCents: 150_000, feesCents: 50_000,
    auctionVehicleId: "cand_1",
    ...over,
  };
}

async function submit(input: Rec = base()) {
  const { submitOffer } = await import("../offer.service");
  return submitOffer(input as never);
}

// ── DEFECT 7 — the approval ceiling, which used to fail open ────────────────────────────────────

test("a buyer with NO prequalification no longer authorises any price", async () => {
  // The old code did `if (!prequal) return;` — a silent pass. The verdict now comes from the same
  // helper every other gate uses, and a missing application is a disqualification with a reason.
  approval = { ok: false, reason: "NO_APPLICATION", message: "Complete your prequalification to continue." };
  await submit();
  assert.equal(created[0].isDisqualified, true, "an offer against a buyer with no approval was qualified");
  assert.match(String(created[0].disqualifiedReason), /prequalification/i);
});

test("a DECLINED or EXPIRED approval disqualifies — `decision` and `expiresAt` are finally read", async () => {
  approval = { ok: false, reason: "EXPIRED", message: "Your approval has expired. Renew it to continue — it only takes a minute." };
  await submit();
  assert.equal(created[0].isDisqualified, true);
  assert.match(String(created[0].disqualifiedReason), /expired/i);
});

test("a valid approval with NO ceiling disqualifies rather than meaning unlimited", async () => {
  approval = { ok: true, approvedAmountCents: null, expiresAt: new Date() };
  await submit();
  assert.equal(created[0].isDisqualified, true);
  assert.match(String(created[0].disqualifiedReason), /no approved amount/i);
});

// ── §13-D40 — over-ceiling is RECORDED, not rejected ────────────────────────────────────────────

test("an over-ceiling offer is RECORDED and flagged, never thrown away (§13-D40)", async () => {
  approval = { ok: true, approvedAmountCents: 2_000_000, expiresAt: new Date() };
  await assert.doesNotReject(() => submit(), "the ruling is record-and-disqualify, not reject at submit");
  assert.equal(created.length, 1, "the dealer's work was discarded");
  assert.equal(created[0].isDisqualified, true);
  assert.match(String(created[0].disqualifiedReason), /exceeds the buyer's approved amount of \$20,000/);
});

test("an offer within the ceiling is not flagged", async () => {
  await submit();
  assert.equal(created[0].isDisqualified, false);
  assert.equal(created[0].disqualifiedReason, null);
});

// ── DEFECT 10 — the Phase 1 columns finally get a writer ────────────────────────────────────────

test("the candidate binding, the rooftop and the expiry are all written", async () => {
  await submit();
  assert.equal(created[0].auctionVehicleId, "cand_1", "§8c: every offer binds to the candidate it answers");
  assert.equal(created[0].rooftopId, "roof_1", "the rooftop comes from the INVITATION, not the request body");
  // The expiry is a POLICY WINDOW opening at the CLOSE — never the close itself. See
  // `offer-expiry.test.ts`, which owns that rule and the reason the obvious default breaks
  // selection entirely.
  assert.equal(
    (created[0].expiresAt as Date).getTime(),
    AUCTION_ENDS.getTime() + OFFER_VALIDITY_HOURS * 3_600_000,
  );
});

test("a dealer cannot spend another rooftop's offer budget by naming one", async () => {
  // The invitation is §7's proof of which rooftop this dealer bids for. Taking the rooftop from
  // the request body would let one dealership consume another's cap.
  invitation = { id: "inv_1", rooftopId: "roof_TRUE" };
  await submit(base({ rooftopId: undefined }));
  assert.equal(created[0].rooftopId, "roof_TRUE");
});

test("an offer naming no candidate is refused when the auction HAS candidates", async () => {
  await assert.rejects(() => submit(base({ auctionVehicleId: undefined })), /must name the one it answers/);
  assert.equal(created.length, 0);
});

test("an offer naming a candidate that is not on this auction is refused", async () => {
  await assert.rejects(() => submit(base({ auctionVehicleId: "cand_OTHER" })), /not an active candidate/);
});

test("a CUSTOM REQUEST (no candidates) binds to null, not to an invented candidate", async () => {
  // §8c: "or to the criteria set on a custom request" — parity row C3b makes the column nullable
  // for exactly this. Requiring a binding unconditionally would refuse every offer against the
  // path §22a routes buyers to when qualified results are thin.
  candidates = [];
  await submit(base({ auctionVehicleId: undefined }));
  assert.equal(created[0].auctionVehicleId, null);
});

// ── §8b's two caps ──────────────────────────────────────────────────────────────────────────────

test("one live offer per rooftop per candidate", async () => {
  liveOffers = [{ id: "off_x", rooftopId: "roof_1", auctionVehicleId: "cand_1" }];
  await assert.rejects(() => submit(), /already have a live offer for this vehicle/);
});

test("a SECOND candidate from the same rooftop is allowed — the cap is per candidate", async () => {
  liveOffers = [{ id: "off_x", rooftopId: "roof_1", auctionVehicleId: "cand_1" }];
  await submit(base({ auctionVehicleId: "cand_2" }));
  assert.equal(created.length, 1);
});

test("three live offers per rooftop is the cap", async () => {
  liveOffers = [
    { id: "a", rooftopId: "roof_1", auctionVehicleId: "c1" },
    { id: "b", rooftopId: "roof_1", auctionVehicleId: "c2" },
    { id: "c", rooftopId: "roof_1", auctionVehicleId: "c3" },
  ];
  await assert.rejects(() => submit(), /at most 3 live offers/);
});

// ── DEFECT 2 — staff intake, and the obstacle that made it impossible before ────────────────────

test("staff intake may submit without an invitation; every other validation still applies", async () => {
  invitation = null;
  await assert.rejects(() => submit(), /not invited/, "the dealer path must still require an invitation");

  await submit(base({ allowWithoutInvitation: true, submittedByAdminId: "adm_1" }));
  assert.equal(created[0].submittedByAdminId, "adm_1");
  assert.equal(invitationUpdates.length, 0, "there was no invitation to stamp");
});

test("staff intake is NOT a validation bypass — an expired auction is still refused", async () => {
  auction = { ...auction!, endsAt: new Date(Date.now() - 1000) };
  await assert.rejects(
    () => submit(base({ allowWithoutInvitation: true })),
    /Auction has expired/,
    "allowWithoutInvitation must open exactly one hole, not all of them",
  );
});

test("TWO OUTSIDE DEALERSHIPS can bid on one auction — the cap keys on their email", async () => {
  // Every outside offer is written against ONE shared placeholder dealer id, so a dealer-keyed cap
  // told the second outside dealership "you have already submitted an offer for this auction".
  // This is the obstacle that made routing the admin path through `submitOffer` impossible before,
  // and it is the normal case for an outside-invite auction.
  invitation = null;
  // The FIRST outside dealership's live offer, carrying ITS email. The second must not collide.
  liveOffers = [{ id: "off_first", externalDealerEmail: "first@dealership.test", auctionVehicleId: "cand_1" }];
  await submit(base({
    allowWithoutInvitation: true,
    rooftopId: null,
    externalDealerEmail: "second@dealership.test",
    auctionVehicleId: "cand_1",
  }));
  assert.equal(created.length, 1, "the second outside dealership was refused as a duplicate of the first");
  assert.equal(created[0].externalDealerEmail, "second@dealership.test");
});

// ── THE REVISION PATH — every identifying column was dropped ────────────────────────────────────

test("a revision carries the candidate, rooftop, outside identity and expiry forward", async () => {
  // A revision is a NEW `offers` row that supersedes the original, and it wrote only the money.
  // Four things broke at once on the surviving row:
  //
  //   auctionVehicleId  §8c's candidate binding — the dealer dropped out of the candidate they bid on
  //   rooftopId         §8b's caps, and `offers_one_live_per_rooftop_candidate_key` went INERT again
  //                     (both columns NULL, and PostgreSQL treats NULLs as distinct), so the rooftop
  //                     could then submit a SECOND live offer for the same vehicle
  //   external*         an OUTSIDE dealership's only identity — erased from the buyer's report
  //   expiresAt         §8a's required field, dropped entirely
  const EXPIRY = new Date(AUCTION_ENDS.getTime() + 72 * 3_600_000);
  originalOffer = {
    id: "off_orig",
    auctionId: "auc_1",
    dealerId: "d1",
    version: 1,
    otdPriceCents: 3_000_000,
    vehiclePriceCents: 2_800_000,
    taxCents: 150_000,
    feesCents: 50_000,
    junkFeeItems: [],
    includesFinancing: false,
    aprRate: null,
    termMonths: null,
    auctionVehicleId: "cand_1",
    rooftopId: "roof_1",
    submittedByAdminId: "adm_9",
    externalDealerName: "Outside Motors",
    externalDealerEmail: "sales@outside.test",
    externalDealerPhone: "+15550100",
    expiresAt: EXPIRY,
    status: "SUBMITTED",
  };

  const { reviseOffer } = await import("../offer.service");
  await reviseOffer("off_orig", "d1", { otdPriceCents: 2_900_000, vehiclePriceCents: 2_700_000 } as never);

  assert.equal(created.length, 1);
  const rev = created[0];
  assert.equal(rev.auctionVehicleId, "cand_1", "the revision lost its candidate binding");
  assert.equal(rev.rooftopId, "roof_1", "the revision lost its rooftop — the §8b cap stops binding");
  assert.equal(rev.submittedByAdminId, "adm_9");
  assert.equal(rev.externalDealerName, "Outside Motors");
  assert.equal(rev.externalDealerEmail, "sales@outside.test", "an outside dealership lost its identity");
  assert.equal(rev.externalDealerPhone, "+15550100");
  assert.deepEqual(rev.expiresAt, EXPIRY, "the revision inherited no expiry at all");
  assert.equal(rev.version, 2);
  // ...and the original is still withdrawn, so the cap counts one live offer, not two.
  assert.equal((offerUpdates[0].data as Rec).status, "WITHDRAWN");
});

test("a revision cannot extend its own validity past the window the auction gave", async () => {
  // Re-derived from the auction rather than pushed forward on every revise: a dealer who revised
  // three times would otherwise hold an offer alive long after its competitors lapsed.
  originalOffer = {
    id: "off_orig", auctionId: "auc_1", dealerId: "d1", version: 1,
    otdPriceCents: 3_000_000, vehiclePriceCents: 2_800_000, taxCents: 150_000, feesCents: 50_000,
    junkFeeItems: [], includesFinancing: false, aprRate: null, termMonths: null,
    auctionVehicleId: "cand_1", rooftopId: "roof_1",
    submittedByAdminId: null, externalDealerName: null, externalDealerEmail: null, externalDealerPhone: null,
    expiresAt: null,
  };
  const { reviseOffer } = await import("../offer.service");
  await reviseOffer("off_orig", "d1", { otdPriceCents: 2_900_000, vehiclePriceCents: 2_700_000 } as never);
  assert.equal(
    (created[0].expiresAt as Date).getTime(),
    AUCTION_ENDS.getTime() + OFFER_VALIDITY_HOURS * 3_600_000,
    "a legacy row with no expiry must get the same window every other offer on this auction has",
  );
});

// ── A2b / A17b — the vehicle snapshot and the required-feature match ────────────────────────────

test("the vehicle snapshot is prefilled from the candidate the offer answers (A2b)", async () => {
  // Nine Phase 1 columns describing WHICH CAR an offer is for, and the dealer form posts money
  // only — so the buyer's report compared four prices with no way to tell whether they were for
  // the same vehicle, and a Deal's lineage recorded a VIN it never captured.
  await submit();
  const o = created[0];
  assert.equal(o.vin, "1HGCV1F30PA000001");
  assert.equal(o.vehicleYear, 2023);
  assert.equal(o.vehicleMake, "Honda");
  assert.equal(o.vehicleModel, "Accord");
  assert.equal(o.vehicleTrim, "EX-L");
  assert.equal(o.odometer, 18_400);
  assert.equal(o.vehicleCondition, "used");
  assert.equal(o.exteriorColor, "Platinum White");
  assert.equal(o.interiorColor, "Black");
});

test("what the submitter states always beats the listing", async () => {
  // A dealership offering a different trim, or a car whose odometer has moved since the feed last
  // saw it, must be able to say so — the prefill is a convenience, not an override.
  await submit(base({ vehicleTrim: "Sport", odometer: 21_000, stockNumber: "A-4417" }));
  assert.equal(created[0].vehicleTrim, "Sport");
  assert.equal(created[0].odometer, 21_000);
  assert.equal(created[0].stockNumber, "A-4417", "a dealer's own stock number has no source but the dealer");
});

test("a candidate with no listing yields its own year/make/model and nothing invented", async () => {
  await submit(base({ auctionVehicleId: "cand_2" }));
  const o = created[0];
  assert.equal(o.vehicleMake, "Toyota");
  assert.equal(o.vin, null, "a VIN was invented for a candidate that has no listing");
  assert.equal(o.exteriorColor, null);
});

test("the required-feature match is computed and persisted (A17b)", async () => {
  // §8c's tie-break reads this. Both columns shipped in the Phase 1 wave with no writer, so its
  // second key — "then best required-feature match" — had nothing to read.
  await submit();
  assert.deepEqual(created[0].requiredFeatureMatches, ["Heated Seats"]);
  assert.deepEqual(created[0].requiredFeatureMismatches, ["AWD"]);
});

test("an unknown feature list persists NULL, not a full sheet of mismatches", async () => {
  // `InventoryItem.features` defaults to `[]`, so a feed that publishes none would otherwise mark
  // every required feature a mismatch and bottom out that dealership for someone else's data gap.
  await submit(base({ auctionVehicleId: "cand_2" }));
  assert.equal(created[0].requiredFeatureMatches, null);
  assert.equal(created[0].requiredFeatureMismatches, null);
});

test("a revision keeps the vehicle it was for", async () => {
  // A revision changes the price, not the car. Recomputing the match would let a listing edited
  // mid-auction rewrite the record of what was offered.
  originalOffer = {
    id: "off_orig", auctionId: "auc_1", dealerId: "d1", version: 1,
    otdPriceCents: 3_000_000, vehiclePriceCents: 2_800_000, taxCents: 150_000, feesCents: 50_000,
    junkFeeItems: [], includesFinancing: false, aprRate: null, termMonths: null,
    auctionVehicleId: "cand_1", rooftopId: "roof_1",
    submittedByAdminId: null, externalDealerName: null, externalDealerEmail: null, externalDealerPhone: null,
    expiresAt: null,
    vin: "1HGCV1F30PA000001", stockNumber: "A-1", vehicleYear: 2023, vehicleMake: "Honda",
    vehicleModel: "Accord", vehicleTrim: "EX-L", odometer: 18_400, vehicleCondition: "used",
    exteriorColor: "Platinum White", interiorColor: "Black",
    requiredFeatureMatches: ["Heated Seats"], requiredFeatureMismatches: ["AWD"],
    status: "SUBMITTED",
  };
  const { reviseOffer } = await import("../offer.service");
  await reviseOffer("off_orig", "d1", { otdPriceCents: 2_900_000, vehiclePriceCents: 2_700_000 } as never);
  assert.equal(created[0].vin, "1HGCV1F30PA000001");
  assert.equal(created[0].odometer, 18_400);
  assert.deepEqual(created[0].requiredFeatureMatches, ["Heated Seats"]);
  assert.deepEqual(created[0].requiredFeatureMismatches, ["AWD"]);
});
