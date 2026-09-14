// §13-D39 — the deposit → auction cardinality helper.
//
// These pin the THREE DIFFERENT questions the nine re-derived production sites ask, which the
// single pre-D39 query (`findFirst({ where: { depositId } })`) could not tell apart:
//
//   "the original"   — the settlement anchor, the concierge anchor, launch readiness's create branch
//   "the live one"   — the reconciler's subject, and the redelivery guard
//   "any at all"     — the sweep pools and the unconsumed-deposit lookups
//
// The fake asserts on the WHERE CLAUSE rather than simulating a database, because the defect this
// guards against is a query that asks the wrong question — not a query that mis-executes. A fake
// that answered by depositId alone is exactly what let the old suites stay green while the
// guarantee underneath them changed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import type { DepositAuctionDb } from "../deposit-auction";
import {
  findOriginalAuctionForDeposit,
  findLiveAuctionForDeposit,
  resolveRelaunchEligibility,
  isDepositAuctionUniqueViolation,
  RELAUNCH_LIMIT,
  LIVE_AUCTION_STATUSES,
  TERMINAL_AUCTION_STATUSES,
} from "../deposit-auction";

type Row = {
  id: string;
  depositId: string;
  status: string;
  originalAuctionId: string | null;
  relaunchCount: number;
  createdAt: Date;
};

/**
 * Records every `where`/`orderBy` it is handed, then answers it honestly.
 *
 * Cast to `DepositAuctionDb` at the boundary, following `request-coverage-gate.test.ts:46`. The
 * helper's parameter is deliberately the REAL generated delegate type rather than a hand-written
 * approximation — that is what stops a production caller passing a malformed `where` — so a fake
 * cannot satisfy it structurally. The cast is the cost of keeping the production type honest, and
 * it is paid once here rather than by loosening the signature every caller relies on.
 */
function db(rows: Row[]) {
  const calls: Array<{ where: Record<string, unknown>; orderBy?: Record<string, unknown> }> = [];
  return {
    calls,
    client: ({
      auction: {
        findFirst: async (args: { where: Record<string, unknown>; orderBy?: Record<string, unknown> }) => {
          calls.push({ where: args.where, orderBy: args.orderBy });
          let out = rows.filter((r) =>
            Object.entries(args.where).every(([k, v]) => {
              const actual = (r as unknown as Record<string, unknown>)[k] ?? null;
              if (v && typeof v === "object" && "in" in (v as Record<string, unknown>)) {
                return (v as { in: unknown[] }).in.includes(actual);
              }
              return (v ?? null) === actual;
            }),
          );
          const dir = (args.orderBy as { createdAt?: string } | undefined)?.createdAt;
          if (dir) {
            const m = dir === "desc" ? -1 : 1;
            out = [...out].sort((a, b) => m * (a.createdAt.getTime() - b.createdAt.getTime()));
          }
          return out[0] ?? null;
        },
        count: async () => rows.length,
      },
    } as unknown) as DepositAuctionDb,
  };
}

const ORIGINAL: Row = {
  id: "auc_original", depositId: "dep_1", status: "CLOSED",
  originalAuctionId: null, relaunchCount: 0, createdAt: new Date(2026, 0, 1),
};
const RETRY: Row = {
  id: "auc_retry", depositId: "dep_1", status: "ACTIVE",
  originalAuctionId: "auc_original", relaunchCount: 0, createdAt: new Date(2026, 0, 2),
};

test("§8c's relaunch budget is ONE — stated once, not re-derived per call site", () => {
  assert.equal(RELAUNCH_LIMIT, 1);
});

test("the live/terminal partition is total and disjoint over AuctionStatus", () => {
  // REOPENED is LIVE. It is easy to read as terminal because the close path produced it, and
  // classifying it terminal would make a reopened auction relaunch-eligible while it is still
  // taking offers — two live auctions on one $99.
  const all = [...LIVE_AUCTION_STATUSES, ...TERMINAL_AUCTION_STATUSES];
  assert.equal(new Set(all).size, all.length, "a status is in both partitions");
  assert.deepEqual(
    [...all].sort(),
    ["ACTIVE", "CANCELLED", "CLOSED", "EXPIRED", "PENDING", "REOPENED"],
    "the partition no longer covers AuctionStatus exactly — a new label was added without a ruling",
  );
});

test("findOriginalAuctionForDeposit asks for the parentless row, never merely the first by deposit", async () => {
  const { client, calls } = db([RETRY, ORIGINAL]); // retry FIRST — order must not decide this
  const found = await findOriginalAuctionForDeposit<{ id: string }>(client, "dep_1");
  assert.equal(found?.id, "auc_original");
  assert.deepEqual(calls[0].where, { depositId: "dep_1", originalAuctionId: null });
});

test("findLiveAuctionForDeposit excludes terminal rows and orders newest-first", async () => {
  const { client, calls } = db([ORIGINAL, RETRY]);
  const found = await findLiveAuctionForDeposit<{ id: string }>(client, "dep_1");
  assert.equal(found?.id, "auc_retry");
  assert.deepEqual(calls[0].where.status, { in: LIVE_AUCTION_STATUSES });
  assert.deepEqual(
    calls[0].orderBy, { createdAt: "desc" },
    "an unordered findFirst returns an arbitrary row once a deposit carries two auctions",
  );
});

test("a deposit with no auction at all is NOT relaunch-eligible", async () => {
  const { client } = db([]);
  assert.deepEqual(await resolveRelaunchEligibility(client, "dep_1"), {
    eligible: false, reason: "NO_AUCTION",
  });
});

test("a deposit whose auction is still live is NOT relaunch-eligible", async () => {
  const { client } = db([{ ...ORIGINAL, status: "ACTIVE" }]);
  assert.deepEqual(await resolveRelaunchEligibility(client, "dep_1"), {
    eligible: false, reason: "AUCTION_STILL_LIVE",
  });
});

test("a deposit whose ORIGINAL has closed IS relaunch-eligible, and names the parent", async () => {
  const { client } = db([ORIGINAL]);
  assert.deepEqual(await resolveRelaunchEligibility(client, "dep_1"), {
    eligible: true, originalAuctionId: "auc_original",
  });
});

test("the budget is spent once — a relaunched original is not eligible again", async () => {
  const { client } = db([
    { ...ORIGINAL, relaunchCount: 1 },
    { ...RETRY, status: "CLOSED" },
  ]);
  assert.deepEqual(await resolveRelaunchEligibility(client, "dep_1"), {
    eligible: false, reason: "RELAUNCH_LIMIT_REACHED",
  });
});

test("eligibility asks about the LIVE auction before the original — a live retry blocks a third", async () => {
  // Ordering matters: were the original checked first, a CLOSED original with relaunchCount 0 and
  // a live retry would read eligible, and the deposit would take a second retry.
  const { client } = db([ORIGINAL, RETRY]);
  assert.deepEqual(await resolveRelaunchEligibility(client, "dep_1"), {
    eligible: false, reason: "AUCTION_STILL_LIVE",
  });
});

test("isDepositAuctionUniqueViolation recognises this migration's indexes and nothing else", () => {
  // Built as a REAL PrismaClientKnownRequestError, not an object shaped like one. The guard is an
  // `instanceof` check, so a duck-typed stand-in tests only the negative branch and would pass
  // even if the positive branch were broken — and the positive branch is the whole point: it is
  // what turns a relaunch race into a 409 instead of an unexplained 500.
  const p2002 = (target: unknown) =>
    new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "5.22.0",
      meta: { target },
    });

  assert.equal(isDepositAuctionUniqueViolation(p2002(["auctions_deposit_id_original_key"])), true);
  assert.equal(isDepositAuctionUniqueViolation(p2002(["auctions_original_auction_id_key"])), true);
  assert.equal(isDepositAuctionUniqueViolation(p2002("auctions_deposit_id_original_key")), true,
    "Prisma reports `target` as a bare string on some engines — both shapes must be recognised");

  // Another table's unique violation is NOT this migration's conflict. Mapping it to the relaunch
  // 409 would tell an admin "already relaunched" about a collision that had nothing to do with it.
  assert.equal(isDepositAuctionUniqueViolation(p2002(["offers_original_offer_id_key"])), false);

  const p2025 = new Prisma.PrismaClientKnownRequestError("Record not found", {
    code: "P2025", clientVersion: "5.22.0", meta: {},
  });
  assert.equal(isDepositAuctionUniqueViolation(p2025), false, "only P2002 is a unique violation");

  assert.equal(isDepositAuctionUniqueViolation(new Error("nope")), false);
  assert.equal(isDepositAuctionUniqueViolation(null), false);
  assert.equal(isDepositAuctionUniqueViolation(undefined), false);
});
