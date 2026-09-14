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
let requestStatus: string;

let notifications: Rec[];
let enqueued: Rec[];
let noChannel: Rec[];
let raised: Rec[];
let candidateUpdates: Rec[];
let requestUpdates: Rec[];
let requestEvents: Rec[];
let offerUpdates: Rec[];
let auctionUpdates: Rec[];
let dealerNoWinnerEmails: Rec[];
let ranked: string[];
let persisted: boolean[];
let existingRanking: Rec | null;
let enqueueThrows: Error | null;
let enqueueFilter: ((input: Rec) => void) | null;

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
    // The earliest-expiry lookup for the selection reminder: honours the id set AND the ordering,
    // so a test that seeds a later offer first still gets the earliest back.
    findFirst: async ({ where, orderBy }: { where: Rec; orderBy?: Rec }) => {
      const ids = (where.id as Rec | undefined)?.in as string[] | undefined;
      const rest = { ...where };
      delete rest.id;
      const hit = offers
        .filter((o) => (!ids || ids.includes(o.id as string)) && matches(o, rest))
        .sort((a, b) =>
          orderBy && (orderBy as Rec).expiresAt === "asc"
            ? ((a.expiresAt as Date | null)?.getTime() ?? Infinity) - ((b.expiresAt as Date | null)?.getTime() ?? Infinity)
            : 0,
        );
      return hit[0] ?? null;
    },
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
      // The conditional update's own answer: it advanced iff the request was in a pre-offer
      // status. The fake honours that so the event row cannot be asserted on a no-op.
      const statuses = ((a.where as Rec).status as Rec).in as string[];
      return { count: statuses.includes(requestStatus) ? 1 : 0 };
    },
  },
  vehicleRequestEvent: { create: async (a: Rec) => { requestEvents.push(a.data as Rec); return {}; } },
  notification: {
    // The idempotency guard reads before it writes, so the fake has to answer the read from what
    // it has already stored — otherwise the retry test passes for the wrong reason.
    findFirst: async ({ where }: { where: Rec }) =>
      notifications.find((n) => n.buyerId === where.buyerId && n.actionUrl === where.actionUrl) ?? null,
    create: async (a: Rec) => { notifications.push(a.data as Rec); return {}; },
  },
  buyer: { findUnique: async () => buyer },
  auctionInvitation: { findMany: async () => [{ dealer: { dealershipName: "D1", user: { email: "d1@x.test" } } }] },
};

mock.module("@/lib/prisma", { namedExports: { prisma: db } });
mock.module("@/lib/services/auction/dealer-invitation.service", {
  namedExports: { releaseAuctionLoad: async () => {} },
});
mock.module("@/lib/services/offer/best-price.service", {
  namedExports: {
    rankOffers: async (id: string, _term: number, opts: Rec = {}) => { ranked.push(id); persisted.push(!!opts.persistLog); },
    getPersistedRanking: async () => existingRanking,
  },
});
mock.module("@/lib/services/email/resend.service", {
  namedExports: {
    sendDealerAuctionClosedNoWinnerEmail: async (a: Rec) => { dealerNoWinnerEmails.push(a); },
  },
});
mock.module("@/lib/services/comms/transactional-dispatcher.service", {
  namedExports: {
    // The §27 no-channel raise. Recorded rather than stubbed to a no-op, because two tests below
    // assert that a buyer with no mailbox still produces an owned case.
    raiseNoDeliverableChannel: async (input: Rec) => { noChannel.push(input); },
    enqueueTransactional: async (input: Rec) => {
      if (enqueueThrows) throw enqueueThrows;
      if (enqueueFilter) enqueueFilter(input);
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
  noChannel = [];
  raised = [];
  candidateUpdates = [];
  requestUpdates = [];
  requestEvents = [];
  requestStatus = "ACTIVE_SOURCING";
  offerUpdates = [];
  auctionUpdates = [];
  dealerNoWinnerEmails = [];
  ranked = [];
  persisted = [];
  existingRanking = null;
  enqueueThrows = null;
  enqueueFilter = null;
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
  assert.equal(
    raised[0].idempotencyKey,
    "AUCTION_CLOSE_ZERO_QUALIFIED:auc_1",
    "the close-time case is not once-ever — a resolved case reopens under a #2 suffix on the next retry",
  );
});

test("a DISQUALIFIED offer is not a qualified offer (§8c)", async () => {
  offers = [offer({ isDisqualified: true, disqualifiedReason: "over ceiling" })];
  const res = await close();
  assert.equal(res.offers, 0);
  // ...and the case names the RIGHT condition: dealers competed, they were all over budget.
  assert.equal(raised[0].code, "ALL_OFFERS_EXCEED_BUDGET");
  assert.match(String(raised[0].detail), /disqualified against the buyer's approved amount/);
  assert.equal(
    raised[0].idempotencyKey,
    "AUCTION_CLOSE_ZERO_QUALIFIED:auc_1",
    "the over-budget branch must share the zero-offer branch's key — a per-code key lets one auction open BOTH cases",
  );
});

test("both close-time codes share ONE once-ever key, so an auction cannot open two cases", async () => {
  // The code is chosen by a TIME-DEPENDENT count: `overBudget` requires `status: SUBMITTED` and an
  // unexpired `expires_at`, and `expireLapsedOffers` has already swept lapsed rows to EXPIRED —
  // `lapsedOfferWhere` does not exclude disqualified offers, deliberately. So a retry that lands
  // after the disqualified offers lapse sees `overBudget = 0` and raises the OTHER code. Under a
  // per-code key that is two derived keys, two OPEN rows, and §26's two contradictory required
  // actions in front of one operator for one close.
  //
  // Asserted as ONE LITERAL shared by both branches, so a later refactor to `${code}:${auctionId}`
  // fails here rather than passing every other assertion in this file.
  offers = [offer({ isDisqualified: true })];
  await close();
  assert.equal(raised[0].code, "ALL_OFFERS_EXCEED_BUDGET");
  const overBudgetKey = raised[0].idempotencyKey;
  // Pinned to the LITERAL as well as to each other. Comparing the two branches alone would pass
  // vacuously if both were `undefined` — which is exactly the state this test exists to reject.
  assert.equal(overBudgetKey, "AUCTION_CLOSE_ZERO_QUALIFIED:auc_1");

  raised = [];
  offers = [offer({ status: "WITHDRAWN" })];
  await close();
  assert.equal(raised[0].code, "ZERO_OFFERS_ALL_CANDIDATES");
  assert.equal(
    raised[0].idempotencyKey,
    overBudgetKey,
    "the two codes key differently — one auction can open both cases",
  );
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
  assert.equal(requestEvents.length, 0);
});

test("the OFFER_READY transition writes a timeline event (C12)", async () => {
  offers = [offer()];
  await close();
  assert.equal(requestEvents.length, 1, "the status moved with no record of why");
  assert.equal(requestEvents[0].eventType, "OFFER_READY");
  assert.equal(requestEvents[0].actorRole, "SYSTEM");
  assert.equal((requestEvents[0].payload as Rec).qualifiedOffers, 1);
});

test("a reprocessed auction does not write a SECOND OFFER_READY event", async () => {
  // The compare-and-swap already advanced the request, so a later reconciler pass matches
  // nothing. Writing the event unconditionally would stamp a transition that did not happen.
  offers = [offer()];
  requestStatus = "OFFER_READY";
  await close();
  assert.equal(requestUpdates.length, 1, "the conditional update must still be attempted");
  assert.equal(requestEvents.length, 0);
});

// ── (5) THE NOTICES, AND THE RELEASE THEY USED TO HIDE ──────────────────────────────────────────

test("the offers-ready notice rides the dispatcher, auction-scoped", async () => {
  offers = [offer(), offer({ auctionVehicleId: "cand_1", id: "off_2" })];
  await close();
  // The selection reminder rides the same close, so this asserts on the offers-ready row by name
  // rather than on the array length — which is what a later touchpoint must not be able to break.
  const ready = enqueued.filter((e) => e.templateKey === "offers_ready");
  assert.equal(ready.length, 1);
  assert.equal(ready[0].auctionId, "auc_1");
  assert.equal(
    ready[0].idempotencyKey,
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

test("a buyer with no mailbox does not stall the close forever, and now opens a case", async () => {
  // Throwing here would release the claim and retry every tick against an address that is not
  // going to appear. The in-app notification is still written.
  //
  // OWNER RULING 2026-09-14 added the second half: the silent return became an owned Operations
  // case. "A logger.error standing in for an exception is the defect class this program has spent
  // five phases eliminating." Both halves are asserted together because they are in tension — the
  // case must be raised WITHOUT the raise becoming a throw that stalls the close.
  offers = [offer()];
  buyer = { firstName: "Ada", user: null };
  const res = await close();
  assert.equal(res.offers, 1);
  assert.equal(enqueued.length, 0);
  assert.equal(notifications.length, 1);
  // ONE CASE PER LOST MESSAGE, not one per unreachable buyer — and the success branch loses TWO:
  // the offers-ready notice and the pre-expiry selection reminder scheduled right after it. They
  // key differently on purpose. The operator's required action is "re-drive the notice once the
  // address is fixed", and there are two notices to re-drive; collapsing them onto one row would
  // fix the address and silently leave the reminder unsent.
  assert.equal(noChannel.length, 2, "the buyer could not be reached and a message went unreported");
  assert.deepEqual(
    noChannel.map((n) => n.outboxKey).sort(),
    ["offers_ready:email:auc_1", "selection_reminder:email:auc_1"],
    "each case must key on the message that does not exist, so neither can open twice",
  );
  assert.ok(noChannel.every((n) => n.recipientKind === "buyer"));
});

test("the zero-offer branch names its own template when the buyer has no mailbox", async () => {
  // The key is template-scoped, so the two branches must not collide: a buyer who cannot be
  // reached about a zero-offer close and one who cannot be reached about a successful close are
  // different messages and different cases.
  offers = [];
  buyer = { firstName: "Ada", user: null };
  await close();
  const keys = noChannel.map((n) => n.outboxKey);
  assert.ok(
    keys.includes("auction_zero_offers:email:auc_1"),
    `the zero-offer branch keyed on the wrong template: ${JSON.stringify(keys)}`,
  );
});

// ── the review findings, pinned ─────────────────────────────────────────────────────────────────

test("the claim release is a COMPARE-AND-SWAP — it cannot erase a selection's marker", async () => {
  // `commitOfferSelection` stamps `postCloseProcessedAt` inside the selection transaction so the
  // reconciler can never re-claim an auction the buyer has already bought on. A buyer selecting
  // between this run's claim and this run's failure would, under an unconditional release, have
  // that stamp overwritten with NULL — and the next tick would find one ACCEPTED offer and the
  // rest DECLINED, count ZERO qualified, and tell a buyer holding a Deal that no offers came in.
  offers = [offer()];
  enqueueThrows = new Error("outbox unavailable");
  await assert.rejects(() => close());
  const release = auctionUpdates.at(-1)!;
  const where = release.where as Rec;
  assert.ok(
    where.postCloseProcessedAt instanceof Date,
    "the release has no precondition — it can clear a marker another writer set",
  );
});

test("a retrying close does not append a second bell row", async () => {
  // Under the old code these writes were swallowed and nothing after them could throw, so the
  // retry loop did not exist. Now it does: the cron re-enters every five minutes.
  offers = [offer()];
  enqueueThrows = new Error("outbox unavailable");
  await assert.rejects(() => close());
  await assert.rejects(() => close());
  await assert.rejects(() => close());
  assert.equal(notifications.length, 1, `${notifications.length} identical bell rows for one auction`);
});

test("a retrying close does not append a second ranking audit row", async () => {
  offers = [offer()];
  enqueueThrows = new Error("outbox unavailable");
  await assert.rejects(() => close());
  assert.deepEqual(persisted, [true], "the first pass must persist the ranking");

  // The second pass finds a persisted ranking and must not write another — `bestPriceCalculationLog`
  // has no dedup key, and re-ranking would also change the report under a buyer reading it.
  existingRanking = { termMonths: 60, weights: {}, ranked: [] };
  await assert.rejects(() => close());
  assert.deepEqual(persisted, [true, false]);
});

test("an offer that cannot be attributed to a candidate suspends the sweep", async () => {
  // The deploy-window residue: a pre-Phase-6 offer carries a NULL binding, so on an auction that
  // spans the deploy its candidate is unidentifiable. Closing the others with "No qualified offer
  // at auction close" would be false about a candidate that may well have been answered.
  candidates = [
    { id: "cand_1", auctionId: "auc_1", candidateStatus: "ACTIVE" },
    { id: "cand_2", auctionId: "auc_1", candidateStatus: "ACTIVE" },
  ];
  offers = [offer({ auctionVehicleId: "cand_1" }), offer({ id: "legacy", auctionVehicleId: null })];
  await close();
  assert.equal(candidateUpdates.length, 0);
  assert.equal(candidates.every((c) => c.candidateStatus === "ACTIVE"), true);
});

// ── §9 / S14 — the pre-expiry selection reminder ────────────────────────────────────────────────

test("a successful close schedules ONE reminder, 24h before the EARLIEST expiry", async () => {
  // §9: "Offers carry an expiration. Remind the buyer before offers expire." Before this the
  // deadline existed in the database and nothing referred to it — the QStash copy that said
  // "before it expires" was written when `offers.expires_at` had no writer at all.
  //
  // THE EARLIEST, not each offer's own: offers on one auction share a window by construction, but
  // a dealership may state a shorter one, and the moment that matters to the buyer is when their
  // choice starts shrinking. One message about the whole report, not one per offer.
  const SOON = new Date(Date.now() + 48 * 3_600_000);
  const LATER = new Date(Date.now() + 72 * 3_600_000);
  offers = [offer({ id: "late", expiresAt: LATER }), offer({ id: "soon", expiresAt: SOON })];

  await close();
  const reminder = enqueued.find((e) => e.templateKey === "selection_reminder");
  assert.ok(reminder, "no selection reminder was scheduled");
  const runAt = reminder!.runAt as Date;
  assert.equal(runAt.getTime(), SOON.getTime() - 24 * 3_600_000, "scheduled against the wrong expiry");
  assert.equal(reminder!.idempotencyKey, "selection_reminder:email:auc_1");
  assert.equal(reminder!.cancelKey, "selection-reminder:auc_1", "§27's cancellation rule needs a key");
  assert.equal(enqueued.filter((e) => e.templateKey === "selection_reminder").length, 1);
});

test("no reminder is scheduled when the lead time has already passed", async () => {
  // A dealer-stated expiry shorter than the lead time puts the reminder in the past. A message
  // saying "expires soon" about something expiring within the hour, sent now, is a worse artefact
  // than no message.
  offers = [offer({ expiresAt: new Date(Date.now() + 2 * 3_600_000) })];
  await close();
  assert.equal(enqueued.some((e) => e.templateKey === "selection_reminder"), false);
});

test("a pre-Phase-6 offer with no expiry gets no reminder — there is no deadline to warn about", async () => {
  offers = [offer({ expiresAt: null })];
  await close();
  assert.equal(enqueued.some((e) => e.templateKey === "selection_reminder"), false);
  // ...but the offers-ready notice still goes, because the auction succeeded.
  assert.equal(enqueued.some((e) => e.templateKey === "offers_ready"), true);
});

test("a zero-offer close schedules no reminder", async () => {
  await close();
  assert.equal(enqueued.some((e) => e.templateKey === "selection_reminder"), false);
});

test("a reminder that cannot be scheduled does not release the close claim", async () => {
  // The buyer has already been told their offers are ready. Releasing the claim over a failed
  // reminder would re-run the close and tell them again.
  offers = [offer()];
  let calls = 0;
  enqueueFilter = (input: Rec) => {
    calls++;
    if (input.templateKey === "selection_reminder") throw new Error("outbox unavailable");
  };
  const res = await close();
  assert.equal(res.offers, 1);
  assert.ok(calls >= 2, "the reminder enqueue was never attempted");
  const release = auctionUpdates.at(-1)!;
  assert.notEqual((release.data as Rec).postCloseProcessedAt, null, "the claim was released over a reminder");
});
