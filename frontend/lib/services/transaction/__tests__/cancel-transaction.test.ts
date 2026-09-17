// §24 — THE CANCELLATION ORCHESTRATION, against the real service.
//
// ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
//
// `cancelTransaction` is Phase 10's headline service and it had NO test of its own. Two
// call sites had one each — the admin action route and the command centre — and both mock
// the orchestration away, which is correct for them and left the orchestration itself
// unproven. The cost was immediate and measurable: when the command centre moved onto this
// service, `workflow-stage-seam.test.ts` went red against a prisma mock that had never had
// to model what the orchestration reads, and the full matrix was where that surfaced.
//
// What is asserted here is the part no caller can assert for itself: the STOPS run before
// the state changes, the state change goes through the guarded seam, §24's execution
// boundary routes to a freeze rather than a cancellation, a failed stop is reported and
// owned rather than swallowed, and a cancellation that did not take effect never reports
// that it did.
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/transaction/__tests__/cancel-transaction.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

type Rec = Record<string, unknown>;

interface DealRow {
  id: string;
  status: string;
  buyerId: string;
  auctionId: string | null;
  dealerExecutedContractId: string | null;
  vehicleRequestId: string | null;
}

let deal: DealRow | null;
let advances: Array<{ dealId: string; to: string; opts: Rec }>;
let advanceReturns: boolean;
let raised: Rec[];
let auctionUpdates: Rec[];
let invitationUpdates: Rec[];
let requestUpdates: Rec[];
/** Set to make the AUCTION stop throw, so the failed-stop path is exercised for real. */
let auctionThrows: boolean;
/** Ordered log of what happened, so "stops before the move" is provable. */
let order: string[];

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      deal: { findUnique: async () => (deal ? { ...deal } : null) },
      vehicleRequest: {
        findUnique: async () => ({ status: "OPEN" }),
        updateMany: async ({ where, data }: { where: Rec; data: Rec }) => {
          order.push("stop:VEHICLE_REQUEST");
          requestUpdates.push({ where, data });
          return { count: 1 };
        },
      },
      sourcingCase: { findUnique: async () => null },
      auction: {
        updateMany: async ({ where, data }: { where: Rec; data: Rec }) => {
          if (auctionThrows) throw new Error("auction store unavailable");
          order.push("stop:AUCTION");
          auctionUpdates.push({ where, data });
          return { count: 1 };
        },
      },
      auctionInvitation: {
        updateMany: async ({ where, data }: { where: Rec; data: Rec }) => {
          order.push("stop:INVITATIONS");
          invitationUpdates.push({ where, data });
          return { count: 3 };
        },
      },
      pickup: { updateMany: async () => { order.push("stop:PICKUP"); return { count: 0 }; } },
      commsOutbox: { updateMany: async () => ({ count: 0 }) },
      queueItem: { findFirst: async () => null },
    },
  },
});

mock.module("@/lib/services/deal/deal.service", {
  namedExports: {
    advanceDealStatus: async (dealId: string, to: string, opts: Rec = {}) => {
      order.push(`advance:${to}`);
      advances.push({ dealId, to, opts });
      if (deal && advanceReturns) deal.status = to;
      return advanceReturns;
    },
    ContractExecutedError: class ContractExecutedError extends Error {},
  },
});

mock.module("@/lib/services/operations/queue-item.service", {
  namedExports: {
    raiseException: async (input: Rec) => { order.push(`raise:${input.code}`); raised.push(input); return { created: true }; },
  },
});

mock.module("@/lib/services/sourcing/sourcing-case.service", {
  namedExports: {
    transitionCase: async () => ({ ok: true }),
    SOURCING_CASE_STATUS: { CLOSED: "CLOSED" },
  },
});
mock.module("@/lib/services/comms/transactional-dispatcher.service", {
  namedExports: {
    cancelPendingForTransaction: async () => { order.push("stop:SCHEDULED_COMMS"); return { cancelled: 2 }; },
  },
});
mock.module("@/lib/services/esign/buyer-signing.service", {
  namedExports: { voidEnvelopeInternal: async () => { order.push("stop:ESIGN"); } },
});
mock.module("@/lib/services/pickup/pickup.service", { namedExports: { revokePickupToken: async () => ({}) } });
mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

beforeEach(() => {
  deal = {
    id: "deal_1",
    status: "CONTRACT_PENDING",
    buyerId: "b1",
    auctionId: "au_1",
    dealerExecutedContractId: null,
    vehicleRequestId: "vr_1",
  };
  advances = [];
  advanceReturns = true;
  raised = [];
  auctionUpdates = [];
  invitationUpdates = [];
  requestUpdates = [];
  auctionThrows = false;
  order = [];
});

async function svc() {
  return import("../cancellation.service");
}

const input = { dealId: "deal_1", reason: "buyer changed their mind", actorId: "adm_1", actorRole: "ADMIN" as const };

test("§24 — a pre-execution cancellation moves the deal to CANCELLED through the SEAM", async () => {
  const { cancelTransaction } = await svc();
  const out = await cancelTransaction(input);

  assert.equal(out.outcome, "CANCELLED");
  assert.equal(advances.length, 1, "exactly one state change, and it is the seam's");
  assert.equal(advances[0]!.to, "CANCELLED");
  assert.equal(advances[0]!.opts.actorRole, "ADMIN", "an admin cancellation is not attributed to SYSTEM");
  assert.equal(advances[0]!.opts.reason, "buyer changed their mind");
  assert.equal(
    advances[0]!.opts.expectedFrom,
    "CONTRACT_PENDING",
    "the CAS predicate is the status that was READ — that predicate is the whole guard",
  );
});

test("the STOPS run BEFORE the state change — a stop is destructive and must not run on a refused move", async () => {
  const { cancelTransaction } = await svc();
  await cancelTransaction(input);

  const advanceAt = order.indexOf("advance:CANCELLED");
  const stopIndices = order.map((o, i) => (o.startsWith("stop:") && o !== "stop:VEHICLE_REQUEST" ? i : -1)).filter((i) => i >= 0);
  assert.ok(stopIndices.length > 0, "stops ran at all");
  assert.ok(
    stopIndices.every((i) => i < advanceAt),
    `every stop must precede the move. Order was: ${order.join(" → ")}`,
  );
});

test("§24 — the auction and its invitations are stopped CONDITIONALLY, never overwritten", async () => {
  const { cancelTransaction } = await svc();
  await cancelTransaction(input);

  assert.deepEqual(
    (auctionUpdates[0]!.where as Rec).status,
    { in: ["PENDING", "ACTIVE"] },
    "a concurrent close must be a no-op, not an overwrite",
  );
  assert.deepEqual(
    (invitationUpdates[0]!.where as Rec).status,
    { in: ["QUEUED", "SENT", "DELIVERED", "OPENED"] },
    "a dealership that already responded is not withdrawn from",
  );
  assert.equal(
    (invitationUpdates[0]!.data as Rec).status,
    "CANCELLED",
    "CANCELLED, not EXPIRED — EXPIRED would tell a dealership it missed a deadline it never missed",
  );
});

test("§24 EXECUTION BOUNDARY — an executed contract FREEZES, and never cancels", async () => {
  deal!.dealerExecutedContractId = "cv_1";
  const { cancelTransaction } = await svc();
  const out = await cancelTransaction(input);

  assert.equal(out.outcome, "FROZEN_PENDING_RELEASE");
  assert.equal(advances[0]!.to, "FROZEN_PENDING_RELEASE");
  assert.ok(
    raised.some((r) => r.code === "DEAL_FROZEN_PENDING_RELEASE"),
    "a frozen deal with no case is a transaction nobody is driving",
  );
  assert.deepEqual(requestUpdates, [], "the request records what the buyer asked for; the transaction has not ended");
  assert.ok(
    !order.includes("stop:ESIGN"),
    "after execution the envelope IS the executed contract — voiding it destroys the evidence the release is negotiated against",
  );
});

test("a FAILED stop is reported and OWNED, never swallowed", async () => {
  auctionThrows = true;
  const { cancelTransaction } = await svc();
  const out = await cancelTransaction(input);

  const failed = out.stops.filter((s) => !s.ok);
  assert.equal(failed.length, 1, "the failure is carried in the result rather than logged and lost");
  assert.equal(failed[0]!.stop, "AUCTION");
  assert.ok(
    raised.some((r) => r.code === "CANCELLATION_CLEANUP_INCOMPLETE"),
    "§28.3 #8: every failure has an owner and a return path",
  );
  assert.equal(out.outcome, "CANCELLED", "the transaction still cancelled; the CLEANUP is what is incomplete");
});

test("a cancellation the seam DECLINED reports NOT_MOVED, never success", async () => {
  advanceReturns = false;
  const { cancelTransaction } = await svc();
  const out = await cancelTransaction(input);
  assert.equal(out.outcome, "NOT_MOVED");
});

test("§24 requires a reason, and refuses without one", async () => {
  const { cancelTransaction, CancellationInputError } = await svc();
  await assert.rejects(
    () => cancelTransaction({ ...input, reason: "   " }),
    (err: unknown) => err instanceof CancellationInputError,
    'a cancellation whose reason is "cancelled" answers nothing an operator would ask',
  );
  assert.deepEqual(advances, [], "and nothing moved");
  assert.deepEqual(order, [], "and no stop ran");
});

test("a cancellation with neither a deal nor a request is refused", async () => {
  const { cancelTransaction, CancellationInputError } = await svc();
  await assert.rejects(
    () => cancelTransaction({ reason: "x", actorId: "adm_1", actorRole: "ADMIN" }),
    (err: unknown) => err instanceof CancellationInputError,
  );
});

test("§24 — the stage the transaction was at is captured BEFORE anything moves", async () => {
  const { cancelTransaction } = await svc();
  const out = await cancelTransaction(input);
  assert.equal(
    out.stageAtCancellation,
    "Deal CONTRACT_PENDING",
    "captured after the stops there would be no way to say what the transaction was doing",
  );
});

// ── FINDINGS 14 AND 21 FROM THE FIRST INDEPENDENT REVIEW ────────────────────

test("a TERMINAL deal is refused BEFORE any stop runs — a stop cannot be undone", async () => {
  deal!.status = "COMPLETED";
  const { cancelTransaction } = await svc();
  const out = await cancelTransaction(input);

  assert.equal(out.outcome, "NOT_MOVED");
  assert.deepEqual(
    order,
    [],
    "a cancellation aimed at a completed purchase used to void its envelopes, cancel its dealer " +
      "invitations and stop its pickup, and THEN throw TerminalDealError from the seam — the caller " +
      `saw a failure and the transaction had already been dismantled. Order was: ${order.join(" → ")}`,
  );
  assert.deepEqual(advances, [], "and nothing was even attempted on the seam");
  assert.equal(out.stageAtCancellation, "Deal COMPLETED", "the stage is still reported honestly");
});

test("cancelling an ALREADY-CANCELLED deal is a quiet no-op, not a second teardown", async () => {
  deal!.status = "CANCELLED";
  const { cancelTransaction } = await svc();
  const out = await cancelTransaction(input);

  assert.equal(out.outcome, "NOT_MOVED");
  assert.deepEqual(order, [], "re-voiding envelopes on a deal somebody already cancelled helps nobody");
  assert.deepEqual(raised, [], "and opens no case — nothing failed");
});

test("a DIFFERENT cleanup failure opens its OWN case — the key names what failed", async () => {
  // Finding 21: a strict once-ever key of CODE:dealId meant the second, different failure
  // collided with the first row and opened nothing, leaving (say) a live e-sign envelope with
  // no owner. The key now carries the failed-stop set.
  auctionThrows = true;
  const { cancelTransaction } = await svc();
  await cancelTransaction(input);

  const cleanup = raised.find((r) => r.code === "CANCELLATION_CLEANUP_INCOMPLETE")!;
  assert.ok(cleanup, "the failure opens a case");
  assert.equal(
    cleanup.occurrenceKey,
    "AUCTION",
    "the discriminator is WHICH stops failed, so a different failure is a different condition",
  );
  assert.equal(
    cleanup.idempotencyKey,
    undefined,
    "and it is the DERIVED key, so a recurrence after resolution is suffixed rather than swallowed",
  );
});
