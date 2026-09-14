// §8.2 Phase 6 defect (6) / §27.1 K27-1325 — "Auction nearing zero offers → Operations".
//
// WHAT THIS REPLACED. `checkSLAs` wrote a bare `Notification` of type SYSTEM_ALERT with NO dedup of
// any kind. The cron runs every 30 minutes and the window is "closes within 2 hours", so one quiet
// auction produced FOUR identical rows — carrying no owner, no deadline, no return point and no
// reference to the auction, so an operator could neither tell them apart nor act on any of them.
//
// The count was also unfiltered (`_count.offers` over every status), so an auction whose only offer
// was a withdrawn revision looked healthy to the alert and then closed straight into the zero-offer
// branch with nobody warned — the exact case the alert exists for.
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/monitoring/__tests__/health-trending-zero.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

type Rec = Record<string, unknown>;

const state = {
  auctions: [] as Rec[],
  /** Every `raiseException` input, across every tick in a test. */
  raised: [] as Rec[],
  /** Keys already held by an open row, the way the real writer's unique index behaves. */
  liveKeys: new Set<string>(),
  notifications: [] as Rec[],
  /** Makes the queue writer throw, to prove the sweep survives it. */
  raiseThrows: false,
  /** The `where` the auction query asked for, so the filtered count can be asserted. */
  auctionFindArgs: [] as Rec[],
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      $queryRaw: async () => [] as unknown[],
      auction: {
        findMany: async (args: Rec) => {
          state.auctionFindArgs.push(args);
          return state.auctions;
        },
      },
      deal: { count: async () => 0 },
      buyerOpportunity: { count: async () => 0 },
      dealerProspect: { count: async () => 0 },
      notification: {
        findFirst: async () => null,
        create: async ({ data }: { data: Rec }) => {
          state.notifications.push(data);
          return { id: "n_1" };
        },
      },
    },
  },
});

mock.module("@/lib/services/operations/queue-item.service", {
  namedExports: {
    raiseException: async (input: Rec) => {
      if (state.raiseThrows) throw new Error("queue unavailable");
      state.raised.push(input);
      const key = String(input.idempotencyKey);
      // The real writer: an explicit key is strict once-ever, and a collision returns the
      // EXISTING row rather than creating a second.
      const created = !state.liveKeys.has(key);
      state.liveKeys.add(key);
      return { item: { id: key }, created };
    },
  },
});

beforeEach(() => {
  state.auctions = [];
  state.raised = [];
  state.liveKeys = new Set();
  state.notifications = [];
  state.auctionFindArgs = [];
  state.raiseThrows = false;
});

function urgent(over: Rec = {}): Rec {
  return {
    id: "auc_1",
    buyerId: "b1",
    depositId: "dep_1",
    vehicleRequestId: "vr_1",
    _count: { offers: 0 },
    ...over,
  };
}

async function run() {
  const { checkSLAs } = await import("@/lib/services/monitoring/health.service");
  return checkSLAs();
}

test("a quiet auction raises ONE exception no matter how many times the cron ticks", async () => {
  state.auctions = [urgent()];

  const first = await run();
  assert.equal(first.warnings, 1);
  assert.equal(state.raised.length, 1);
  assert.equal(state.raised[0].code, "AUCTION_TRENDING_TO_ZERO_OFFERS");

  // Four ticks across the two-hour window — what actually happens in production.
  await run();
  await run();
  await run();

  const distinctRows = new Set(state.raised.map((r) => String(r.idempotencyKey)));
  assert.equal(distinctRows.size, 1, "each tick opened its own row — this is the defect");
  assert.equal([...distinctRows][0], "AUCTION_TRENDING_TO_ZERO_OFFERS:auc_1");
});

test("the exception carries the refs an operator needs to find the transaction", async () => {
  state.auctions = [urgent()];
  await run();
  const row = state.raised[0];
  assert.equal(row.auctionId, "auc_1");
  assert.equal(row.buyerId, "b1");
  assert.equal(row.depositId, "dep_1");
  assert.equal(row.vehicleRequestId, "vr_1");
  assert.equal(
    state.notifications.length,
    0,
    "the un-owned SYSTEM_ALERT is gone — the queue row is the alert now",
  );
});

test("two quiet auctions get two rows — the dedup is per auction, not global", async () => {
  state.auctions = [urgent(), urgent({ id: "auc_2" })];
  const res = await run();
  assert.equal(res.warnings, 2);
  assert.equal(new Set(state.raised.map((r) => String(r.idempotencyKey))).size, 2);
});

test("an auction WITH a qualified offer raises nothing", async () => {
  state.auctions = [urgent({ _count: { offers: 2 } })];
  const res = await run();
  assert.equal(res.warnings, 0);
  assert.equal(state.raised.length, 0);
});

test("the count asked for is the QUALIFIED count, not every offers row", async () => {
  // The fake cannot evaluate a relation count for us, so the assertion is on the query the
  // service builds: an unfiltered `offers: true` is the defect, and it is visible here.
  state.auctions = [urgent()];
  await run();
  const select = (state.auctionFindArgs[0].select as Rec)._count as Rec;
  const offersCount = (select.select as Rec).offers as Rec;
  assert.notEqual(offersCount, true, "the relation count is unfiltered — DRAFT/WITHDRAWN/disqualified rows count");
  const where = offersCount.where as Rec;
  assert.equal(where.status, "SUBMITTED");
  assert.equal(where.isDisqualified, false);
  assert.ok(Array.isArray(where.OR), "the expiry clause is missing from the qualified predicate");
});

test("a failed queue write does not abort the rest of the SLA sweep", async () => {
  // Best-effort, like every other alert in this cycle. The swallowed Notification insert it
  // replaced had the same property; losing it would let one bad queue row hide the stuck-deal
  // and dealer-sourcing checks that run after this loop.
  state.auctions = [urgent()];
  state.raiseThrows = true;
  const res = await run();
  assert.equal(res.warnings, 1, "the warning is still counted");
});
