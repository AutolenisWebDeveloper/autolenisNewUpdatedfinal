// Route contract tests for POST /api/dealer/pickup/scan — the dealer QR check-in
// that completes a deal.
//
// Pins the authorization boundary and, critically, the CONCIERGE case: a
// vehicle-request (concierge) deal has offerId = null and VehicleRequestOffer
// carries NO dealer identity, so `deal.offer?.dealerId` is undefined. The strict
// `!== dealer.id` comparison therefore always rejects — correctly (there is no
// dealer to authorize) but previously with the misleading message "QR code is not
// valid for this dealer", which sends a real dealer chasing a permissions problem
// that does not exist. A dealer-less deal must be rejected TRUTHFULLY, and must
// still be completable through the admin pickup-completion route.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/dealer/pickup/__tests__/scan-route.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";

class InsuranceRequiredError extends Error {
  code = "INSURANCE_REQUIRED";
  constructor() { super("Insurance proof is required"); this.name = "InsuranceRequiredError"; }
}
class DealTransitionError extends Error {
  code = "INVALID_TRANSITION";
  constructor() { super("Invalid transition"); this.name = "DealTransitionError"; }
}

interface PickupRow {
  id: string;
  dealId: string;
  status: string;
  qrCodeData: string;
  qrExpiresAt: Date | null;
  deal: {
    status: string;
    buyerId: string;
    insuranceStatus: string;
    offer: { dealerId: string } | null;
    buyer: { firstName: string; user: { email: string } };
  };
}

let authedDealer: { id: string } | null = { id: "dealer_1" };
let pickupRow: PickupRow | null = null;
let advanceCalls: Array<{ dealId: string; to: string }> = [];
let advanceThrows: Error | null = null;
let txCalls = 0;

mock.module("@/lib/auth/dealer-api", {
  namedExports: {
    getRequestDealer: async () => authedDealer,
    successResponse: (data: unknown, status = 200) => NextResponse.json({ success: true, data }, { status }),
    errorResponse: (code: string, message: string, status = 400) =>
      NextResponse.json({ error: { code, message } }, { status }),
  },
});

mock.module("@/lib/logger", {
  namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      pickup: {
        findFirst: async () => (pickupRow ? { ...pickupRow } : null),
        update: async () => ({}),
      },
      buyerActivityEvent: { create: async () => ({}) },
      $transaction: async (ops: unknown[]) => { txCalls += 1; return ops; },
    },
  },
});

mock.module("@/lib/services/deal/deal.service", {
  namedExports: {
    INSURANCE_SATISFIED: ["VERIFIED", "POLICY_BOUND", "EXTERNAL_UPLOADED"],
    advanceDealStatus: async (dealId: string, to: string) => {
      if (advanceThrows) throw advanceThrows;
      advanceCalls.push({ dealId, to });
    },
    DealTransitionError,
    InsuranceRequiredError,
  },
});

const req = (qrToken?: string) =>
  new NextRequest("http://localhost/api/dealer/pickup/scan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(qrToken === undefined ? {} : { qrToken }),
  });

function dealerPickup(): PickupRow {
  return {
    id: "pickup_1",
    dealId: "deal_1",
    status: "SCHEDULED",
    qrCodeData: "tok_abc",
    qrExpiresAt: null,
    deal: {
      status: "PICKUP_SCHEDULED",
      buyerId: "b1",
      insuranceStatus: "VERIFIED",
      offer: { dealerId: "dealer_1" },
      buyer: { firstName: "Sam", user: { email: "sam@example.com" } },
    },
  };
}

/** A concierge deal: no Offer at all, therefore no dealer identity anywhere. */
function conciergePickup(): PickupRow {
  const p = dealerPickup();
  p.deal.offer = null;
  return p;
}

beforeEach(() => {
  authedDealer = { id: "dealer_1" };
  pickupRow = dealerPickup();
  advanceCalls = [];
  advanceThrows = null;
  txCalls = 0;
});

async function scan(token = "tok_abc") {
  const { POST } = await import("@/app/api/dealer/pickup/scan/route");
  return POST(req(token));
}

test("requires authentication (401)", async () => {
  authedDealer = null;
  const res = await scan();
  assert.equal(res.status, 401);
  assert.equal(advanceCalls.length, 0);
});

test("the owning dealer completes the deal on a valid scan", async () => {
  const res = await scan();
  assert.equal(res.status, 200);
  assert.deepEqual(advanceCalls, [{ dealId: "deal_1", to: "COMPLETED" }]);
});

test("another dealer's QR is rejected and completes nothing (IDOR blocked)", async () => {
  authedDealer = { id: "dealer_2" };
  const res = await scan();
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.error.code, "INVALID_TOKEN");
  assert.equal(advanceCalls.length, 0);
});

test("CONCIERGE deal (no dealer on the deal) can never be completed by a dealer scan", async () => {
  pickupRow = conciergePickup();
  const res = await scan();
  assert.equal(advanceCalls.length, 0, "a dealer must never complete a deal that has no dealer");
  assert.equal(txCalls, 0, "and must never mark the pickup row complete");
  assert.equal(res.status, 422);
  const body = await res.json();
  // Deliberately the SAME response as a wrong-dealer token: a distinguishable
  // "no dealer on this deal" answer, returned ahead of the ownership check, would
  // make this endpoint a state oracle for anyone holding a QR token. The concierge
  // distinction is logged server-side instead.
  assert.equal(body.error.code, "INVALID_TOKEN", "must not leak the dealer-less state to the caller");
  const wrongDealerBody = await (async () => {
    pickupRow = dealerPickup();
    authedDealer = { id: "dealer_2" };
    return (await scan()).json();
  })();
  assert.deepEqual(
    body.error,
    wrongDealerBody.error,
    "concierge and wrong-dealer rejections must be indistinguishable to the caller",
  );
});

test("insurance proof missing → 409, deal not completed", async () => {
  pickupRow!.deal.insuranceStatus = "NOT_STARTED";
  const res = await scan();
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error.code, "INSURANCE_REQUIRED");
  assert.equal(advanceCalls.length, 0);
});

test("insurance revoked between the pre-check and the advance → 409, not a 500", async () => {
  // TOCTOU: the pre-check passed, then the seam's hard gate rejected.
  advanceThrows = new InsuranceRequiredError();
  const res = await scan();
  assert.equal(res.status, 409, "the seam's insurance rejection must be mapped, not thrown as a 500");
  const body = await res.json();
  assert.equal(body.error.code, "INSURANCE_REQUIRED");
  assert.equal(txCalls, 0, "pickup must not be marked complete when the deal did not advance");
});

test("an illegal deal transition → 409 and the pickup row is not marked complete", async () => {
  advanceThrows = new DealTransitionError();
  const res = await scan();
  assert.equal(res.status, 409);
  assert.equal(txCalls, 0);
});

test("an already-scanned pickup is rejected (no double completion)", async () => {
  pickupRow!.status = "COMPLETED";
  const res = await scan();
  assert.equal(res.status, 409);
  assert.equal(advanceCalls.length, 0);
});

test("an expired QR is rejected", async () => {
  pickupRow!.qrExpiresAt = new Date(Date.now() - 1000);
  const res = await scan();
  assert.equal(res.status, 422);
  assert.equal(advanceCalls.length, 0);
});
