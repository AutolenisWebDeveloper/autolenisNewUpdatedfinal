// §13-D59 — ONE live Deal per Vehicle Request, enforced on the auction path too.
//
// THE GAP. `commitOfferSelection` serialises on the AUCTION row (`SELECT id FROM auctions
// WHERE id = $1 FOR UPDATE`) and then re-checks for an already-`ACCEPTED` offer on THAT
// auction. Both are auction-scoped. Neither is a check on the Vehicle Request — and a request
// is one-to-many with BOTH deals and auctions (`VehicleRequest.deals Deal[]`,
// `VehicleRequest.auctions Auction[]`, both FKs non-unique, no UNIQUE index on
// `deals.vehicle_request_id`). So two selections on one request, through two auctions, each
// produced a Deal.
//
// The CONCIERGE path already guards this — `app/api/buyer/requests/[requestId]/offer/respond/
// route.ts:71-86`, whose own comment names the case: "it did nothing about accepting a
// DIFFERENT offer on the same request, which is the case that produced two competing Deals."
// The auction path had no such guard at all.
//
// WHY IT MATTERS BEYOND TIDINESS. `upgrade-window.service.ts:113` closes the $400 Premium
// window on `findFirst({ vehicleRequestId, fundingClearedAt: { not: null } })` — matching the
// REQUEST, not the deal. The owner ruled that reader CORRECT: §23.2 closes the window because
// the request is ending. Which makes a second deal on one request the actual defect, and this
// the place to refuse it.
//
// SCOPE. This is the four-line application guard the owner authorised alongside §13-D59. The
// durable fix is a partial unique index in the style of Phase 1's one-open-request index, and
// it stays recorded in D59 for Phase 10 rather than scoped mid-phase. The concierge path's
// pre-check also still sits OUTSIDE its transaction; that too stays in D59.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/deal/__tests__/select-offer-one-deal-per-request.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface Ctrl {
  /** The Deal the guard should find. null = no existing deal for the request. */
  existingDealForRequest: { id: string } | null;
  /** The auction's request id; null exercises an auction with no request lineage. */
  vehicleRequestId: string | null;
  dealCreates: number;
  dealFindFirstWheres: Array<Record<string, unknown>>;
}
let ctrl: Ctrl;

const tx = {
  $queryRaw: async () => [{ id: "auc_1" }],
  offer: {
    findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      // Two call sites discriminated by status: the race re-check looks for ACCEPTED, the
      // lineage read looks for the SUBMITTED offer being selected.
      if (where.status === "ACCEPTED") return null;
      return {
        id: "off_1", dealerId: "dlr_1", rooftopId: "rt_1", vin: "VIN123",
        otdPriceCents: 3_000_000, auctionVehicleId: "av_1",
      };
    },
    update: async () => ({}),
    findMany: async () => [],
    updateMany: async () => ({ count: 0 }),
  },
  auction: {
    findFirst: async () => ({ id: "auc_1", depositId: "dep_1", vehicleRequestId: ctrl.vehicleRequestId }),
    update: async () => ({}),
  },
  deal: {
    findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      ctrl.dealFindFirstWheres.push(where);
      return ctrl.existingDealForRequest;
    },
    create: async () => { ctrl.dealCreates += 1; return { id: "deal_new" }; },
  },
  buyer: { findUnique: async () => ({ plan: "STANDARD" }) },
  vehicleRequest: { findUnique: async () => ({ id: "vr_1", coBuyers: [] }) },
  auctionVehicle: { findMany: async () => [], updateMany: async () => ({ count: 0 }) },
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: { $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx) },
  },
});
mock.module("@/lib/services/deal/deal-creation", { namedExports: { writeDealCreationRecord: async () => {} } });
mock.module("@/lib/services/comms/transactional-dispatcher.service", { namedExports: { cancelByKey: async () => {} } });
mock.module("@/lib/services/comms/state-recheck-registry", {
  namedExports: { selectionReminderCancelKey: () => "k", PHASE_8_TEMPLATES: {} },
});
mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

const mod = () => import("../select-offer.service");

beforeEach(() => {
  ctrl = {
    existingDealForRequest: null,
    vehicleRequestId: "vr_1",
    dealCreates: 0,
    dealFindFirstWheres: [],
  };
});

test("D59: a request that already has a Deal refuses a second selection", async () => {
  ctrl.existingDealForRequest = { id: "deal_existing" };
  const { commitOfferSelection, OfferSelectionRaceLostError } = await mod();

  await assert.rejects(
    () => commitOfferSelection({ buyerId: "buy_1", auctionId: "auc_1", offerId: "off_1" }),
    (err: unknown) => err instanceof OfferSelectionRaceLostError,
    "a second Deal on one Vehicle Request must be refused as a lost race, not created",
  );
  assert.equal(ctrl.dealCreates, 0, "no second Deal may be written for a request that already has one");
});

test("D59: the guard is scoped to the request, not the auction", async () => {
  // The pre-existing re-check is auction-scoped and would not have seen this. Pinning the
  // WHERE proves the new guard asks the question the defect is actually about.
  ctrl.existingDealForRequest = { id: "deal_existing" };
  const { commitOfferSelection } = await mod();
  await commitOfferSelection({ buyerId: "buy_1", auctionId: "auc_1", offerId: "off_1" }).catch(() => {});

  assert.deepEqual(
    ctrl.dealFindFirstWheres,
    [{ vehicleRequestId: "vr_1" }],
    "the guard must match on the Vehicle Request; an auction-scoped check is what already existed and missed this",
  );
});

test("D59: a request with no Deal still selects normally", async () => {
  const { commitOfferSelection } = await mod();
  const result = await commitOfferSelection({ buyerId: "buy_1", auctionId: "auc_1", offerId: "off_1" });

  assert.equal(result.dealId, "deal_new");
  assert.equal(ctrl.dealCreates, 1, "the guard must not block the first, legitimate selection");
});

test("D59: an auction with no vehicle request lineage is not blocked by the guard", async () => {
  // `Auction.vehicleRequestId` is nullable. A null must not be treated as a request that
  // every deal with a null request id belongs to — `findFirst({vehicleRequestId: null})`
  // would match the first lineage-less deal in the table and refuse every later selection.
  ctrl.vehicleRequestId = null;
  ctrl.existingDealForRequest = { id: "deal_existing" };
  const { commitOfferSelection } = await mod();

  const result = await commitOfferSelection({ buyerId: "buy_1", auctionId: "auc_1", offerId: "off_1" });
  assert.equal(result.dealId, "deal_new");
  assert.deepEqual(ctrl.dealFindFirstWheres, [], "the guard must not run at all without a request to scope it to");
});
