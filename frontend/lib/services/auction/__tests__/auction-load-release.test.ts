// `releaseAuctionLoad` — IDEMPOTENT, because the close path now retries.
//
// THE DEFECT THIS PINS. The function was a blind
// `dealer.updateMany({ data: { currentAuctionLoad: { decrement: 1 } } })` over every dealership
// invited to the auction, and it is the FIRST statement inside `processAuctionClose`'s claimed
// block. Before Phase 6 every statement after it was `.catch(() => {})`, so the block could not
// fail and the release could not run twice. Phase 6 made the notices and the exception raises
// propagate deliberately, and made the claim release itself on the way out so the next cron tick
// retries — which means a comms-outbox or `queue_items` outage lasting an hour decremented every
// invited dealership twelve times.
//
// `current_auction_load` has no floor. A dealership at `-12` scores `+60` in
// `scoreDealerForAuction`, never trips the `>= 5` capacity cut, never trips `isDealerAtCapacity`
// and always passes `currentAuctionLoad: { lt: DEALER_MAX_AUCTION_LOAD }` — invitation fairness
// corrupted permanently, silently, for every future auction.
//
// The column's definition is exact — the number of invitations this dealership holds on auctions
// that are still live — so the fix is to DERIVE it rather than to nudge it. That makes running
// this a hundred times identical to running it once, and repairs drift that already exists.
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/auction/__tests__/auction-load-release.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

type Rec = Record<string, unknown>;

/** dealerId → invitations, each carrying the status of the auction it is on. */
let invitations: Array<{ auctionId: string; dealerId: string | null; auctionStatus: string }>;
let dealerLoad: Record<string, number>;
let groupByCalls: number;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      auctionInvitation: {
        findMany: async ({ where }: { where: Rec }) =>
          invitations
            .filter((i) => i.auctionId === where.auctionId)
            .map((i) => ({ dealerId: i.dealerId })),
        groupBy: async ({ where }: { where: Rec }) => {
          groupByCalls++;
          const ids = ((where.dealerId as Rec).in as string[]) ?? [];
          const statuses = (((where.auction as Rec).status as Rec).in as string[]) ?? [];
          const counts: Record<string, number> = {};
          for (const i of invitations) {
            if (!i.dealerId || !ids.includes(i.dealerId)) continue;
            if (!statuses.includes(i.auctionStatus)) continue;
            counts[i.dealerId] = (counts[i.dealerId] ?? 0) + 1;
          }
          return Object.entries(counts).map(([dealerId, n]) => ({ dealerId, _count: { _all: n } }));
        },
      },
      dealer: {
        update: ({ where, data }: { where: Rec; data: Rec }) => {
          // Returned as a thenable so it works both awaited directly and collected into
          // `$transaction([...])`, which is how the service issues them.
          const run = async () => {
            dealerLoad[String(where.id)] = data.currentAuctionLoad as number;
            return {};
          };
          return { then: (res: (v: unknown) => unknown) => run().then(res) };
        },
      },
      $transaction: async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]),
    },
  },
});

// The module pulls in the invitation pipeline; nothing below it is exercised here.
mock.module("@/lib/services/email/resend.service", { namedExports: {} });
mock.module("@/lib/services/ghl/tag-sync", { namedExports: { syncGhlTag: () => {} } });
mock.module("@/lib/services/crm/lifecycle-scheduler", {
  namedExports: { scheduleLifecycleWorkload: async () => {} },
});

beforeEach(() => {
  invitations = [
    // The closing auction.
    { auctionId: "auc_closing", dealerId: "d1", auctionStatus: "CLOSED" },
    { auctionId: "auc_closing", dealerId: "d2", auctionStatus: "CLOSED" },
    // d1 is also bidding on one that is still running.
    { auctionId: "auc_live", dealerId: "d1", auctionStatus: "ACTIVE" },
  ];
  dealerLoad = { d1: 2, d2: 1 };
  groupByCalls = 0;
});

async function release() {
  const { releaseAuctionLoad } = await import("../dealer-invitation.service");
  return releaseAuctionLoad("auc_closing");
}

test("the load a dealership is left with is the auctions it is still on", async () => {
  await release();
  assert.equal(dealerLoad.d1, 1, "d1 still holds one live auction");
  assert.equal(dealerLoad.d2, 0, "d2 has nothing live left");
});

test("RUNNING IT AGAIN CHANGES NOTHING — the close path retries, and this must survive it", async () => {
  await release();
  await release();
  await release();
  assert.equal(dealerLoad.d1, 1, "a retried close drove the load below the truth");
  assert.equal(dealerLoad.d2, 0, "a retried close drove the load negative");
});

test("drift that already exists is repaired rather than preserved", async () => {
  // A dealership left at -12 by the old blind decrement is, under the derived form, corrected the
  // next time any of its auctions closes. A floored decrement would have frozen it at 0 and hidden
  // the damage instead.
  dealerLoad = { d1: -12, d2: -4 };
  await release();
  assert.equal(dealerLoad.d1, 1);
  assert.equal(dealerLoad.d2, 0);
});

test("a REOPENED auction counts as live — one status list, not one per reader", async () => {
  invitations.push({ auctionId: "auc_reopened", dealerId: "d2", auctionStatus: "REOPENED" });
  await release();
  assert.equal(dealerLoad.d2, 1, "REOPENED was treated as finished");
});

test("an invitation with no dealership is not counted and does not widen the update", async () => {
  // `dealer_id` is nullable from the Phase 1 wave on (S7-18). A null reaching `id: { in: [...] }`
  // would widen the write to every dealership in the table.
  invitations.push({ auctionId: "auc_closing", dealerId: null, auctionStatus: "CLOSED" });
  await release();
  assert.deepEqual(Object.keys(dealerLoad).sort(), ["d1", "d2"]);
});

test("an auction nobody was invited to writes nothing at all", async () => {
  invitations = [];
  await release();
  assert.equal(groupByCalls, 0, "the recompute ran for an empty dealer set");
  assert.deepEqual(dealerLoad, { d1: 2, d2: 1 });
});
