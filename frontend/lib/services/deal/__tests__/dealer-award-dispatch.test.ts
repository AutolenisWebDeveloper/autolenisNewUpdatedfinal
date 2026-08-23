// Unit tests for the dealer-award dispatch drain — migrated off the Inngest
// `dealerAwardFn`. Pins:
//   • NO_PENDING when no offer-accepted deal awaits dispatch;
//   • a due deal is claimed, dispatched via emitDealerAwardOutcomes, its marker
//     stamped, and the concurrency lease released;
//   • a deal with no resolvable auction is stamped-and-skipped (never re-scanned);
//   • a lost claim is skipped (no dispatch);
//   • a dispatch failure does NOT stamp the marker (re-driven next tick) and marks
//     the lease 'failed'.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/deal/__tests__/dealer-award-dispatch.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

let deals: Array<{ id: string; offerId: string | null; offer: { auctionId: string } | null }> = [];
let claimResult = true;
let emitThrows = false;

const calls = {
  emit: [] as Array<{ auctionId: string; winningOfferId: string; dealId: string }>,
  dealUpdate: [] as string[],
  release: [] as string[],
  idempotency: [] as { key: string; status: string }[],
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      deal: {
        findMany: async () => deals,
        update: async ({ where }: { where: { id: string } }) => {
          calls.dealUpdate.push(where.id);
          return {};
        },
      },
    },
  },
});

mock.module("@/lib/jobs/idempotency", {
  namedExports: {
    getSupabase: () => ({}),
    claimJob: async () => claimResult,
    updateIdempotencyState: async (_s: unknown, key: string, status: string) => {
      calls.idempotency.push({ key, status });
    },
    releaseIdempotencyGuard: async (_s: unknown, key: string) => {
      calls.release.push(key);
    },
  },
});

mock.module("@/lib/services/notifications/dealer-award", {
  namedExports: {
    emitDealerAwardOutcomes: async (args: { auctionId: string; winningOfferId: string; dealId: string }) => {
      calls.emit.push(args);
      if (emitThrows) throw new Error("dispatch boom");
    },
  },
});

mock.module("@/lib/logger", {
  namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } },
});

async function load() {
  return import("@/lib/services/deal/dealer-award-dispatch.service");
}

beforeEach(() => {
  deals = [];
  claimResult = true;
  emitThrows = false;
  calls.emit = [];
  calls.dealUpdate = [];
  calls.release = [];
  calls.idempotency = [];
});

test("returns NO_PENDING when nothing awaits dispatch", async () => {
  const { drainDealerAwardDispatch } = await load();
  const r = await drainDealerAwardDispatch();
  assert.equal(r.status, "NO_PENDING");
  assert.equal(calls.emit.length, 0);
});

test("claims, dispatches, stamps the marker, and releases the lease", async () => {
  deals = [{ id: "d1", offerId: "o1", offer: { auctionId: "a1" } }];
  const { drainDealerAwardDispatch } = await load();
  const r = await drainDealerAwardDispatch();
  assert.equal(r.status, "OK");
  assert.equal(r.dispatched, 1);
  assert.deepEqual(calls.emit, [{ auctionId: "a1", winningOfferId: "o1", dealId: "d1" }]);
  assert.deepEqual(calls.dealUpdate, ["d1"], "marker stamped");
  assert.deepEqual(calls.release, ["dealer-award:d1"], "lease released on success");
});

test("a deal with no resolvable auction is stamped-and-skipped (no dispatch)", async () => {
  deals = [{ id: "d1", offerId: "o1", offer: null }];
  const { drainDealerAwardDispatch } = await load();
  const r = await drainDealerAwardDispatch();
  assert.equal(r.skipped, 1);
  assert.equal(calls.emit.length, 0);
  assert.deepEqual(calls.dealUpdate, ["d1"], "stamped so it isn't re-scanned forever");
});

test("a lost claim is skipped without dispatching", async () => {
  deals = [{ id: "d1", offerId: "o1", offer: { auctionId: "a1" } }];
  claimResult = false;
  const { drainDealerAwardDispatch } = await load();
  const r = await drainDealerAwardDispatch();
  assert.equal(r.skipped, 1);
  assert.equal(calls.emit.length, 0);
  assert.equal(calls.dealUpdate.length, 0, "marker not stamped when the claim was lost");
});

test("a dispatch failure does NOT stamp the marker and marks the lease failed", async () => {
  deals = [{ id: "d1", offerId: "o1", offer: { auctionId: "a1" } }];
  emitThrows = true;
  const { drainDealerAwardDispatch } = await load();
  const r = await drainDealerAwardDispatch();
  assert.equal(r.failed, 1);
  assert.equal(calls.dealUpdate.length, 0, "marker left NULL so a later tick re-drives it");
  assert.deepEqual(calls.idempotency, [{ key: "dealer-award:d1", status: "failed" }]);
  assert.equal(calls.release.length, 0);
});
