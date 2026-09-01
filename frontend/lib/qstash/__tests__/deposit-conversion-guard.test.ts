// depositConversionResolved — the send-time STOP guard for the $99 abandoned-
// deposit reminder chain (deposit_reminder_1..6).
//
// It is re-read immediately before every one of the six touches, so it is the
// authoritative answer to "does this buyer still owe the $99?". Everything the
// chain must NOT do is decided here.
//
// Why these tests exist: three of the four stop conditions currently hold only as
// a SIDE EFFECT of the `status: { in: ["PAID", "PENDING"] }` filter — a deposit
// that is REFUNDED or FAILED stops the chain because it is no longer PENDING, not
// because anything names those states. Adding a status to that `in` list would
// silently un-stop the chain with no test failing. These pin each state BY NAME.
//
// The fourth condition — an administratively halted buyer — was simply absent:
// the guard consulted no buyer state at all, so a suspended, disabled, archived
// or purged buyer kept receiving "complete your $99 deposit" marketing.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/qstash/__tests__/deposit-conversion-guard.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface BuyerRow {
  suspendedAt: Date | null;
  disabledAt: Date | null;
  archivedAt: Date | null;
  purgedAt: Date | null;
}

let deposits: Array<{ status: string }> = [];
let buyer: BuyerRow | null = null;
let depositWhere: Record<string, unknown> | null = null;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      deposit: {
        findMany: async ({ where }: { where: Record<string, unknown> }) => {
          depositWhere = where;
          const filter = (where.status as { in?: string[] } | undefined)?.in;
          return deposits.filter((d) => !filter || filter.includes(d.status));
        },
      },
      buyer: { findUnique: async () => buyer },
      vehicleRequest: { findFirst: async () => null },
    },
  },
});

mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

async function load() { return import("@/lib/qstash/state"); }

const ACTIVE_BUYER: BuyerRow = { suspendedAt: null, disabledAt: null, archivedAt: null, purgedAt: null };

beforeEach(() => {
  deposits = [{ status: "PENDING" }];
  buyer = { ...ACTIVE_BUYER };
  depositWhere = null;
});

// ── The chain RUNS only while the buyer genuinely still owes the $99 ────────

test("an unpaid PENDING deposit on an active buyer does NOT stop the chain", async () => {
  const { depositConversionResolved } = await load();
  assert.equal(
    await depositConversionResolved("buyer_1"),
    false,
    "this is the whole point of the sequence — a buyer who started checkout and did not pay",
  );
});

// ── Terminal deposit states, pinned BY NAME ────────────────────────────────
// DepositStatus is PENDING | PAID | REFUNDED | FAILED. There is deliberately no
// CANCELLED member: an abandoned checkout leaves the row PENDING (which is what
// the chain chases), so "cancelled" is not a deposit state this guard can see.

test("PAID stops the chain", async () => {
  deposits = [{ status: "PAID" }];
  const { depositConversionResolved } = await load();
  assert.equal(await depositConversionResolved("buyer_1"), true, "never chase a buyer who already paid");
});

test("PAID stops the chain even when a stale PENDING intent is still on file", async () => {
  // Re-creating an intent leaves an older PENDING row behind; payment still wins.
  deposits = [{ status: "PENDING" }, { status: "PAID" }];
  const { depositConversionResolved } = await load();
  assert.equal(await depositConversionResolved("buyer_1"), true);
});

test("REFUNDED stops the chain", async () => {
  deposits = [{ status: "REFUNDED" }];
  const { depositConversionResolved } = await load();
  assert.equal(await depositConversionResolved("buyer_1"), true, "a refunded buyer must not be chased for the deposit");
});

test("FAILED stops the chain", async () => {
  deposits = [{ status: "FAILED" }];
  const { depositConversionResolved } = await load();
  assert.equal(await depositConversionResolved("buyer_1"), true);
});

test("no deposit at all stops the chain", async () => {
  deposits = [];
  const { depositConversionResolved } = await load();
  assert.equal(await depositConversionResolved("buyer_1"), true, "nothing to convert");
});

test("the deposit query still only fetches PAID/PENDING — widening it must break a test", async () => {
  // REFUNDED and FAILED stop the chain BECAUSE they are excluded here and the row
  // therefore reads as "no pending deposit". If a future change adds a status to
  // this list, those two stops silently disappear — so the filter itself is pinned.
  const { depositConversionResolved } = await load();
  await depositConversionResolved("buyer_1");
  assert.deepEqual(
    (depositWhere?.status as { in: string[] }).in.slice().sort(),
    ["PAID", "PENDING"],
    "adding a status here un-stops the REFUNDED/FAILED cases — update those tests deliberately, not by accident",
  );
});

// ── Administratively halted buyers (the missing stop) ──────────────────────
// An admin freezing or retiring an account is an unambiguous "stop contacting
// this person". Marketing them to complete a purchase afterwards is the defect.

for (const field of ["suspendedAt", "disabledAt", "archivedAt", "purgedAt"] as const) {
  test(`a ${field.replace("At", "")} buyer stops the chain even with an unpaid PENDING deposit`, async () => {
    deposits = [{ status: "PENDING" }];
    buyer = { ...ACTIVE_BUYER, [field]: new Date() };
    const { depositConversionResolved } = await load();
    assert.equal(
      await depositConversionResolved("buyer_1"),
      true,
      `an admin set ${field}; continuing to send "complete your $99 deposit" ignores that decision`,
    );
  });
}

test("a missing buyer record stops the chain (fail closed)", async () => {
  buyer = null;
  const { depositConversionResolved } = await load();
  assert.equal(await depositConversionResolved("buyer_1"), true, "no buyer to contact — do not send");
});

test("an active buyer with an unpaid deposit is still reachable (no over-blocking)", async () => {
  deposits = [{ status: "PENDING" }];
  buyer = { ...ACTIVE_BUYER };
  const { depositConversionResolved } = await load();
  assert.equal(
    await depositConversionResolved("buyer_1"),
    false,
    "the halt check must not suppress the sequence it exists to protect",
  );
});
