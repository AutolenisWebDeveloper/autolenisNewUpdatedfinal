// §9 / parity row S16 — A CLOSED REQUEST WITH NO SELECTION DOES NOT AUTO-REFUND.
//
// S16 is marked ALREADY CORRECT / PRESERVED STRONGER SAFEGUARD, and its required work is exactly
// this: an assertion that nothing on the decline path moves money. The safeguard is a property of
// what the route does NOT do, which is the kind that disappears silently — a future "refund the
// buyer when they decline" would look like a kindness and pass every other test in the repository.
//
// §23.1 makes every refund a manual, reviewed request. The route records the REQUEST and raises an
// admin alert; the deposit stays PAID until an administrator deliberately issues a refund.
//
//   npx tsx --test --experimental-test-module-mocks \
//     app/api/buyer/auctions/__tests__/decline-no-refund.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/dist/server/web/spec-extension/request";

type Rec = Record<string, unknown>;

let auction: Rec | null;
let depositWrites: Rec[];
let offerUpdates: Rec[];
let notifications: Rec[];
let stripeCalls: string[];

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      auction: {
        findFirst: async () => auction,
        update: async () => ({}),
        updateMany: async () => ({ count: 1 }),
      },
      // Every deposit mutation is captured. The assertions below are that this stays EMPTY.
      deposit: {
        update: async (a: Rec) => { depositWrites.push(a); return {}; },
        updateMany: async (a: Rec) => { depositWrites.push(a); return { count: 0 }; },
      },
      offer: { updateMany: async (a: Rec) => { offerUpdates.push(a); return { count: 1 }; } },
      notification: { create: async (a: Rec) => { notifications.push((a as { data: Rec }).data); return {}; } },
      auditLog: { create: async () => ({}) },
      queueItem: { create: async () => ({}), findFirst: async () => null },
    },
  },
});

mock.module("@/lib/auth/api", {
  namedExports: {
    getRequestBuyer: async () => ({ id: "b1" }),
    successResponse: (data: unknown) => Response.json({ success: true, data }),
    errorResponse: (code: string, message: string, status: number) =>
      Response.json({ success: false, error: { code, message } }, { status }),
  },
});

// If the route ever reached Stripe, this records it rather than failing on a missing key.
mock.module("@/lib/stripe", {
  namedExports: {
    getStripe: () => ({
      refunds: { create: async () => { stripeCalls.push("refunds.create"); return {}; } },
      paymentIntents: { cancel: async () => { stripeCalls.push("paymentIntents.cancel"); return {}; } },
    }),
  },
});

beforeEach(() => {
  auction = {
    id: "auc_1",
    buyerId: "b1",
    // ACTIVE, because the route refuses a CLOSED or CANCELLED auction with 409. That is worth
    // knowing here: the decline path covers a buyer ending a LIVE auction, and does NOT cover the
    // post-close "offers lapsed without a selection" case at all — which is precisely why §9's
    // S15 sweep exists rather than being folded into this route.
    status: "ACTIVE",
    deposit: { id: "dep_1", status: "PAID" },
  };
  depositWrites = [];
  offerUpdates = [];
  notifications = [];
  stripeCalls = [];
});

async function decline() {
  const { POST } = await import("../[auctionId]/decline/route");
  const req = new NextRequest("http://localhost/api/buyer/auctions/auc_1/decline", {
    method: "POST",
    body: JSON.stringify({ reason: "none of these work for me" }),
    headers: { "content-type": "application/json" },
  });
  const res = await POST(req, { params: Promise.resolve({ auctionId: "auc_1" }) });
  return { status: res.status, json: (await res.json()) as Rec };
}

test("declining every offer moves NO money", async () => {
  const { status } = await decline();
  assert.equal(status, 200);
  assert.deepEqual(depositWrites, [], "the decline path wrote to a deposit");
  assert.deepEqual(stripeCalls, [], "the decline path called Stripe");
});

test("the deposit is left PAID — a refund is an administrator's deliberate act", async () => {
  await decline();
  const touchedStatus = depositWrites.some((w) => {
    const data = (w as { data?: Rec }).data ?? {};
    return "status" in data || "refundedAt" in data;
  });
  assert.equal(touchedStatus, false, "the decline path changed a deposit's status or refund stamp");
});

test("the buyer is told the refund is a REVIEWED REQUEST, never an automatic reversal", async () => {
  // The safeguard is only honest if the copy matches it. A buyer told "your refund is on its way"
  // by a route that refunds nothing is worse off than one told the truth.
  await decline();
  const body = JSON.stringify(notifications);
  assert.equal(
    /refund (has been|was) (issued|processed|sent)|we have refunded|on its way/i.test(body),
    false,
    "the decline copy promises a refund the route does not perform",
  );
});

test("a buyer with no settled deposit declines without any money path at all", async () => {
  auction = { ...auction!, deposit: null };
  assert.equal((await decline()).status, 200);
  assert.deepEqual(depositWrites, []);
  assert.deepEqual(stripeCalls, []);
});
