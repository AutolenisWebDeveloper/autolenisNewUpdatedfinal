// POST /api/buyer/pickup/[dealId]/release-code — the buyer reveals their pickup code.
//
// WHY THE ROUTE EXISTS. The buyer's QR used to be a column (`pickups.qr_code_image`) rendered
// server-side on every load of /buyer/pickup. That image was `QRCode.toDataURL(rawToken)`, so it
// decoded back to the credential — the column WAS the code, and hashing the token while keeping
// the image would have passed every other test this change names. Migration 20261201000000
// clears it, so the capability MOVES: the buyer still shows a code at the lot, produced at the
// moment they ask, which is now the only moment it can be produced.
//
// WHAT IS PINNED HERE. The two things that make it safe rather than merely different: the
// ownership check runs before anything is minted, and the response carries the IMAGE and the
// EXPIRY and nothing else — a raw token in the JSON would put the credential back in a place
// that gets logged, cached and copied into a support ticket.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/buyer/pickup/__tests__/release-code-route.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface Ctrl {
  buyer: { id: string } | null;
  deal: Record<string, unknown> | null;
  dealWheres: Array<Record<string, unknown>>;
  reissueReturns: { image: string; expiresAt: Date } | null;
  reissuedDealIds: string[];
}
let ctrl: Ctrl;

mock.module("@/lib/auth/api", {
  namedExports: {
    getRequestBuyer: async () => ctrl.buyer,
    successResponse: (data: unknown) => ({ __kind: "success", data }),
    errorResponse: (code: string, message: string, status: number) => ({ __kind: "error", code, message, status }),
  },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      deal: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          ctrl.dealWheres.push(where);
          return ctrl.deal;
        },
      },
    },
  },
});

mock.module("@/lib/services/pickup/pickup.service", {
  namedExports: {
    reissueReleaseCode: async (dealId: string) => {
      ctrl.reissuedDealIds.push(dealId);
      return ctrl.reissueReturns;
    },
  },
});

async function loadPOST() {
  return (await import("@/app/api/buyer/pickup/[dealId]/release-code/route")).POST;
}
const params = Promise.resolve({ dealId: "deal_1" });
const req = {} as unknown as Parameters<Awaited<ReturnType<typeof loadPOST>>>[0];

beforeEach(() => {
  ctrl = {
    buyer: { id: "buyer_1" },
    deal: { id: "deal_1", offer: { dealerId: "dlr_1" }, pickup: { status: "SCHEDULED" } },
    dealWheres: [],
    reissueReturns: { image: "data:image/png;base64,AAAA", expiresAt: new Date("2026-09-23T03:00:00.000Z") },
    reissuedDealIds: [],
  };
});

test("an unauthenticated caller mints nothing", async () => {
  ctrl.buyer = null;
  const POST = await loadPOST();
  const res = (await POST(req, { params })) as unknown as { __kind: string; status: number };
  assert.equal(res.__kind, "error");
  assert.equal(res.status, 401);
  assert.deepEqual(ctrl.reissuedDealIds, []);
});

test("ownership is scoped in the WHERE, not compared after the read", async () => {
  // A deal that is not this buyer's must be indistinguishable from one that does not exist. A
  // post-hoc `deal.buyerId !== buyer.id` comparison gives the same answer and leaves the row —
  // and everything joined to it — loaded in the process.
  const POST = await loadPOST();
  await POST(req, { params });
  assert.deepEqual(ctrl.dealWheres, [{ id: "deal_1", buyerId: "buyer_1" }]);
});

test("another buyer's deal is a 404 and mints nothing", async () => {
  ctrl.deal = null;
  const POST = await loadPOST();
  const res = (await POST(req, { params })) as unknown as { __kind: string; status: number };
  assert.equal(res.status, 404);
  assert.deepEqual(ctrl.reissuedDealIds, [], "the gate must run before the mint, not beside it");
});

test("a CONCIERGE deal is refused — a code with no reader is not a code", async () => {
  // No Offer means no dealer identity anywhere, so no dealer account could ever scan it. The
  // pickup page already says this in words; the route must not quietly hand out a credential
  // that contradicts it.
  ctrl.deal = { id: "deal_1", offer: null, pickup: { status: "SCHEDULED" } };
  const POST = await loadPOST();
  const res = (await POST(req, { params })) as unknown as { __kind: string; code: string; status: number };
  assert.equal(res.status, 409);
  assert.equal(res.code, "NO_DEALER_ON_DEAL");
  assert.deepEqual(ctrl.reissuedDealIds, []);
});

test("a deal with no pickup at all is refused before the service is asked", async () => {
  ctrl.deal = { id: "deal_1", offer: { dealerId: "dlr_1" }, pickup: null };
  const POST = await loadPOST();
  const res = (await POST(req, { params })) as unknown as { code: string; status: number };
  assert.equal(res.status, 409);
  assert.equal(res.code, "NOT_READY_FOR_PICKUP");
  assert.deepEqual(ctrl.reissuedDealIds, []);
});

test("a refusal from the token service NAMES the state it found", async () => {
  // "Not ready" alone is what a buyer reads as "this is broken". Naming the state is the
  // difference between that and "the dealership hasn't confirmed your time yet".
  ctrl.deal = { id: "deal_1", offer: { dealerId: "dlr_1" }, pickup: { status: "DEALER_COUNTERED" } };
  ctrl.reissueReturns = null;
  const POST = await loadPOST();
  const res = (await POST(req, { params })) as unknown as { code: string; message: string; status: number };
  assert.equal(res.status, 409);
  assert.equal(res.code, "NOT_READY_FOR_PICKUP");
  assert.match(res.message, /dealer countered/i);
});

test("a successful reveal returns the image and the expiry — and NOTHING else", async () => {
  // THE OMISSION THAT MATTERS. A raw token in this payload would sit in browser history, proxy
  // logs, and the support ticket the buyer pastes it into. The credential travels as pixels.
  const POST = await loadPOST();
  const res = (await POST(req, { params })) as unknown as { __kind: string; data: Record<string, unknown> };
  assert.equal(res.__kind, "success");
  assert.deepEqual(Object.keys(res.data).sort(), ["expiresAt", "releaseCodeImage"]);
  assert.equal(res.data.releaseCodeImage, "data:image/png;base64,AAAA");
  assert.equal(res.data.expiresAt, "2026-09-23T03:00:00.000Z");
  assert.deepEqual(ctrl.reissuedDealIds, ["deal_1"]);
});

test("no response body ever carries a raw token or a hash, on any path", async () => {
  const POST = await loadPOST();
  const bodies: unknown[] = [];
  for (const deal of [
    { id: "deal_1", offer: { dealerId: "dlr_1" }, pickup: { status: "SCHEDULED" } },
    { id: "deal_1", offer: null, pickup: { status: "SCHEDULED" } },
    { id: "deal_1", offer: { dealerId: "dlr_1" }, pickup: null },
    null,
  ]) {
    ctrl.deal = deal;
    bodies.push(await POST(req, { params }));
  }
  const serialized = JSON.stringify(bodies);
  for (const forbidden of ["rawToken", "tokenHash", "token_hash", "qrCodeData"]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} must never reach the buyer's browser`);
  }
});
