// §8.2 Phase 6 — WHAT HAPPENS WHEN AN AUCTION CLOSES.
//
// `processAuctionClose` had no test of any kind beyond the pure claim predicate
// (`auction-close-idempotency.test.ts`), which is how four defects lived in one function:
//
//   (a) `_count: { select: { offers: true } }` counted EVERY `offers` row — DRAFT, WITHDRAWN (a
//       revision leaves one behind on every revise), DECLINED, EXPIRED, over-ceiling disqualified —
//       and that number chose the branch, wrote the notification title and went into the email. An
//       auction whose only offer had been withdrawn told the buyer "1 offer ready" and linked them
//       to an empty report, and the zero-offer case never opened.
//
//   (b) zero-offer was judged per AUCTION with no notion of candidates. §22a: "Offers on some
//       candidates and none on others is a successful auction. Only zero valid offers across every
//       candidate triggers the zero-offer case."
//
//   (5) both buyer notices ended in `.catch(() => {})`, so the release-on-failure branch at the end
//       of the try could not be reached by the failure it exists for: the claim stayed stamped, the
//       reconciler skipped the auction forever, and the buyer was told nothing.
//
//   (8) `VehicleRequestStatus.OFFER_READY` had no writer anywhere in the repository.
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/auction/__tests__/auction-close-path.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

type Rec = Record<string, unknown>;

let auctionRow: Rec | null;
let offers: Rec[];
let candidates: Rec[];
let claimCount: number;
let buyer: Rec | null;

let notifications: Rec[];
let enqueued: Rec[];
let raised: Rec[];
let candidateUpdates: Rec[];
let requestUpdates: Rec[];
let offerUpdates: Rec[];
let auctionUpdates: Rec[];
let dealerNoWinnerEmails: Rec[];
let ranked: string[];
let enqueueThrows: Error | null;

/**
 * HONOURS THE `where`, including the `OR` that `qualifiedOfferWhere` builds.
 *
 * A fake that returned every seeded offer regardless of scope would make every assertion below
 * pass for the wrong reason — the defect under test IS an unfiltered count, so a fake that does not
 * filter cannot detect it. `qualifiedOfferWhere` and `lapsedOfferWhere` are imported for real by
 * the service, so this matcher is exercising the production predicate, not a copy of it.
 */
function matches(o: Rec, where: Rec): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === "OR") {
      const clauses = v as Rec[];
      if (!clauses.some((c) => matches(o, c))) return false;
      continue;
    }
    const actual = o[k];
    if (v !== null && typeof v === "object") {
      const cond = v as Rec;
      if ("gt" in cond && !(actual instanceof Date && actual.getTime() > (cond.gt as Date).getTime())) return false;
      if ("lte" in cond && !(actual instanceof Date && actual.getTime() <= (cond.lte as Date).getTime())) return false;
      if ("not" in cond) {
        if (cond.not === null && actual == null) return false;
        if (cond.not !== null && actual === cond.not) return false;
      }
      if ("in" in cond && !(cond.in as unknown[]).includes(actual)) return false;
      if ("notIn" in cond && (cond.notIn as unknown[]).includes(actual)) return false;
      continue;
    }
    if (actual !== v) return false;
  }
  return true;
}

const db = {
  auction: {
    findUnique: async () => auctionRow,
    updateMany: async (a: Rec) => {
      auctionUpdates.push(a);
      // The claim is the FIRST updateMany (it carries the NULL precondition); the release is the
      // second. Only the claim is answered with the seeded count.
      const where = a.where as Rec;
      return { count: "postCloseProcessedAt" in where ? claimCount : 1 };
    },
  },
  offer: {
    findMany: async ({ where }: { where: Rec }) => offers.filter((o) => matches(o, where)),
    count: async ({ where }: { where: Rec }) => offers.filter((o) => matches(o, where)).length,
    updateMany: async (a: Rec) => {
      const hit = offers.filter((o) => matches(o, a.where as Rec));
      offerUpdates.push({ ...a, matched: hit.map((o) => o.id) });
      for (const o of hit) Object.assign(o, a.data as Rec);
      return { count: hit.length };
    },
  },
  auctionVehicle: {
    updateMany: async (a: Rec) => {
      const hit = candidates.filter((c) => matches(c, a.where as Rec));
      candidateUpdates.push({ ...a, matched: hit.map((c) => c.id) });
      for (const c of hit) Object.assign(c, a.data as Rec);
      return { count: hit.length };
    },
  },
  vehicleRequest: {
    updateMany: async (a: Rec) => {
      requestUpdates.push(a);
      return { count: 1 };
    },
  },
  notification: { create: async (a: Rec) => { notifications.push(a.data as Rec); return {}; } },
  buyer: { findUnique: async () => buyer },
  auctionInvitation: { findMany: async () => [{ dealer: { dealershipName: "D1", user: { email: "d1@x.test" } } }] },
};

mock.module("@/lib/prisma", { namedExports: { prisma: db } });
mock.module("@/lib/services/auction/dealer-invitation.service", {
  namedExports: { releaseAuctionLoad: async () => {} },
});
mock.module("@/lib/services/offer/best-price.service", {
  namedExports: { rankOffers: async (id: string) => { ranked.push(id); } },
});
mock.module("@/lib/services/email/resend.service", {
  namedExports: {
    sendDealerAuctionClosedNoWinnerEmail: async (a: Rec) => { dealerNoWinnerEmails.push(a); },
  },
});
mock.module("@/lib/services/comms/transactional-dispatcher.service", {
  namedExports: {
    enqueueTransactional: async (input: Rec) => {
      if (enqueueThrows) throw enqueueThrows;
      enqueued.push(input);
      return { enqueued: true, id: "co_1", dedupKey: String(input.idempotencyKey) };
    },
  },
});
mock.module("@/lib/services/operations/queue-item.service", {
  namedExports: { raiseException: async (input: Rec) => { raised.push(input); return { item: {}, created: true }; } },
});

const FUTURE = new Date(Date.now() + 72 * 3_600_000);
const PAST = new Date(Date.now() - 3_600_000);

function offer(over: Rec = {}): Rec {
  return {
    id: `off_${offers.length + 1}`,
    auctionId: "auc_1",
    status: "SUBMITTED",
    isDisqualified: false,
    expiresAt: FUTURE,
    auctionVehicleId: "cand_1",
    ...over,
  };
}

beforeEach(() => {
  auctionRow = { id: "auc_1", buyerId: "b1", depositId: "dep_1", vehicleRequestId: "vr_1" };
  offers = [];
  candidates = [{ id: "cand_1", auctionId: "auc_1", candidateStatus: "ACTIVE" }];
  claimCount = 1;
  buyer = { firstName: "Ada", user: { email: "ada@test.local" } };
  notifications = [];
  enqueued = [];
  raised = [];
  candidateUpdates = [];
  requestUpdates = [];
  offerUpdates = [];
  auctionUpdates = [];
  dealerNoWinnerEmails = [];
  ranked = [];
  enqueueThrows = null;
});

async function close() {
  const { processAuctionClose } = await import("../auction.service");
  return processAuctionClose("auc_1");
}

// ── (a) THE COUNT ───────────────────────────────────────────────────────────────────────────────

test("a WITHDRAWN offer does not make a zero-offer auction look successful", async () => {
  // The revision path withdraws the superseded row, so this is the ordinary shape of an auction
  // where one dealer bid and then pulled out — not an exotic case.
  offers = [offer({ status: "WITHDRAWN" })];
  const res = await close();
  assert.equal(res.offers, 0, "a withdrawn offer was counted as a live one");
  assert.equal(raised.length, 1, "the zero-offer case never opened");
  assert.equal(raised[0].code, "ZERO_OFFERS_ALL_CANDIDATES");
});

test("a DISQUALIFIED offer is not a qualified offer (§8c)", async () => {
  offers = [offer({ isDisqualified: true, disqualifiedReason: "over ceiling" })];
  const res = await close();
  assert.equal(res.offers, 0);
  // ...and the case names the RIGHT condition: dealers competed, they were all over budget.
  assert.equal(raised[0].code, "ALL_OFFERS_EXCEED_BUDGET");
  assert.match(String(raised[0].detail), /disqualified against the buyer's approved amount/);
});

test("an EXPIRED offer is not a qualified offer, and is swept to EXPIRED", async () => {
  offers = [offer({ expiresAt: PAST })];
  const res = await close();
  assert.equal(res.offers, 0);
  assert.equal(offers[0].status, "EXPIRED", "OfferStatus.EXPIRED still has no writer");
});

test("an offer with a NULL expiry (pre-Phase-6 row) still qualifies", async () => {
  // Treating a legacy NULL as expired would delete a live dealership's offer from the report.
  offers = [offer({ expiresAt: null })];
  assert.equal((await close()).offers, 1);
  assert.equal(raised.length, 0);
});

// ── (b) §22a / N1 — THE PER-CANDIDATE RULE ──────────────────────────────────────────────────────

test("offers on one candidate and none on another is a SUCCESS, and the empty candidate closes", async () => {
  candidates = [
    { id: "cand_1", auctionId: "auc_1", candidateStatus: "ACTIVE" },
    { id: "cand_2", auctionId: "auc_1", candidateStatus: "ACTIVE" },
  ];
  offers = [offer({ auctionVehicleId: "cand_1" })];

  const res = await close();
  assert.equal(res.offers, 1, "a partially-answered auction was treated as a failure");
  assert.equal(raised.length, 0, "the zero-offer case opened on a successful auction");
  assert.equal(ranked[0], "auc_1", "a successful close must rank");

  assert.equal(candidates.find((c) => c.id === "cand_2")!.candidateStatus, "CLOSED");
  assert.equal(candidates.find((c) => c.id === "cand_1")!.candidateStatus, "ACTIVE", "the answered candidate was closed");
  assert.match(String(candidateUpdates[0].data && (candidateUpdates[0].data as Rec).droppedReason), /No qualified offer/);
});

test("a legacy unbound offer does not close every candidate on a SUCCESSFUL auction", async () => {
  // The dangerous shape, and the one the custom-request test below does NOT cover because it
  // seeds no candidates at all. Here the auction HAS candidates and the only qualified offer is a
  // pre-Phase-6 row with a NULL binding (`offers.auction_vehicle_id` shipped with no writer), so
  // the answered set is empty while the auction plainly succeeded.
  //
  // Prisma compiles `id: { notIn: [] }` to `AND 1=1` — it matches EVERYTHING — so without the
  // attributability guard this closes every candidate and stamps each "No qualified offer at
  // auction close", which is false, and leaves `submitOffer` unable to bind a later staff-intake
  // offer to any candidate.
  candidates = [
    { id: "cand_1", auctionId: "auc_1", candidateStatus: "ACTIVE" },
    { id: "cand_2", auctionId: "auc_1", candidateStatus: "ACTIVE" },
  ];
  offers = [offer({ auctionVehicleId: null })];

  const res = await close();
  assert.equal(res.offers, 1);
  assert.equal(raised.length, 0);
  assert.equal(candidateUpdates.length, 0, "the candidate sweep ran with nothing to attribute");
  assert.equal(candidates.find((c) => c.id === "cand_1")!.candidateStatus, "ACTIVE");
  assert.equal(candidates.find((c) => c.id === "cand_2")!.candidateStatus, "ACTIVE");
});

test("a ZERO-offer auction still closes every candidate — nothing was answered", async () => {
  // The other arm of the same condition: `answered` is empty here too, but for the opposite
  // reason. N1 is explicit that candidates which drew nothing are closed.
  candidates = [
    { id: "cand_1", auctionId: "auc_1", candidateStatus: "ACTIVE" },
    { id: "cand_2", auctionId: "auc_1", candidateStatus: "ACTIVE" },
  ];
  await close();
  assert.equal(candidates.every((c) => c.candidateStatus === "CLOSED"), true);
});

test("a custom request (offers bound to no candidate) still closes as a success", async () => {
  // §8c binds an offer to "the criteria set on a custom request" instead of a candidate row, so
  // `auctionVehicleId` is null and the answered-candidate set is empty. An implementation that
  // required a binding would close every candidate and call the auction a failure.
  candidates = [];
  offers = [offer({ auctionVehicleId: null })];
  const res = await close();
  assert.equal(res.offers, 1);
  assert.equal(raised.length, 0);
});

// ── (8) OFFER_READY ─────────────────────────────────────────────────────────────────────────────

test("a successful close advances the vehicle request to OFFER_READY", async () => {
  offers = [offer()];
  await close();
  assert.equal(requestUpdates.length, 1, "OFFER_READY still has no writer");
  assert.equal((requestUpdates[0].data as Rec).status, "OFFER_READY");
  const statuses = ((requestUpdates[0].where as Rec).status as Rec).in as string[];
  assert.ok(statuses.includes("ACTIVE_SOURCING"));
  assert.ok(
    !statuses.includes("DEAL_CREATED") && !statuses.includes("CANCELLED"),
    "the conditional update could drag a request backwards from a selection that already happened",
  );
});

test("a zero-offer close does NOT advance the request", async () => {
  await close();
  assert.equal(requestUpdates.length, 0);
});

// ── (5) THE NOTICES, AND THE RELEASE THEY USED TO HIDE ──────────────────────────────────────────

test("the offers-ready notice rides the dispatcher, auction-scoped", async () => {
  offers = [offer(), offer({ auctionVehicleId: "cand_1", id: "off_2" })];
  await close();
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].templateKey, "offers_ready");
  assert.equal(enqueued[0].auctionId, "auc_1");
  assert.equal(
    enqueued[0].idempotencyKey,
    "offers_ready:email:auc_1",
    "a buyer's SECOND auction would collide with their first on a recipient-derived key",
  );
  // The in-app row stays: the dispatcher's in_app channel is read by no buyer surface.
  assert.equal(notifications.length, 1);
  assert.match(String(notifications[0].title), /2 offers ready/);
});

test("the zero-offer notice rides the dispatcher and the dealers are still told", async () => {
  await close();
  assert.equal(enqueued[0].templateKey, "auction_zero_offers");
  assert.equal(dealerNoWinnerEmails.length, 1);
  assert.equal(notifications.length, 1);
});

test("a failed enqueue RELEASES the claim and propagates — it is no longer swallowed", async () => {
  // This is defect 5 exactly: with `.catch(() => {})` the claim stayed stamped, the reconciler's
  // `{ status: CLOSED, postCloseProcessedAt: null }` predicate never matched again, and the buyer
  // was never told their auction closed.
  offers = [offer()];
  enqueueThrows = new Error("outbox unavailable");
  await assert.rejects(() => close(), /outbox unavailable/);
  const release = auctionUpdates.at(-1)!;
  assert.equal((release.data as Rec).postCloseProcessedAt, null, "the claim was not released for retry");
});

// ── the claim, unchanged but re-pinned against the new counting ──────────────────────────────────

test("losing the claim does no work and still reports the qualified count honestly", async () => {
  offers = [offer()];
  claimCount = 0;
  const res = await close();
  assert.equal(res.offers, 1);
  assert.equal(enqueued.length, 0);
  assert.equal(notifications.length, 0);
  assert.equal(candidateUpdates.length, 0);
});

test("a missing auction is a no-op, not a throw", async () => {
  auctionRow = null;
  assert.deepEqual(await close(), { offers: 0 });
});

test("a buyer with no mailbox does not stall the close forever", async () => {
  // Throwing here would release the claim and retry every tick against an address that is not
  // going to appear. The in-app notification is still written.
  offers = [offer()];
  buyer = { firstName: "Ada", user: null };
  const res = await close();
  assert.equal(res.offers, 1);
  assert.equal(enqueued.length, 0);
  assert.equal(notifications.length, 1);
});
