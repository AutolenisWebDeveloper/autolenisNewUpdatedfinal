// §9 / parity row S15 — EVERY OFFER LAPSED AND NOBODY SELECTED.
//
// "Non-selection → revalidation with dealerships or closure; buyer informed EITHER WAY."
//
// Before this the auction simply sat there. The offers went stale, `BUYER_DOES_NOT_SELECT` was in
// the §26 catalogue with `raisedByPhase: 6` and no raise site anywhere, and the buyer — who had
// paid $99 and been told their offers were ready — heard nothing at all. The QStash rail that was
// supposed to cover this sent "before it expires" copy against a column that had no writer.
//
// S16 IS PRESERVED AND ASSERTED HERE: a closed request with no selection does NOT auto-refund.
// §23.1 makes every refund a reviewed request, and a request that ends without a selection is not
// an exception to that. The sweep opens a case and tells the buyer; it moves no money.
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/auction/__tests__/unselected-sweep.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

type Rec = Record<string, unknown>;

let auctions: Rec[];
let offersByAuction: Record<string, Rec[]>;
let raised: Rec[];
let enqueued: Rec[];
let noChannel: Rec[];
let buyer: Rec | null;
let depositUpdates: Rec[];
let auctionFindArgs: Rec[];

function matches(o: Rec, where: Rec): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === "OR") {
      if (!(v as Rec[]).some((c) => matches(o, c))) return false;
      continue;
    }
    const actual = o[k];
    if (v !== null && typeof v === "object") {
      const cond = v as Rec;
      if ("gt" in cond && !(actual instanceof Date && actual.getTime() > (cond.gt as Date).getTime())) return false;
      continue;
    }
    if (actual !== v) return false;
  }
  return true;
}

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      auction: {
        findMany: async (args: Rec) => {
          auctionFindArgs.push(args);
          return auctions;
        },
      },
      offer: {
        count: async ({ where }: { where: Rec }) => {
          const rows = offersByAuction[String(where.auctionId)] ?? [];
          const rest = { ...where };
          delete rest.auctionId;
          return rows.filter((o) => matches(o, rest)).length;
        },
      },
      buyer: { findUnique: async () => buyer },
      // Present so a refund attempt would be VISIBLE rather than a crash — S16's assertion below
      // depends on this never being called.
      deposit: { update: async (a: Rec) => { depositUpdates.push(a); return {}; } },
    },
  },
});

/** Auction ids whose raise should throw, so the per-auction failure path can be exercised. */
let raiseFailsFor: Set<string>;
mock.module("@/lib/services/operations/queue-item.service", {
  namedExports: {
    raiseException: async (input: Rec) => {
      if (raiseFailsFor.has(String(input.auctionId))) throw new Error("queue unavailable");
      raised.push(input);
      return { item: {}, created: true };
    },
  },
});
mock.module("@/lib/services/comms/transactional-dispatcher.service", {
  namedExports: {
    enqueueTransactional: async (input: Rec) => { enqueued.push(input); return { enqueued: true, id: "co", dedupKey: "" }; },
    cancelByKey: async () => ({ cancelled: 0 }),
    raiseNoDeliverableChannel: async (input: Rec) => { noChannel.push(input); },
  },
});
mock.module("@/lib/services/auction/dealer-invitation.service", { namedExports: { releaseAuctionLoad: async () => {} } });
mock.module("@/lib/services/offer/best-price.service", {
  namedExports: { rankOffers: async () => [], getPersistedRanking: async () => null },
});
mock.module("@/lib/services/email/resend.service", {
  namedExports: { sendDealerAuctionClosedNoWinnerEmail: async () => {} },
});

const FUTURE = new Date(Date.now() + 24 * 3_600_000);

function auction(over: Rec = {}): Rec {
  return { id: "auc_1", buyerId: "b1", depositId: "dep_1", vehicleRequestId: "vr_1", ...over };
}

beforeEach(() => {
  auctions = [auction()];
  offersByAuction = { auc_1: [] };
  raised = [];
  enqueued = [];
  noChannel = [];
  buyer = { firstName: "Ada", user: { email: "ada@test.local" } };
  depositUpdates = [];
  auctionFindArgs = [];
  raiseFailsFor = new Set();
});

async function sweep() {
  const { sweepUnselectedAuctions } = await import("../auction.service");
  return sweepUnselectedAuctions();
}

// ── the case, and the notice ────────────────────────────────────────────────────────────────────

test("an auction with nothing left to choose raises the case AND tells the buyer", async () => {
  const n = await sweep();
  assert.equal(n, 1);

  assert.equal(raised.length, 1);
  assert.equal(raised[0].code, "BUYER_DOES_NOT_SELECT");
  assert.equal(raised[0].auctionId, "auc_1");
  assert.equal(raised[0].buyerId, "b1");
  assert.equal(raised[0].depositId, "dep_1", "an operator needs the deposit to answer the refund question");
  assert.equal(raised[0].vehicleRequestId, "vr_1");

  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].templateKey, "offers_expired_unselected");
  assert.equal(enqueued[0].idempotencyKey, "offers_expired_unselected:email:auc_1");
});

test("an auction with a LIVE offer left is a buyer still deciding, not a failure", async () => {
  offersByAuction.auc_1 = [{ status: "SUBMITTED", isDisqualified: false, expiresAt: FUTURE }];
  assert.equal(await sweep(), 0);
  assert.equal(raised.length, 0);
  assert.equal(enqueued.length, 0);
});

test("a disqualified survivor does not count as something to choose from", async () => {
  // §8c: never presented as qualified. An auction whose only remaining offer is over the buyer's
  // ceiling has nothing selectable on it, and the select route would refuse it.
  offersByAuction.auc_1 = [{ status: "SUBMITTED", isDisqualified: true, expiresAt: FUTURE }];
  assert.equal(await sweep(), 1);
});

// ── S16 — PRESERVED ─────────────────────────────────────────────────────────────────────────────

test("S16 — nothing here refunds anything", async () => {
  // §23.1 makes every refund a reviewed request, and a request that ends without a selection is
  // not an exception to that. The sweep opens a case and sends a notice; it moves no money.
  await sweep();
  assert.equal(depositUpdates.length, 0, "the sweep touched a deposit");
  const body = JSON.stringify(enqueued[0]);
  assert.equal(/refunded|we have refunded|refund has been issued/i.test(body), false, "the copy promises a refund");
  // It must still SAY the money is not gone — a buyer who hears nothing about their $99 assumes
  // the worst.
  assert.match(body, /refundable on request/);
});

// ── the query, and idempotency ──────────────────────────────────────────────────────────────────

test("only CLOSED, PROCESSED auctions with no ACCEPTED offer are even considered", async () => {
  await sweep();
  const where = auctionFindArgs[0].where as Rec;
  assert.equal(where.status, "CLOSED");
  assert.deepEqual(where.postCloseProcessedAt, { not: null }, "an unprocessed auction has not told the buyer anything yet");
  assert.deepEqual(where.offers, { none: { status: "ACCEPTED" } });
  // ...and at least one QUALIFIED offer that HAS lapsed, which is what makes the auction
  // interesting at all. The `isDisqualified: false` half is asserted on its own below, with the
  // double-notice it prevents written out.
  assert.deepEqual(where.AND, [{ offers: { some: { status: "EXPIRED", isDisqualified: false } } }]);
});

test("the sweep is bounded per run", async () => {
  await sweep();
  assert.equal(typeof auctionFindArgs[0].take, "number");
});

test("one auction failing does not stop the sweep reaching the others", async () => {
  // Both writes are idempotent, so the next tick retries the failure — but the other auctions
  // must not wait for it, and a sweep that aborted on the first bad row would leave every buyer
  // behind it unheard for as long as that row kept failing.
  auctions = [auction({ id: "bad" }), auction({ id: "good", buyerId: "b2" })];
  offersByAuction = { bad: [], good: [] };
  raiseFailsFor = new Set(["bad"]);

  assert.equal(await sweep(), 1, "the sweep stopped at the failure");
  assert.deepEqual(raised.map((r) => r.auctionId), ["good"]);
  assert.equal(enqueued.length, 1, "the failed auction must not be notified without its case");
});

test("a buyer with no mailbox still gets the case opened, AND the lost notice is reported", async () => {
  // The notice is how the buyer hears; the queue row is how anyone acts. Losing the first must not
  // cost the second.
  //
  // THIS IS THE SHARPEST OF THE FIVE NO-CHANNEL SITES, under the 2026-09-14 ruling. The sweep
  // raises BUYER_DOES_NOT_SELECT BEFORE enqueueing the notice, and that row is its own terminal
  // marker — the candidate query excludes any auction carrying it. So the auction stops being a
  // candidate the instant the raise lands and, unlike the close path, is NEVER retried. Before the
  // ruling the only trace that a buyer was never told their offers had expired was one log line,
  // and `swept++` still counted them as swept.
  buyer = { firstName: "Ada", user: null };
  assert.equal(await sweep(), 1);
  assert.equal(raised.length, 1, "the S15 case must still open — that half was already right");
  assert.equal(enqueued.length, 0);
  assert.equal(noChannel.length, 1, "the lost notice was discarded silently");
  assert.equal(noChannel[0].templateKey, "offers_expired_unselected");
  assert.equal(noChannel[0].outboxKey, "offers_expired_unselected:email:auc_1");
  assert.equal(noChannel[0].recipientKind, "buyer");
});

// ── THE SWEEP MUST DRAIN, AND MUST NOT SWEEP AN AUCTION THAT NEVER HAD AN OFFER ────────────────
//
// Three defects found by review, all of them properties of the candidate QUERY rather than of the
// per-auction work, which is why the tests above could not see them.

test("the case is raised ONCE EVER, not once per Operations resolution", async () => {
  // `raiseException` without an explicit key dedupes only while the row is LIVE: the moment
  // Operations marks the case RESOLVED, the next five-minute tick takes the `#2` suffix and opens
  // a brand-new OPEN row — and after fifty resolutions it throws on every tick forever. The
  // condition here is terminal by construction (a closed auction whose offers have all lapsed
  // cannot become un-lapsed), so it is exactly the "strict once-ever" case the explicit key is for.
  await sweep();
  assert.equal(raised.length, 1);
  assert.equal(
    raised[0].idempotencyKey,
    "BUYER_DOES_NOT_SELECT:auc_1",
    "the raise carries no explicit key — a resolved case reopens on the next tick",
  );
});

test("an auction that already has the case is not a candidate — the set drains", async () => {
  // Without this the predicate stays true forever for every auction it has already swept. With a
  // `take` of 50 that is not merely wasteful: once 50 auctions sit in this state, the fifty-first
  // buyer is never reached, and nothing anywhere reports it.
  await sweep();
  const where = auctionFindArgs[0].where as Rec;
  const items = where.queueItems as Rec | undefined;
  assert.ok(items, "the candidate query does not exclude auctions that already carry the case");
  assert.deepEqual(items!.none, { exceptionCode: "BUYER_DOES_NOT_SELECT" });
});

test("the candidate set is ordered, so a bounded page is the OLDEST and not an arbitrary 50", async () => {
  await sweep();
  assert.deepEqual(auctionFindArgs[0].orderBy, { closedAt: "asc" });
});

test("an auction whose offers were ALL disqualified is never swept", async () => {
  // The buyer was already told at close that no offers were received (`qualified.length === 0`
  // takes the zero-offer branch) and `ALL_OFFERS_EXCEED_BUDGET` was raised. Seventy-two hours
  // later `expireLapsedOffers` flips those same disqualified rows to EXPIRED — `lapsedOfferWhere`
  // does not exclude them — and without this the sweep would then tell the same buyer that "the
  // offers on your request have reached their expiration without a selection" and open a SECOND
  // case. A buyer told there were no offers cannot be told their offers expired because they did
  // not choose.
  await sweep();
  const where = auctionFindArgs[0].where as Rec;
  const and = where.AND as Rec[];
  const lapsed = and.find((c) => (c.offers as Rec | undefined)?.some) as Rec | undefined;
  assert.ok(lapsed, "the candidate query no longer requires a lapsed offer");
  assert.deepEqual(
    (lapsed!.offers as Rec).some,
    { status: "EXPIRED", isDisqualified: false },
    "a disqualified lapsed offer still makes the auction a sweep candidate",
  );
});
