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
// §28.3 #3 — the conditional close. `auctionCasArgs` captures what the guard actually
// asked for and `auctionCasCount` is how many rows it moved, so both the predicate and
// the lost-race branch are assertable. `auctionUpdateCalls` must stay EMPTY: an
// unconditional `auction.update` by id is the defect itself, and a revert to it has to
// fail here rather than pass quietly.
let auctionCasArgs: Rec[];
let auctionCasCount: number;
let auctionUpdateCalls: Rec[];

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      auction: {
        findFirst: async () => auction,
        update: async (a: Rec) => { auctionUpdateCalls.push(a); return {}; },
        updateMany: async (a: Rec) => { auctionCasArgs.push(a); return { count: auctionCasCount }; },
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
  auctionCasArgs = [];
  auctionCasCount = 1;
  auctionUpdateCalls = [];
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

// ── §28.3 #3 — the close is CONDITIONAL, and it is `closeAuction`'s ─────────────────
//
// Ruled by the owner at Phase 10 STOP 2: the decline route was a fourth instance of the
// unconditional-write defect the phase was already fixing in the admin action, pause and
// resume, so it ships with them rather than as a follow-up.
//
// The harm is specific. §24's cancellation writes `status: "CANCELLED"`; a check-then-act
// close rewrites that as CLOSED, and the dealership's history then says the auction ran its
// course when AutoLenis withdrew it.

test("§28.3 #3 — the close GUARDS on the status it observed, never on the id alone", async () => {
  await decline();

  assert.equal(auctionUpdateCalls.length, 0, "the route used an unconditional `auction.update` by id");
  assert.equal(auctionCasArgs.length, 1, "exactly one conditional close");

  const where = (auctionCasArgs[0] as { where?: Rec }).where ?? {};
  const status = where.status as { in?: string[] } | undefined;
  assert.deepEqual(
    status?.in,
    ["PENDING", "ACTIVE", "REOPENED"],
    "the predicate must be the OWNED liveness list — every live status a close may move FROM, and no terminal one",
  );
});

test("a REOPENED auction is still declinable — the guard must not remove a capability", async () => {
  // FOUND BY THE FIRST REVIEW OF THIS CHANGE, before it shipped. `closeAuction`'s predicate was a
  // hand-written `[PENDING, ACTIVE]`, which omits REOPENED — a live status written by a live admin
  // action (`app/api/admin/auctions/[auctionId]/action/route.ts:301`). The old unconditional write
  // closed a reopened auction; a literal-list guard would have answered 409 instead, removing the
  // capability silently. `app/api/admin/auctions/route.ts:44-50` records this exact omission
  // happening once before, which is why the list lives in `deposit-auction.ts` and not in each
  // reader.
  auction = { ...auction!, status: "REOPENED" };

  const { status } = await decline();

  assert.equal(status, 200, "a buyer could not decline a reopened auction");
  assert.equal(auctionCasArgs.length, 1);
  assert.equal(offerUpdates.length, 1, "the offers on a reopened auction were not declined");
});

test("the three TERMINAL statuses are NOT in the predicate — that is the §24 protection", async () => {
  await decline();
  const where = (auctionCasArgs[0] as { where?: Rec }).where ?? {};
  const inList = (where.status as { in?: string[] } | undefined)?.in ?? [];
  for (const terminal of ["CLOSED", "EXPIRED", "CANCELLED"]) {
    assert.equal(
      inList.includes(terminal),
      false,
      `${terminal} is in the close predicate — a ${terminal} auction can be rewritten as CLOSED`,
    );
  }
});

test("a CANCELLED auction cannot be rewritten as CLOSED by a decline that lost the race", async () => {
  // The read-side check passed (the auction was ACTIVE when it was read) and §24 cancelled it
  // in between, so the guard matches nothing. THIS is the case the old code got wrong: it
  // reported a close it had not performed, over a status nobody observed.
  auctionCasCount = 0;

  const { status, json } = await decline();

  assert.equal(status, 409, "a lost race is refused, not reported as a close");
  assert.equal(((json.error as Rec)?.code as string), "ALREADY_CLOSED");
  assert.deepEqual(offerUpdates, [], "offers were declined against an auction this call did not close");
  assert.deepEqual(notifications, [], "the buyer was told an auction closed when it had not");
  assert.deepEqual(depositWrites, [], "a lost race must still move no money");
});

test("the ordinary already-closed read still answers 409 before any write is attempted", async () => {
  // The read-side check is not redundant with the guard: it answers the common case without
  // a write at all, and it is what makes the 409 cheap.
  auction = { ...auction!, status: "CANCELLED" };

  const { status } = await decline();

  assert.equal(status, 409);
  assert.deepEqual(auctionCasArgs, [], "a known-terminal auction must not reach the close at all");
  assert.deepEqual(auctionUpdateCalls, []);
});

test("an EXPIRED auction is refused in its OWN words, not as \"already closed\"", async () => {
  // FOUND BY THE SECOND REVIEW. The guard correctly refuses EXPIRED — it is terminal, and
  // rewriting it as CLOSED erases the fact that the window lapsed without close processing. But
  // the refusal it would otherwise have produced said "Auction is already closed", which is a
  // different thing and sends the buyer looking for offers nobody ranked. Before the guard this
  // route force-closed an EXPIRED auction, so the wrong message is a consequence of this change
  // and belongs to it.
  auction = { ...auction!, status: "EXPIRED" };

  const { status, json } = await decline();

  assert.equal(status, 409);
  assert.equal((json.error as Rec)?.code, "AUCTION_EXPIRED", "the refusal must name the state it found");
  assert.match(String((json.error as Rec)?.message), /expired without closing/i);
  assert.deepEqual(auctionCasArgs, [], "a terminal auction must not reach the close at all");
  assert.deepEqual(offerUpdates, []);
});
