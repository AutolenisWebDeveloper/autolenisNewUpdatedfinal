// CROSS-PORTAL PARITY — the buyer, the dealer and Operations read one lineage.
//
// §8.1 row 10: "buyer portal, dealer portal and Ops queue render the same checkpoint,
// owner, deadline and recovery from ONE lineage."
//
// Three surfaces rendering the same fact independently is how a buyer and a
// dealership end up believing different things about the same deal. These tests pin
// the two halves of that: the facts are IDENTICAL across audiences, and the only
// thing that varies is what each party may be told.
//
// Run: pnpm test:operations

import test from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";

const NOW = new Date("2026-09-17T12:00:00Z");
const DEADLINE = new Date("2026-09-20T12:00:00Z");

/** One queue row, shaped as Prisma returns it. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "q1",
    type: "DEAL_EXCEPTION",
    status: "OPEN",
    exceptionCode: "DEAL_FROZEN_PENDING_RELEASE",
    ownerRole: "OPERATIONS",
    assignedAdminId: null,
    vehicleRequestId: null,
    dealId: "d1",
    auctionId: null,
    depositId: null,
    buyerId: "b1",
    dealerId: null,
    buyerVisibleStatus: null,
    requiredAction: null,
    deadlineAt: DEADLINE,
    returnPoint: "§24 — the stage recorded on the freeze",
    resolution: null,
    resolvedAt: null,
    resolvedBy: null,
    escalatedAt: null,
    idempotencyKey: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

let rows: ReturnType<typeof row>[] = [];

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      queueItem: {
        findMany: async () => rows,
        count: async () => rows.length,
      },
    },
  },
});

async function load() {
  return import("../exception-lineage.service");
}

test("the same exception yields the SAME checkpoint, owner and deadline to every audience", async () => {
  rows = [row()];
  const { exceptionLineage } = await load();

  const [buyer] = await exceptionLineage({ audience: "BUYER", buyerId: "b1" });
  const [dealer] = await exceptionLineage({ audience: "DEALER", dealId: "d1" });
  const [ops] = await exceptionLineage({ audience: "OPS", dealId: "d1" });

  assert.ok(buyer && dealer && ops, "every audience must see this exception — it is about all three");

  // THE FACTS ARE ONE. If these ever differ, two parties are being told different
  // things about the same transaction, which is the failure this lineage exists to
  // make impossible.
  assert.equal(buyer.checkpoint, dealer.checkpoint);
  assert.equal(dealer.checkpoint, ops.checkpoint);
  assert.equal(buyer.exceptionCode, ops.exceptionCode);
  assert.equal(buyer.owner, dealer.owner);
  assert.equal(dealer.owner, ops.owner);
  assert.equal(buyer.deadlineAt, ops.deadlineAt);
  assert.equal(dealer.deadlineAt, ops.deadlineAt);
  assert.equal(buyer.openedAt, ops.openedAt);
  assert.equal(buyer.overdue, ops.overdue);
});

test("what differs between audiences is the recovery text, and it is never empty", async () => {
  rows = [row()];
  const { exceptionLineage } = await load();

  const [buyer] = await exceptionLineage({ audience: "BUYER", buyerId: "b1" });
  const [dealer] = await exceptionLineage({ audience: "DEALER", dealId: "d1" });
  const [ops] = await exceptionLineage({ audience: "OPS", dealId: "d1" });

  for (const [name, l] of [["buyer", buyer], ["dealer", dealer], ["ops", ops]] as const) {
    assert.ok(l && l.recovery.length > 0, `${name}: a returned row must always carry a recovery`);
  }
  // Different words for different readers — the buyer is told their purchase is on
  // hold, the dealership is told not to release the vehicle, Operations is told to
  // obtain the release.
  assert.notEqual(buyer!.recovery, dealer!.recovery);
  assert.notEqual(dealer!.recovery, ops!.recovery);

  // And the owner LABEL is audience-specific even though the owner is not.
  assert.equal(buyer!.owner, dealer!.owner, "same owner");
  assert.equal(ops!.ownerLabel, "Operations");
  assert.equal(buyer!.ownerLabel, "AutoLenis", "a buyer does not need our internal team names");
});

test("the dealer projection is an ALLOWLIST and fails closed", async () => {
  // A buyer-owned exception about their money. Operations and the buyer see it; the
  // dealership must not — §25.1's identity firewall, and a dealership learning that a
  // buyer's payment failed is both a disclosure and a reason to price differently.
  rows = [row({ exceptionCode: "PAYMENT_FAILURE", ownerRole: "BUYER", dealId: "d1", buyerId: "b1" })];
  const { exceptionLineage } = await load();

  const dealer = await exceptionLineage({ audience: "DEALER", dealId: "d1" });
  const buyer = await exceptionLineage({ audience: "BUYER", buyerId: "b1" });
  const ops = await exceptionLineage({ audience: "OPS", dealId: "d1" });

  assert.deepEqual(dealer, [], "a code absent from DEALER_VISIBLE_CODES must not reach the dealer surface");
  assert.equal(buyer.length, 1, "the buyer is told — it is their payment");
  assert.equal(ops.length, 1, "Operations is told — it is their queue");
});

test("the allowlist is proved to fail closed — an unknown code is invisible to dealers", async () => {
  // The seeded-failure discipline, applied to a disclosure rule. If this ever passes
  // a code through, the test above stops meaning anything.
  rows = [row({ exceptionCode: "COMMS_TERMINAL_FAILURE", dealId: "d1" })];
  const { exceptionLineage } = await load();
  const dealer = await exceptionLineage({ audience: "DEALER", dealId: "d1" });
  assert.deepEqual(
    dealer,
    [],
    "an internal comms failure is not a dealership's business — fail-closed means a NEW §26 row is silent here until someone decides otherwise",
  );

  // And the converse, so the rule is not simply "dealers see nothing".
  rows = [row({ exceptionCode: "DEAL_FROZEN_PENDING_RELEASE", dealId: "d1" })];
  const visible = await exceptionLineage({ audience: "DEALER", dealId: "d1" });
  assert.equal(visible.length, 1, "an allowlisted code MUST reach the dealer, or the surface is dead");
});

test("a buyer is not shown an exception §26 marks ops-only", async () => {
  // §26 has rows that are infrastructure conditions — a provider quota, a sweep
  // shortfall — whose `buyerVisibleStatus` is deliberately null. Null means "not
  // surfaced", never "surfaced blank".
  rows = [row({ exceptionCode: "CANCELLATION_CLEANUP_INCOMPLETE", buyerId: "b1", dealId: "d1" })];
  const { exceptionLineage } = await load();

  assert.deepEqual(await exceptionLineage({ audience: "BUYER", buyerId: "b1" }), []);
  assert.equal((await exceptionLineage({ audience: "OPS", dealId: "d1" })).length, 1);
});

test("an uncatalogued code is rendered to nobody", async () => {
  rows = [row({ exceptionCode: "NOT_A_REAL_CODE" })];
  const { exceptionLineage } = await load();
  for (const audience of ["BUYER", "DEALER", "OPS"] as const) {
    assert.deepEqual(
      await exceptionLineage({ audience, buyerId: "b1", dealId: "d1" }),
      [],
      `${audience}: a row with no catalogue entry has no owner, deadline or copy — §26's whole guarantee — so it is rendered to nobody`,
    );
  }
});

test("overdue is computed, not stored", async () => {
  rows = [row({ deadlineAt: new Date("2020-01-01T00:00:00Z") })];
  const { exceptionLineage } = await load();
  const [ops] = await exceptionLineage({ audience: "OPS", dealId: "d1" });
  assert.equal(ops!.overdue, true);

  rows = [row({ deadlineAt: null })];
  const [noDeadline] = await exceptionLineage({ audience: "OPS", dealId: "d1" });
  assert.equal(noDeadline!.overdue, false, "no deadline is not overdue");
  assert.equal(noDeadline!.deadlineAt, null);
});

test("hasOpenException drives the §26 upgrade suppression", async () => {
  const { hasOpenException } = await load();
  rows = [row()];
  assert.equal(await hasOpenException("b1"), true);
  rows = [];
  assert.equal(await hasOpenException("b1"), false);
});
